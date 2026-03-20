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
    return NextResponse.json({ error: "postId and status (published|failed) are required" }, { status: 400 });
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

  return NextResponse.json({ success: true });
}
