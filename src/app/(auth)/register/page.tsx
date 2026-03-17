import { redirect } from "next/navigation";

/**
 * Registration is disabled — this is a single-user internal tool.
 * Create your account manually in Supabase Auth → Users → Invite User.
 */
export default function RegisterPage() {
  redirect("/login");
}
