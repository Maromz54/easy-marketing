"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { publishToPage } from "@/lib/facebook";
import { resolveSpintax } from "@/utils/spintax";

export interface CreatePostInput {
  /** When omitted the post is queued for the Chrome Extension (no Graph API call). */
  facebookTokenId?: string;
  /** Single group/page ID — used when no distribution lists are selected. */
  targetId?: string;
  /** One or more distribution list IDs whose group_ids will be merged and fanned out. */
  distributionListIds?: string[];
  /** Additional group IDs entered manually (comma-separated, already split by the caller). */
  extraGroupIds?: string[];
  content: string;
  imageUrls?: string[];
  linkUrl?: string;
  publishMode: "now" | "scheduled";
  scheduledAt?: string;
  /** Recurrence rule: "weekly:0,1,5" or "monthly". Null / omitted = one-time. */
  recurrenceRule?: string;
  /** Auto-bump: periodically comment on the published post to push it up. */
  autoBumpEnabled?: boolean;
  /** Hours between auto-bump comments (1–168). */
  bumpIntervalHours?: number;
}

export interface CreatePostResult {
  success?: boolean;
  error?: string;
  /** Number of posts created (> 1 for distribution fan-out). */
  count?: number;
}

export interface CancelPostResult {
  success?: boolean;
  error?: string;
}

export interface UpdatePostInput {
  postId: string;
  content: string;
  targetId?: string;
  imageUrls?: string[];
  linkUrl?: string;
  publishMode: "now" | "scheduled";
  scheduledAt?: string;
  recurrenceRule?: string;
}

export interface UpdatePostResult {
  success?: boolean;
  error?: string;
}

// ── saveAsTemplateAction ───────────────────────────────────────────────────────

export interface SaveAsTemplateInput {
  content: string;
  imageUrls?: string[];
  linkUrl?: string;
}

export async function saveAsTemplateAction(
  input: SaveAsTemplateInput
): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "המשתמש אינו מחובר." };

  if (!input.content.trim()) return { error: "תוכן התבנית הוא חובה." };

  const { error: dbError } = await supabase.from("posts").insert({
    user_id: user.id,
    content: input.content,
    image_urls: input.imageUrls ?? [],
    link_url: input.linkUrl || null,
    is_template: true,
    status: "draft",
  });

  if (dbError) {
    console.error("[saveAsTemplateAction] DB error:", dbError);
    return { error: "שגיאה בשמירת התבנית. אנא נסה שוב." };
  }

  revalidatePath("/dashboard");
  return { success: true };
}

// ── deleteTemplateAction ───────────────────────────────────────────────────────

export async function deleteTemplateAction(
  templateId: string
): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "המשתמש אינו מחובר." };

  const { data: existing } = await supabase
    .from("posts")
    .select("id")
    .eq("id", templateId)
    .eq("user_id", user.id)
    .eq("is_template", true)
    .maybeSingle();

  if (!existing) return { error: "התבנית לא נמצאה." };

  const { error: dbError } = await supabase
    .from("posts")
    .delete()
    .eq("id", templateId);

  if (dbError) {
    console.error("[deleteTemplateAction] DB error:", dbError);
    return { error: "שגיאה במחיקת התבנית. אנא נסה שוב." };
  }

  revalidatePath("/dashboard");
  return { success: true };
}

// ── cancelScheduledPostAction ──────────────────────────────────────────────────
// Converts a scheduled post back to a draft (removes scheduled_at) so the user
// can edit, re-schedule, or delete it without losing the content.

export async function cancelScheduledPostAction(
  postId: string
): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "המשתמש אינו מחובר." };

  const { data: existing } = await supabase
    .from("posts")
    .select("id")
    .eq("id", postId)
    .eq("user_id", user.id)
    .eq("status", "scheduled")
    .maybeSingle();

  if (!existing) {
    return { error: "הפוסט לא נמצא, אינו בבעלותך, או שאינו מתוזמן." };
  }

  const { error: dbError } = await supabase
    .from("posts")
    .update({ status: "draft", scheduled_at: null })
    .eq("id", postId);

  if (dbError) {
    console.error("[cancelScheduledPostAction] DB error:", dbError);
    return { error: "שגיאה בביטול הפוסט. אנא נסה שוב." };
  }

  revalidatePath("/dashboard");
  return { success: true };
}

// ── deletePostAction ────────────────────────────────────────────────────────────
// Permanently deletes a draft post. Only drafts can be deleted this way.

export async function deletePostAction(
  postId: string
): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "המשתמש אינו מחובר." };

  const { data: existing } = await supabase
    .from("posts")
    .select("id")
    .eq("id", postId)
    .eq("user_id", user.id)
    .eq("status", "draft")
    .maybeSingle();

  if (!existing) {
    return { error: "הפוסט לא נמצא, אינו בבעלותך, או שאינו טיוטה." };
  }

  const { error: dbError } = await supabase
    .from("posts")
    .delete()
    .eq("id", postId);

  if (dbError) {
    console.error("[deletePostAction] DB error:", dbError);
    return { error: "שגיאה במחיקת הפוסט. אנא נסה שוב." };
  }

  revalidatePath("/dashboard");
  return { success: true };
}

// ── cancelPostAction ───────────────────────────────────────────────────────────

export async function cancelPostAction(postId: string): Promise<CancelPostResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "המשתמש אינו מחובר." };

  const { data: existing } = await supabase
    .from("posts")
    .select("id")
    .eq("id", postId)
    .eq("user_id", user.id)
    .eq("status", "scheduled")
    .maybeSingle();

  if (!existing) {
    return { error: "הפוסט לא נמצא, אינו בבעלותך, או שאינו מתוזמן." };
  }

  const { error: dbError } = await supabase
    .from("posts")
    .update({ status: "cancelled" })
    .eq("id", postId);

  if (dbError) {
    console.error("[cancelPostAction] DB error:", dbError);
    return { error: "שגיאה בביטול הפוסט. אנא נסה שוב." };
  }

  revalidatePath("/dashboard");
  return { success: true };
}

// ── updatePostAction ───────────────────────────────────────────────────────────

export async function updatePostAction(input: UpdatePostInput): Promise<UpdatePostResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "המשתמש אינו מחובר." };

  const { data: existing } = await supabase
    .from("posts")
    .select("id")
    .eq("id", input.postId)
    .eq("user_id", user.id)
    .eq("status", "scheduled")
    .maybeSingle();

  if (!existing) {
    return { error: "הפוסט לא נמצא, אינו בבעלותך, או שאינו ניתן לעריכה." };
  }

  const scheduledAt =
    input.publishMode === "scheduled" && input.scheduledAt
      ? new Date(input.scheduledAt).toISOString()
      : new Date().toISOString();

  if (input.publishMode === "scheduled") {
    const scheduled = new Date(input.scheduledAt ?? "");
    if (isNaN(scheduled.getTime()) || scheduled.getTime() <= Date.now()) {
      return { error: "תאריך התזמון חייב להיות בעתיד." };
    }
  }

  const recurrenceRule = input.recurrenceRule?.trim() || null;

  const { error: dbError } = await supabase
    .from("posts")
    .update({
      content: input.content,
      target_id: input.targetId?.trim() || null,
      image_urls: input.imageUrls ?? [],
      link_url: input.linkUrl || null,
      scheduled_at: scheduledAt,
      recurrence_rule: recurrenceRule,
    })
    .eq("id", input.postId);

  if (dbError) {
    console.error("[updatePostAction] DB error:", dbError);
    return { error: "שגיאה בעדכון הפוסט. אנא נסה שוב." };
  }

  revalidatePath("/dashboard");
  return { success: true };
}

// ── createPostAction ───────────────────────────────────────────────────────────

export async function createPostAction(
  input: CreatePostInput
): Promise<CreatePostResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "המשתמש אינו מחובר." };

  const hasToken = !!input.facebookTokenId?.trim();
  const recurrenceRule = input.recurrenceRule?.trim() || null;
  const autoBumpEnabled = input.autoBumpEnabled ?? false;
  const bumpIntervalHours = autoBumpEnabled ? (input.bumpIntervalHours ?? null) : null;

  // ── Multi-distribution / extra-groups fan-out ──────────────────────────
  // Triggered when any distribution lists or manual extra group IDs are provided.
  const hasFanOut =
    (input.distributionListIds?.length ?? 0) > 0 ||
    (input.extraGroupIds?.length ?? 0) > 0;

  if (hasFanOut) {
    console.log("[createPostAction] fan-out path — distributionListIds:", input.distributionListIds, "extraGroupIds:", input.extraGroupIds);

    // Collect group IDs from selected distribution lists
    let allGroupIds: string[] = [];

    if (input.distributionListIds?.length) {
      const { data: lists, error: listErr } = await supabase
        .from("distribution_lists")
        .select("group_ids")
        .in("id", input.distributionListIds)
        .eq("user_id", user.id);

      if (listErr) {
        console.error("[createPostAction] distribution list fetch error:", listErr);
        return { error: "שגיאה בטעינת רשימות התפוצה. אנא נסה שוב." };
      }

      allGroupIds = (lists ?? []).flatMap((l) => l.group_ids);
    }

    // Add manually entered group IDs
    if (input.extraGroupIds?.length) {
      allGroupIds = [...allGroupIds, ...input.extraGroupIds];
    }

    // Deduplicate
    const uniqueGroupIds = [...new Set(allGroupIds.map((id) => id.trim()).filter(Boolean))];

    console.log("[createPostAction] uniqueGroupIds:", JSON.stringify(uniqueGroupIds), "count:", uniqueGroupIds.length);

    if (uniqueGroupIds.length === 0) {
      return { error: "לא נמצאו מזהי קבוצות תקינים. בדוק את הרשימות והמזהים הידניים." };
    }

    const baseTime =
      input.publishMode === "scheduled" && input.scheduledAt
        ? new Date(input.scheduledAt)
        : new Date();

    // Insert one row per group ID with cumulative anti-ban delay.
    // We use individual inserts (not a batch) so each row gets its own
    // error log — a batch insert can silently drop rows on constraint conflicts.
    const batchId = randomUUID();
    let insertedCount = 0;
    let cumulativeDelaySec = 0;

    for (const groupId of uniqueGroupIds) {
      const scheduledAt = new Date(baseTime.getTime() + cumulativeDelaySec * 1000).toISOString();

      // Resolve spintax per-group so every row gets a unique text variation
      const finalContent = resolveSpintax(input.content);

      console.log(`[createPostAction] inserting row ${insertedCount + 1}/${uniqueGroupIds.length} target_id="${groupId}" scheduled_at="${scheduledAt}"`);

      const { error: dbError } = await supabase.from("posts").insert({
        user_id: user.id,
        facebook_token_id: null,
        target_id: groupId,
        content: finalContent,
        image_urls: input.imageUrls ?? [],
        link_url: input.linkUrl || null,
        recurrence_rule: recurrenceRule,
        auto_bump_enabled: autoBumpEnabled,
        bump_interval_hours: bumpIntervalHours,
        batch_id: batchId,
        status: "scheduled" as const,
        scheduled_at: scheduledAt,
      });

      if (dbError) {
        console.error(`[createPostAction] insert failed for target_id="${groupId}":`, dbError);
        // Continue inserting remaining groups rather than aborting the whole fan-out
      } else {
        insertedCount++;
        console.log(`[createPostAction] row inserted OK (total so far: ${insertedCount})`);
      }

      // Add a random 2–5 min stagger before the next post
      cumulativeDelaySec += Math.floor(Math.random() * 181) + 120;
    }

    console.log(`[createPostAction] fan-out complete: ${insertedCount}/${uniqueGroupIds.length} rows inserted`);

    if (insertedCount === 0) {
      return { error: "שגיאה בשמירת כל הפוסטים. אנא בדוק את לוגי השרת." };
    }

    revalidatePath("/dashboard");
    return { success: true, count: insertedCount };
  }

  // ── Extension-only mode (no Facebook Page token) ───────────────────────
  if (!hasToken) {
    const scheduledAt =
      input.publishMode === "scheduled" && input.scheduledAt
        ? new Date(input.scheduledAt).toISOString()
        : new Date().toISOString();

    const { error: dbError } = await supabase.from("posts").insert({
      user_id: user.id,
      facebook_token_id: null,
      target_id: input.targetId?.trim() || null,
      content: resolveSpintax(input.content),
      image_urls: input.imageUrls ?? [],
      link_url: input.linkUrl || null,
      recurrence_rule: recurrenceRule,
      auto_bump_enabled: autoBumpEnabled,
      bump_interval_hours: bumpIntervalHours,
      status: "scheduled",
      scheduled_at: scheduledAt,
    });

    if (dbError) {
      console.error("[createPostAction] DB insert error (extension mode):", dbError);
      return { error: "שגיאה בשמירת הפוסט. אנא נסה שוב." };
    }

    revalidatePath("/dashboard");
    return { success: true };
  }

  // ── Validate the token belongs to this user ────────────────────────────
  const { data: tokenData } = await supabase
    .from("facebook_tokens")
    .select("id, page_id, access_token")
    .eq("id", input.facebookTokenId!)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!tokenData) {
    return { error: "דף הפייסבוק לא נמצא או שאין לך הרשאה אליו." };
  }

  const token = tokenData as { id: string; page_id: string; access_token: string };
  const targetId = input.targetId?.trim() || token.page_id;

  // ── Scheduled — save to DB only ────────────────────────────────────────
  if (input.publishMode === "scheduled") {
    const { error: dbError } = await supabase.from("posts").insert({
      user_id: user.id,
      facebook_token_id: input.facebookTokenId,
      target_id: targetId,
      content: resolveSpintax(input.content),
      image_urls: input.imageUrls ?? [],
      link_url: input.linkUrl || null,
      recurrence_rule: recurrenceRule,
      auto_bump_enabled: autoBumpEnabled,
      bump_interval_hours: bumpIntervalHours,
      status: "scheduled",
      scheduled_at: new Date(input.scheduledAt!).toISOString(),
    });

    if (dbError) {
      console.error("[createPostAction] DB insert error (scheduled):", dbError);
      return { error: "שגיאה בשמירת הפוסט המתוזמן. אנא נסה שוב." };
    }

    revalidatePath("/dashboard");
    return { success: true };
  }

  // ── Immediate publish → Graph API /{targetId}/feed ─────────────────────
  const resolvedContent = resolveSpintax(input.content);
  try {
    const facebookPostId = await publishToPage(targetId, token.access_token, {
      message: resolvedContent,
      link: input.linkUrl || undefined,
      picture: input.imageUrls?.[0] || undefined,
    });

    const { error: dbError } = await supabase.from("posts").insert({
      user_id: user.id,
      facebook_token_id: input.facebookTokenId,
      target_id: targetId,
      content: resolvedContent,
      image_urls: input.imageUrls ?? [],
      link_url: input.linkUrl || null,
      recurrence_rule: recurrenceRule,
      auto_bump_enabled: autoBumpEnabled,
      bump_interval_hours: bumpIntervalHours,
      status: "published",
      published_at: new Date().toISOString(),
      facebook_post_id: facebookPostId,
    });

    if (dbError) {
      console.error("[createPostAction] DB insert error (published):", dbError);
      return {
        error: `הפוסט פורסם בפייסבוק אך אירעה שגיאה בשמירתו (מזהה: ${facebookPostId}).`,
      };
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "שגיאה לא ידועה בפרסום לפייסבוק.";
    console.error("[createPostAction] Facebook publish error:", err);

    const { error: failedInsertError } = await supabase.from("posts").insert({
      user_id: user.id,
      facebook_token_id: input.facebookTokenId,
      target_id: targetId,
      content: resolvedContent,
      image_urls: input.imageUrls ?? [],
      link_url: input.linkUrl || null,
      recurrence_rule: recurrenceRule,
      auto_bump_enabled: autoBumpEnabled,
      bump_interval_hours: bumpIntervalHours,
      status: "failed",
      error_message: message,
    });

    if (failedInsertError) {
      console.error("[createPostAction] Failed to record 'failed' status in DB:", failedInsertError);
    }

    revalidatePath("/dashboard");
    return { error: message };
  }

  revalidatePath("/dashboard");
  return { success: true };
}

export async function toggleAutoBumpAction(
  postId: string,
  enabled: boolean
): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "המשתמש אינו מחובר." };

  const { data: existing } = await supabase
    .from("posts").select("id, status")
    .eq("id", postId).eq("user_id", user.id).maybeSingle();

  if (!existing) return { error: "הפוסט לא נמצא." };
  if (existing.status !== "published") return { error: "Auto-Bump זמין רק לפוסטים שפורסמו." };

  const { error: dbError } = await supabase
    .from("posts").update({ auto_bump_enabled: enabled }).eq("id", postId);

  if (dbError) return { error: "שגיאה בעדכון." };
  revalidatePath("/dashboard");
  return { success: true };
}

export async function updateBumpIntervalAction(
  postId: string,
  hours: number
): Promise<{ success?: boolean; error?: string }> {
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) {
    return { error: "המרווח חייב להיות מספר שלם בין 1 ל-168." };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "המשתמש אינו מחובר." };

  const { data: existing } = await supabase
    .from("posts").select("id, status")
    .eq("id", postId).eq("user_id", user.id).maybeSingle();

  if (!existing) return { error: "הפוסט לא נמצא." };
  if (existing.status !== "published") return { error: "עדכון מרווח זמין רק לפוסטים שפורסמו." };

  const { error: dbError } = await supabase
    .from("posts").update({ bump_interval_hours: hours }).eq("id", postId);

  if (dbError) return { error: "שגיאה בעדכון." };
  revalidatePath("/dashboard");
  return { success: true };
}
