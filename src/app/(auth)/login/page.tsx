import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "התחברות | EasyMarketing",
  description: "התחבר לחשבון ה-EasyMarketing שלך",
};

export default function LoginPage() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
      <header className="px-6 py-4 border-b">
        <Link href="/" className="text-xl font-bold text-primary">
          EasyMarketing
        </Link>
      </header>

      {/* Centered form */}
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <LoginForm />
      </main>

      <footer className="py-4 text-center text-xs text-muted-foreground border-t">
        © {new Date().getFullYear()} EasyMarketing. כל הזכויות שמורות.
      </footer>
    </div>
  );
}
