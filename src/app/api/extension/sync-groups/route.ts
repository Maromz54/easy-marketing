import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

interface ScrapedGroup {
  groupId: string;
  name: string;
  iconUrl: string | null;
}

// POST /api/extension/sync-groups
// Receives scraped groups from the extension, upserts them into facebook_groups,
// then DELETES any rows for this user that were NOT in the scraped batch —
// making the DB a perfect mirror of the user's current Facebook state.
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
  const { data: job, error: jobErr } = await supabase
    .from("sync_jobs")
    .select("user_id")
    .eq("id", jobId)
    .eq("status", "processing")
    .maybeSingle();

  if (jobErr) {
    console.error("[sync-groups] Job lookup error:", jobErr);
    return NextResponse.json({ error: "Failed to look up sync job" }, { status: 500 });
  }
  if (!job) {
    return NextResponse.json({ error: "Sync job not found or not in processing state" }, { status: 404 });
  }

  const userId = job.user_id;

  // ── Upsert all scraped groups ───────────────────────────────────────────
  let upserted = 0;
  const scrapedIds: string[] = [];

  for (const g of groups) {
    if (!g.groupId || !g.name) continue;
    scrapedIds.push(g.groupId);

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
    if (!error) upserted++;
    else console.error("[sync-groups] Upsert error for group", g.groupId, error);
  }

  // ── True Sync: delete stale rows ────────────────────────────────────────
  // Remove any groups that the user has LEFT on Facebook since the last sync.
  // This keeps the DB an exact mirror of the user's current state.
  let removed = 0;
  if (scrapedIds.length > 0) {
    // Delete rows belonging to this user whose group_id is NOT in the scraped set
    const { data: deleted, error: delErr } = await supabase
      .from("facebook_groups")
      .delete()
      .eq("user_id", userId)
      .not("group_id", "in", `(${scrapedIds.join(",")})`)
      .select("id");

    if (delErr) {
      console.error("[sync-groups] Stale group cleanup error:", delErr);
    } else {
      removed = deleted?.length ?? 0;
    }
  } else {
    // Scraper returned 0 groups — don't wipe everything, that's likely an error.
    // Only delete if we got a non-empty result from the extension.
    console.warn("[sync-groups] Scraper returned 0 groups — skipping stale cleanup to avoid data loss.");
  }

  // ── Mark sync job done ──────────────────────────────────────────────────
  const { error: doneErr } = await supabase
    .from("sync_jobs")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("id", jobId);

  if (doneErr) {
    console.error("[sync-groups] Failed to mark job done:", doneErr);
  }

  console.log(
    `[sync-groups] Job ${jobId}: upserted ${upserted}/${groups.length}, removed ${removed} stale group(s) for user ${userId}`
  );
  return NextResponse.json({ upserted, removed });
}
