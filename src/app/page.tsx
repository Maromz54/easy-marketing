import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BarChart3, CalendarClock, Link2, ArrowLeft } from "lucide-react";

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Navigation Header ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b px-6 py-4 flex items-center justify-between">
        <span className="text-xl font-bold text-primary">EasyMarketing</span>
        <nav className="flex items-center gap-3">
          <Button asChild>
            <Link href="/login">התחברות</Link>
          </Button>
        </nav>
      </header>

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <main className="flex-1">
        <section className="flex flex-col items-center justify-center text-center py-24 px-6 gap-6">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 text-primary px-4 py-1.5 text-sm font-medium">
            ✨ פלטפורמת השיווק החכמה שלך
          </div>
          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight max-w-3xl leading-tight">
            נהל את השיווק שלך{" "}
            <span className="text-primary">בקלות ובמהירות</span>
          </h1>
          <p className="text-muted-foreground text-lg max-w-xl leading-relaxed">
            תזמן פוסטים לפייסבוק, צור קישורים עם מעקב, וקבל אנליטיקס בזמן אמת —
            הכול ממקום אחד.
          </p>
          <Button size="lg" asChild>
            <Link href="/login">
              כניסה למערכת
              <ArrowLeft className="me-2 h-4 w-4" />
            </Link>
          </Button>
        </section>

        {/* ── Features ──────────────────────────────────────────────────── */}
        <section className="py-16 px-6 bg-muted/30">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-center mb-10">מה תוכל לעשות?</h2>
            <div className="grid sm:grid-cols-3 gap-6">
              <FeatureCard
                icon={<CalendarClock className="h-8 w-8 text-blue-500" />}
                title="תזמון פוסטים"
                description="כתוב פוסטים וקבע תאריך ושעה לפרסום אוטומטי בפייסבוק."
              />
              <FeatureCard
                icon={<Link2 className="h-8 w-8 text-purple-500" />}
                title="קישורים חכמים"
                description="צור קישורים קצרים עם הפניה לוואטסאפ או כל יעד אחר."
              />
              <FeatureCard
                icon={<BarChart3 className="h-8 w-8 text-green-500" />}
                title="אנליטיקס"
                description="עקוב אחר קליקים, תאריכים ומדדים בזמן אמת."
              />
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="py-6 text-center text-sm text-muted-foreground border-t">
        © {new Date().getFullYear()} EasyMarketing. כל הזכויות שמורות.
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center text-center gap-3 rounded-xl border bg-background p-6 shadow-sm">
      {icon}
      <h3 className="font-semibold text-lg">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
    </div>
  );
}
