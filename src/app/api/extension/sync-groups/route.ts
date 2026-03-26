import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

interface ScrapedGroup {
  groupId: string;
  name: string;
  iconUrl: string | null;
}

// POST /api/extension/sync-groups
// Receives scraped groups from the extension, upserts them into facebook_groups,
// and marks the sync_job as done.
export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-extension-secret");
  if (!secret || secret !== process.env.EXTENSION_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { jobId: string; groups: ScrapedGroup[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { jobId, groups } = body;
  if (!jobId || !Array.isArray(groups)) {
    return NextResponse.json({ error: "Missing jobId or groups" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Fetch the job to get the user_id
  const { data: job } = await supabase
    .from("sync_jobs")
    .select("user_id")
    .eq("id", jobId)
    .eq("status", "processing")
    .maybeSingle();

  if (!job) {
    return NextResponse.json({ error: "Sync job not found or not in processing state" }, { status: 404 });
  }

  const userId = job.user_id;

  // Upsert each group — ON CONFLICT (user_id, group_id) update name + icon
  let inserted = 0;
  for (const g of groups) {
    if (!g.groupId || !g.name) continue;
    const { error } = await supabase
      .from("facebook_groups")
      .upsert(
        {
          user_id: userId,
          group_id: g.groupId,
          name: g.name.slice(0, 200),
          icon_url: g.iconUrl ?? null,
          synced_at: new Date().toISOString(),
        },
        { onConflict: "user_id,group_id" }
      );
    if (!error) inserted++;
    else console.error("[sync-groups] Upsert error for group", g.groupId, error);
  }

  // Mark sync job done
  await supabase
    .from("sync_jobs")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("id", jobId);

  console.log(`[sync-groups] Job ${jobId}: upserted ${inserted}/${groups.length} groups for user ${userId}`);
  return NextResponse.json({ inserted });
}
