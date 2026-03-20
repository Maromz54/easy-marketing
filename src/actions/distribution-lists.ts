"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// ── Interfaces ─────────────────────────────────────────────────────────────────

export interface CreateDistributionListInput {
  name: string;
  groupIds: string[];
}

export interface CreateDistributionListResult {
  success?: boolean;
  error?: string;
  id?: string;
}

export interface DeleteDistributionListResult {
  success?: boolean;
  error?: string;
}

// ── createDistributionListAction ───────────────────────────────────────────────

export async function createDistributionListAction(
  input: CreateDistributionListInput
): Promise<CreateDistributionListResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "המשתמש אינו מחובר." };

  const name = input.name.trim();
  if (!name) return { error: "שם הרשימה הוא חובה." };
  if (name.length > 100) return { error: "שם הרשימה ארוך מדי (מקסימום 100 תווים)." };

  const deduped = [...new Set(input.groupIds.map((id) => id.trim()).filter(Boolean))];

  if (deduped.length === 0) return { error: "יש להזין לפחות מזהה קבוצה אחד." };
  if (deduped.length > 50) return { error: "ניתן להוסיף עד 50 קבוצות לרשימה." };
  if (deduped.some((id) => !/^\d+$/.test(id))) {
    return { error: "כל מזהה קבוצה חייב להיות מספרי בלבד." };
  }

  const { data, error: dbError } = await supabase
    .from("distribution_lists")
    .insert({ user_id: user.id, name, group_ids: deduped })
    .select("id")
    .single();

  if (dbError) {
    console.error("[createDistributionListAction] DB error:", dbError);
    return { error: "שגיאה בשמירת הרשימה. אנא נסה שוב." };
  }

  revalidatePath("/dashboard");
  return { success: true, id: data.id };
}

// ── deleteDistributionListAction ───────────────────────────────────────────────

export async function deleteDistributionListAction(
  listId: string
): Promise<DeleteDistributionListResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "המשתמש אינו מחובר." };

  const { data: existing } = await supabase
    .from("distribution_lists")
    .select("id")
    .eq("id", listId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!existing) {
    return { error: "הרשימה לא נמצאה או שאין לך הרשאה למחוק אותה." };
  }

  const { error: dbError } = await supabase
    .from("distribution_lists")
    .delete()
    .eq("id", listId);

  if (dbError) {
    console.error("[deleteDistributionListAction] DB error:", dbError);
    return { error: "שגיאה במחיקת הרשימה. אנא נסה שוב." };
  }

  revalidatePath("/dashboard");
  return { success: true };
}
