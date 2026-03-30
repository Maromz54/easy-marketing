import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

// GET /api/extension/sync-check
// Called by the extension every alarm cycle (after the post queue drains).
// Atomically claims a pending facebook_groups sync job and returns it.
export async function GET(request: NextRequest) {
  const secret = request.headers.get("x-extension-secret");
  if (!secret || secret !== process.env.EXTENSION_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  // Find and atomically mark the first pending sync job as 'processing'
  const { data: job, error } = await supabase
    .from("sync_jobs")
    .update({ status: "processing" })
    .eq("status", "pending")
    .eq("type", "facebook_groups")
    .select("id, user_id")
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[sync-check] DB error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!job) {
    return NextResponse.json({ job: null });
  }

  console.log("[sync-check] Sync job claimed:", job.id, "user:", job.user_id);
  return NextResponse.json({ job: { id: job.id, userId: job.user_id } });
}
