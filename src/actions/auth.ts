"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// ── Login ────────────────────────────────────────────────────────────────────
export async function loginAction(formData: { email: string; password: string }) {
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: formData.email,
    password: formData.password,
  });

  if (error) {
    // Map common Supabase errors to Hebrew messages
    if (error.message.includes("Invalid login credentials")) {
      return { error: "כתובת האימייל או הסיסמה שגויים. אנא נסה שוב." };
    }
    if (error.message.includes("Email not confirmed")) {
      return { error: "האימייל עדיין לא אומת. אנא בדוק את תיבת הדואר שלך." };
    }
    return { error: "אירעה שגיאה בהתחברות. אנא נסה שוב מאוחר יותר." };
  }

  redirect("/dashboard");
}

// ── Register (DISABLED — single-user internal tool) ──────────────────────────
// To create your account: Supabase Dashboard → Authentication → Users → Add User
export async function registerAction(_formData: {
  fullName: string;
  email: string;
  password: string;
}) {
  return { error: "ההרשמה אינה זמינה. מערכת זו היא כלי פנימי.", success: false };
}

// ── Logout ────────────────────────────────────────────────────────────────────
export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
