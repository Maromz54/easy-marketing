import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

// GET /api/extension/pending-bumps
// Returns published posts that have auto-bump enabled and are due for a bump
// comment based on their bump_interval_hours and last_bumped_at timestamp.
export async function GET(request: NextRequest) {
  const secret = request.headers.get("x-extension-secret");
  if (!secret || secret !== process.env.EXTENSION_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date();

  // Fetch all published posts with auto-bump enabled
  const { data: posts, error } = await supabase
    .from("posts")
    .select("id, target_id, facebook_post_id, bump_interval_hours, last_bumped_at, published_at")
    .eq("status", "published")
    .eq("auto_bump_enabled", true)
    .not("bump_interval_hours", "is", null);

  if (error) {
    console.error("[extension/pending-bumps]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!posts || posts.length === 0) {
    return NextResponse.json({ bump: null });
  }

  // Find the first post that is due for a bump
  for (const post of posts) {
    const lastBump = post.last_bumped_at
      ? new Date(post.last_bumped_at)
      : post.published_at
      ? new Date(post.published_at)
      : null;

    if (!lastBump) continue;

    const intervalMs = (post.bump_interval_hours ?? 24) * 60 * 60 * 1000;
    const nextBumpDue = new Date(lastBump.getTime() + intervalMs);

    if (now >= nextBumpDue) {
      // Mark as processing to prevent duplicate bumps
      const { error: updateErr } = await supabase
        .from("posts")
        .update({ last_bumped_at: now.toISOString() })
        .eq("id", post.id);

      if (updateErr) {
        console.error("[extension/pending-bumps] update error:", updateErr.message);
        continue;
      }

      return NextResponse.json({
        bump: {
          postId: post.id,
          targetId: post.target_id,
          facebookPostId: post.facebook_post_id,
        },
      });
    }
  }

  return NextResponse.json({ bump: null });
}
