"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface RequestGroupSyncResult {
  success?: boolean;
  error?: string;
}

export async function requestGroupSyncAction(): Promise<RequestGroupSyncResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "המשתמש אינו מחובר." };

  // Cancel any existing pending sync jobs for this user
  await supabase
    .from("sync_jobs")
    .delete()
    .eq("user_id", user.id)
    .eq("status", "pending");

  const { error: dbError } = await supabase
    .from("sync_jobs")
    .insert({ user_id: user.id, type: "facebook_groups", status: "pending" });

  if (dbError) {
    console.error("[requestGroupSyncAction] DB error:", dbError);
    return { error: "שגיאה ביצירת בקשת הסנכרון. אנא נסה שוב." };
  }

  revalidatePath("/dashboard");
  return { success: true };
}
