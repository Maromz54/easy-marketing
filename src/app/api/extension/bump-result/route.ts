import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-extension-secret");
  if (!secret || secret !== process.env.EXTENSION_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { postId?: string; success?: boolean; error?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.postId || typeof body.success !== "boolean") {
    return NextResponse.json({ error: "postId and success required" }, { status: 400 });
  }

  if (body.success) {
    // last_bumped_at was already set pre-emptively — no change needed
    return NextResponse.json({ ok: true });
  }

  // Failure — roll back last_bumped_at so the post is retried next cycle
  const supabase = createServiceClient();
  await supabase.from("posts")
    .update({ last_bumped_at: null }).eq("id", body.postId);

  return NextResponse.json({ ok: true });
}
