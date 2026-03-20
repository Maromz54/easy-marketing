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
    .select("id, content, image_url, link_url, target_id")
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[extension/pending]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ post: data ?? null });
}
