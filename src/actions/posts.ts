"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { publishToPage } from "@/lib/facebook";

export interface CreatePostInput {
  /** When omitted the post is queued for the Chrome Extension (no Graph API call). */
  facebookTokenId?: string;
  /** Group ID or alternate Page ID. Required for extension-only posts. */
  targetId?: string;
  /** When set, ignore targetId and fan out to every group in the distribution list. */
  distributionListId?: string;
  content: string;
  imageUrl?: string;
  linkUrl?: string;
  publishMode: "now" | "scheduled";
  scheduledAt?: string;
}

export interface CreatePostResult {
  success?: boolean;
  error?: string;
  /** Number of posts created (> 1 for distribution list fan-out). */
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
  imageUrl?: string;
  linkUrl?: string;
  publishMode: "now" | "scheduled";
  scheduledAt?: string;
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

  // Verify ownership and that the post is still cancellable.
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

  const { error: dbError } = await supabase
    .from("posts")
    .update({
      content: input.content,
      target_id: input.targetId?.trim() || null,
      image_url: input.imageUrl || null,
      link_url: input.linkUrl || null,
      scheduled_at: scheduledAt,
    })
    .eq("id", input.postId);

  if (dbError) {
    console.error("[updatePostAction] DB error:", dbError);
    return { error: "שגיאה בעדכון הפוסט. אנא נסה שוב." };
  }

  revalidatePath("/dashboard");
  return { success: true };
}

export async function createPostAction(
  input: CreatePostInput
): Promise<CreatePostResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "המשתמש אינו מחובר." };

  const hasToken = !!input.facebookTokenId?.trim();

  // ── Distribution list fan-out ──────────────────────────────────────────
  // Checked before the single-target branches. Creates one post per group_id
  // with a random 2–5 minute anti-ban delay between each.
  if (input.distributionListId) {
    const { data: listData } = await supabase
      .from("distribution_lists")
      .select("id, group_ids")
      .eq("id", input.distributionListId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!listData) {
      return { error: "רשימת התפוצה לא נמצאה או שאין לך הרשאה אליה." };
    }

    const groupIds: string[] = listData.group_ids;
    if (groupIds.length === 0) {
      return { error: "רשימת התפוצה ריקה — הוסף מזהי קבוצות לפני הפרסום." };
    }

    const baseTime =
      input.publishMode === "scheduled" && input.scheduledAt
        ? new Date(input.scheduledAt)
        : new Date();

    // Build cumulative delays: delays[0]=0, delays[i]=delays[i-1]+rand(120,300)
    const delays: number[] = [0];
    for (let i = 1; i < groupIds.length; i++) {
      delays.push(delays[i - 1] + Math.floor(Math.random() * 181) + 120);
    }

    const rows = groupIds.map((groupId, i) => ({
      user_id: user.id,
      facebook_token_id: null,
      target_id: groupId,
      content: input.content,
      image_url: input.imageUrl || null,
      link_url: input.linkUrl || null,
      status: "scheduled" as const,
      scheduled_at: new Date(baseTime.getTime() + delays[i] * 1000).toISOString(),
    }));

    const { error: dbError } = await supabase.from("posts").insert(rows);
    if (dbError) {
      console.error("[createPostAction] DB insert error (distribution list):", dbError);
      return { error: "שגיאה בשמירת הפוסטים. אנא נסה שוב." };
    }

    revalidatePath("/dashboard");
    return { success: true, count: rows.length };
  }

  // ── Extension-only mode (no Facebook Page token) ───────────────────────
  // Save as 'scheduled' so the Chrome Extension can pick it up.
  // For "now" mode we set scheduled_at = NOW() so the extension claims it
  // within the next polling cycle (≤ 1 minute).
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
      image_url: input.imageUrl || null,
      link_url: input.linkUrl || null,
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
      image_url: input.imageUrl || null,
      link_url: input.linkUrl || null,
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
      picture: input.imageUrl || undefined,
    });

    const { error: dbError } = await supabase.from("posts").insert({
      user_id: user.id,
      facebook_token_id: input.facebookTokenId,
      target_id: targetId,
      content: input.content,
      image_url: input.imageUrl || null,
      link_url: input.linkUrl || null,
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
      image_url: input.imageUrl || null,
      link_url: input.linkUrl || null,
      status: "failed",
      error_message: message,
    });

    revalidatePath("/dashboard");
    return { error: message };
  }

  revalidatePath("/dashboard");
  return { success: true };
}
