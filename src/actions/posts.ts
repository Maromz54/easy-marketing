"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { publishToPage } from "@/lib/facebook";

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

    console.log("[createPostAction] uniqueGroupIds:", uniqueGroupIds);

    if (uniqueGroupIds.length === 0) {
      return { error: "לא נמצאו מזהי קבוצות תקינים. בדוק את הרשימות והמזהים הידניים." };
    }

    const baseTime =
      input.publishMode === "scheduled" && input.scheduledAt
        ? new Date(input.scheduledAt)
        : new Date();

    // Cumulative anti-ban delays: 0 s, then +120–300 s per post
    const delays: number[] = [0];
    for (let i = 1; i < uniqueGroupIds.length; i++) {
      delays.push(delays[i - 1] + Math.floor(Math.random() * 181) + 120);
    }

    const rows = uniqueGroupIds.map((groupId, i) => ({
      user_id: user.id,
      facebook_token_id: null,
      target_id: groupId,
      content: input.content,
      image_urls: input.imageUrls ?? [],
      link_url: input.linkUrl || null,
      recurrence_rule: recurrenceRule,
      status: "scheduled" as const,
      scheduled_at: new Date(baseTime.getTime() + delays[i] * 1000).toISOString(),
    }));

    const { error: dbError } = await supabase.from("posts").insert(rows);
    if (dbError) {
      console.error("[createPostAction] DB insert error (fan-out):", dbError);
      return { error: "שגיאה בשמירת הפוסטים. אנא נסה שוב." };
    }

    revalidatePath("/dashboard");
    return { success: true, count: rows.length };
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
      content: input.content,
      image_urls: input.imageUrls ?? [],
      link_url: input.linkUrl || null,
      recurrence_rule: recurrenceRule,
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
    .single();

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
      content: input.content,
      image_urls: input.imageUrls ?? [],
      link_url: input.linkUrl || null,
      recurrence_rule: recurrenceRule,
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
  try {
    const facebookPostId = await publishToPage(targetId, token.access_token, {
      message: input.content,
      link: input.linkUrl || undefined,
      picture: input.imageUrls?.[0] || undefined,
    });

    const { error: dbError } = await supabase.from("posts").insert({
      user_id: user.id,
      facebook_token_id: input.facebookTokenId,
      target_id: targetId,
      content: input.content,
      image_urls: input.imageUrls ?? [],
      link_url: input.linkUrl || null,
      recurrence_rule: recurrenceRule,
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

    await supabase.from("posts").insert({
      user_id: user.id,
      facebook_token_id: input.facebookTokenId,
      target_id: targetId,
      content: input.content,
      image_urls: input.imageUrls ?? [],
      link_url: input.linkUrl || null,
      recurrence_rule: recurrenceRule,
      status: "failed",
      error_message: message,
    });

    revalidatePath("/dashboard");
    return { error: message };
  }

  revalidatePath("/dashboard");
  return { success: true };
}
