import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

// GET /api/extension/pending
// Returns the next due scheduled post and atomically marks it as 'processing'
// so a second alarm firing mid-post won't claim the same row.
export async function GET(request: NextRequest) {
  const secret = request.headers.get("x-extension-secret");
  if (!secret || secret !== process.env.EXTENSION_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date().toISOString();

  // Claim one due post atomically via UPDATE … RETURNING
  const { data, error } = await supabase
    .from("posts")
    .update({ status: "processing" })
    .eq("status", "scheduled")
    .lte("scheduled_at", now)
    .select("id, content, image_url, image_urls, link_url, target_id, recurrence_rule")
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[extension/pending]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ post: null });
  }

  // Normalise image_urls: prefer the new array, fall back to wrapping the legacy image_url.
  const imageUrls: string[] =
    data.image_urls?.length
      ? data.image_urls
      : data.image_url
      ? [data.image_url]
      : [];

  return NextResponse.json({
    post: {
      id: data.id,
      content: data.content,
      image_urls: imageUrls,
      link_url: data.link_url,
      target_id: data.target_id,
      recurrence_rule: data.recurrence_rule,
    },
  });
}
