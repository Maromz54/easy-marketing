import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

// POST /api/extension/update
// Body: { postId: string; status: "published" | "failed"; error?: string }
export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-extension-secret");
  if (!secret || secret !== process.env.EXTENSION_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { postId?: string; status?: string; error?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { postId, status, error: errorMsg } = body;

  if (!postId || (status !== "published" && status !== "failed")) {
    return NextResponse.json(
      { error: "postId and status (published|failed) are required" },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  const update: Record<string, unknown> = { status };
  if (status === "published") {
    update.published_at = new Date().toISOString();
  }
  if (status === "failed" && errorMsg) {
    update.error_message = errorMsg;
  }

  const { error } = await supabase
    .from("posts")
    .update(update)
    .eq("id", postId);

  if (error) {
    console.error("[extension/update]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // ── Recurrence cloning ─────────────────────────────────────────────────
  // When a post is successfully published and has a recurrence rule, clone it
  // for the next occurrence so the extension will pick it up automatically.
  if (status === "published") {
    const { data: post } = await supabase
      .from("posts")
      .select(
        "recurrence_rule, scheduled_at, content, image_urls, link_url, target_id, facebook_token_id, user_id, auto_bump_enabled, bump_interval_hours"
      )
      .eq("id", postId)
      .single();

    if (post?.recurrence_rule) {
      const nextDate = calculateNextOccurrence(
        post.recurrence_rule,
        new Date(post.scheduled_at ?? Date.now())
      );

      if (nextDate) {
        const { error: cloneErr } = await supabase.from("posts").insert({
          user_id: post.user_id,
          facebook_token_id: post.facebook_token_id,
          target_id: post.target_id,
          content: post.content,
          image_urls: post.image_urls ?? [],
          link_url: post.link_url,
          recurrence_rule: post.recurrence_rule,
          auto_bump_enabled: post.auto_bump_enabled ?? false,
          bump_interval_hours: post.bump_interval_hours ?? null,
          status: "scheduled",
          scheduled_at: nextDate.toISOString(),
        });

        if (cloneErr) {
          // Non-fatal — log the error but don't fail the response
          console.error("[extension/update] recurrence clone error:", cloneErr.message);
        } else {
          console.log(
            "[extension/update] recurrence clone created for",
            postId,
            "→ next:",
            nextDate.toISOString()
          );
        }
      }
    }
  }

  return NextResponse.json({ success: true });
}

// ── Recurrence helpers ─────────────────────────────────────────────────────────

/**
 * Given a recurrence rule and the date a post was published, returns the next
 * date the post should be re-published.
 *
 * Rule formats:
 *   "weekly:0,1,5"  – weekly on Sunday (0), Monday (1), Friday (5)
 *   "monthly"       – same day of month, next month (clamped to end-of-month)
 *
 * Returns null if the rule is unrecognised.
 */
function calculateNextOccurrence(rule: string, from: Date): Date | null {
  if (rule.startsWith("weekly:")) {
    const days = rule
      .slice(7)
      .split(",")
      .map(Number)
      .filter((d) => d >= 0 && d <= 6);

    if (days.length === 0) return null;

    // Find the next calendar day (starting tomorrow) that matches a rule day
    const next = new Date(from);
    for (let i = 1; i <= 7; i++) {
      next.setDate(from.getDate() + i);
      if (days.includes(next.getDay())) return next;
    }
    return null;
  }

  if (rule === "monthly") {
    const targetDay = from.getDate();
    const next = new Date(from);
    next.setMonth(next.getMonth() + 1);
    // Clamp to the last day of the target month if it is shorter
    const daysInMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(targetDay, daysInMonth));
    return next;
  }

  return null;
}
