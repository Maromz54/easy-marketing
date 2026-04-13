/**
 * GET /api/cron/publish
 *
 * Vercel Cron Route — runs every minute (configured in vercel.json).
 *
 * Security: Vercel automatically attaches `Authorization: Bearer {CRON_SECRET}`
 * to every cron invocation. We reject any request that lacks a valid header.
 *
 * Algorithm (safe for concurrent/duplicate runs):
 *  1. Atomically claim due posts: UPDATE status → 'processing' WHERE status='scheduled'
 *     AND scheduled_at <= NOW(). The UPDATE is serialized by Postgres — only one
 *     concurrent invocation wins the rows.
 *  2. For each claimed post, call the Facebook Graph API.
 *  3. UPDATE each post to 'published' (with facebook_post_id) or 'failed' (with error).
 */
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { publishToPage } from "@/lib/facebook";

// ── Types ─────────────────────────────────────────────────────────────────────
interface DuePost {
  id: string;
  content: string;
  image_url: string | null;
  image_urls: string[];
  link_url: string | null;
  /** Explicit publish target (Group ID or alternate Page ID). Falls back to page_id. */
  target_id: string | null;
  facebook_token_id: string | null;
  facebook_tokens: {
    page_id: string;
    access_token: string;
  } | null;
}

// ── Handler ───────────────────────────────────────────────────────────────────
export async function GET(request: Request) {
  // ── Authorization ─────────────────────────────────────────────────────────
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error("[cron/publish] CRON_SECRET is not set");
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date().toISOString();

  // ── Step 0: Recovery — reset any page posts stuck in "processing" > 15 min ─
  // (handles cron function crashes mid-flight)
  await supabase
    .from("posts")
    .update({ status: "scheduled" })
    .eq("status", "processing")
    .not("facebook_token_id", "is", null)
    .lt("scheduled_at", new Date(Date.now() - 15 * 60 * 1000).toISOString());

  // ── Step 1: Atomically claim due scheduled PAGE posts ─────────────────────
  // Filter: facebook_token_id IS NOT NULL — leaves null-token group posts for
  // the VPS Playwright worker. Without this filter the cron would claim group
  // posts, immediately mark them "failed" (no token), and the VPS worker would
  // never see them (race condition introduced by the every-5-min cron schedule).
  const { data: claimedPosts, error: claimError } = await supabase
    .from("posts")
    .update({ status: "processing" })
    .eq("status", "scheduled")
    .lte("scheduled_at", now)
    .not("facebook_token_id", "is", null)
    .select(
      "id, content, image_url, image_urls, link_url, target_id, facebook_token_id, facebook_tokens(page_id, access_token)"
    )
    .returns<DuePost[]>();

  if (claimError) {
    console.error("[cron/publish] Failed to claim posts:", claimError);
    return NextResponse.json({ error: "DB claim failed" }, { status: 500 });
  }

  if (!claimedPosts || claimedPosts.length === 0) {
    return NextResponse.json({ processed: 0, message: "No due posts" });
  }

  console.log(`[cron/publish] Claimed ${claimedPosts.length} post(s) to process`);

  // ── Step 2: Publish each claimed post ────────────────────────────────────
  const results = await Promise.allSettled(
    claimedPosts.map((post) => publishPost(post, supabase))
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;

  console.log(`[cron/publish] Done — ${succeeded} published, ${failed} failed`);

  return NextResponse.json({
    processed: claimedPosts.length,
    succeeded,
    failed,
  });
}

// ── Publish a single post ─────────────────────────────────────────────────────
async function publishPost(
  post: DuePost,
  supabase: ReturnType<typeof createServiceClient>
): Promise<void> {
  if (!post.facebook_tokens) {
    await supabase
      .from("posts")
      .update({
        status: "failed",
        error_message: "לא נמצא טוקן פייסבוק לדף זה. ייתכן שהדף נותק.",
      })
      .eq("id", post.id);
    return;
  }

  const { page_id, access_token } = post.facebook_tokens;
  const targetId = post.target_id ?? page_id;

  try {
    const facebookPostId = await publishToPage(targetId, access_token, {
      message: post.content,
      link: post.link_url ?? undefined,
      picture: (post.image_urls?.length ? post.image_urls[0] : post.image_url) ?? undefined,
    });

    await supabase
      .from("posts")
      .update({
        status: "published",
        published_at: new Date().toISOString(),
        facebook_post_id: facebookPostId,
        error_message: null,
      })
      .eq("id", post.id);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "שגיאה לא ידועה בפרסום לפייסבוק.";

    console.error(`[cron/publish] Failed to publish post ${post.id}:`, err);

    await supabase
      .from("posts")
      .update({
        status: "failed",
        error_message: message,
      })
      .eq("id", post.id);
  }
}
