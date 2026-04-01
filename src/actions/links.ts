"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";

export interface CreateLinkInput {
  destination: string;
  label?: string;
  customSlug?: string;
}

export interface CreateLinkResult {
  success?: boolean;
  slug?: string;
  error?: string;
}

/** Generates a random URL-safe slug, e.g. "aB3x9r" */
function generateSlug(): string {
  // base64url gives [A-Za-z0-9_-]; 4 random bytes → 6 usable chars
  return randomBytes(4).toString("base64url").slice(0, 6);
}

/** Slug validation: 2-50 chars, lowercase letters, digits, hyphen, underscore */
const SLUG_RE = /^[a-z0-9_-]{2,50}$/;

export async function createLinkAction(
  input: CreateLinkInput
): Promise<CreateLinkResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "המשתמש אינו מחובר." };

  // ── Validate destination ───────────────────────────────────────────────
  let destination = input.destination.trim();
  if (!destination) return { error: "כתובת היעד היא שדה חובה." };

  // Auto-prepend https:// if no protocol given
  if (!/^https?:\/\//i.test(destination)) {
    destination = `https://${destination}`;
  }
  try {
    new URL(destination); // throws if still invalid
  } catch {
    return { error: "כתובת היעד אינה תקינה. ודא שהיא מתחילה ב-https://" };
  }

  // ── Determine slug ─────────────────────────────────────────────────────
  const isCustom = Boolean(input.customSlug?.trim());
  let slug = (isCustom ? input.customSlug!.trim() : generateSlug()).toLowerCase();

  if (!SLUG_RE.test(slug)) {
    return {
      error:
        "הסיומת יכולה להכיל רק אותיות באנגלית קטנות, מספרים, מקף (-) ו-underscore (_), באורך 2–50 תווים.",
    };
  }

  // ── Check uniqueness ────────────────────────────────────────────────────
  const { data: existing } = await supabase
    .from("links")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (existing) {
    if (isCustom) {
      return { error: `הסיומת "${slug}" כבר תפוסה. אנא בחר סיומת אחרת.` };
    }
    // Auto-generated collision (very rare with 64^6 space) — retry once
    slug = generateSlug().toLowerCase();
    const { data: existingRetry } = await supabase
      .from("links")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (existingRetry) {
      return { error: "אירעה שגיאה ביצירת הסיומת האוטומטית. אנא נסה שוב." };
    }
  }

  // ── Save ────────────────────────────────────────────────────────────────
  const { error: dbError } = await supabase.from("links").insert({
    user_id: user.id,
    slug,
    destination,
    label: input.label?.trim() || null,
  });

  if (dbError) {
    console.error("[createLinkAction] DB error:", dbError);
    // Unique constraint violation (race condition)
    if (dbError.code === "23505") {
      return { error: `הסיומת "${slug}" כבר תפוסה. אנא בחר סיומת אחרת.` };
    }
    return { error: "שגיאה בשמירת הקישור. אנא נסה שוב." };
  }

  revalidatePath("/dashboard");
  return { success: true, slug };
}

export async function deleteLinkAction(
  linkId: string
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "המשתמש אינו מחובר." };

  const { data: existing } = await supabase
    .from("links").select("id").eq("id", linkId).eq("user_id", user.id).maybeSingle();
  if (!existing) return { error: "הקישור לא נמצא." };

  // Delete related clicks first (FK constraint)
  await supabase.from("link_clicks").delete().eq("link_id", linkId);
  const { error } = await supabase.from("links").delete().eq("id", linkId);
  if (error) return { error: "שגיאה במחיקת הקישור." };

  revalidatePath("/dashboard");
  return {};
}
