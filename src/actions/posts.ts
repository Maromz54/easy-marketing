"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { publishToPage } from "@/lib/facebook";

export interface CreatePostInput {
  facebookTokenId: string;
  /** Optional override: Group ID or any Page ID where this Page is an admin.
   *  If omitted, defaults to the Page's own page_id. */
  targetId?: string;
  content: string;
  imageUrl?: string;
  linkUrl?: string;
  publishMode: "now" | "scheduled";
  scheduledAt?: string;
}

export interface CreatePostResult {
  success?: boolean;
  error?: string;
}

export async function createPostAction(
  input: CreatePostInput
): Promise<CreatePostResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "המשתמש אינו מחובר." };

  // ── Validate the token belongs to this user ────────────────────────────
  const { data: tokenData } = await supabase
    .from("facebook_tokens")
    .select("id, page_id, access_token")
    .eq("id", input.facebookTokenId)
    .eq("user_id", user.id)
    .single();

  if (!tokenData) {
    return { error: "דף הפייסבוק לא נמצא או שאין לך הרשאה אליו." };
  }

  const token = tokenData as { id: string; page_id: string; access_token: string };

  // targetId: explicit override or fall back to the page's own ID
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
