import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logoutAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { DashboardTabs } from "@/components/dashboard/dashboard-tabs";
import type { Database } from "@/lib/supabase/types";
import type { PostRow } from "@/components/dashboard/posts-table";
import type { LinkWithCount } from "@/components/dashboard/links-table";
import { BarChart3, CalendarClock, Link2, LogOut, MousePointerClick } from "lucide-react";

export const metadata: Metadata = {
  title: "לוח בקרה | EasyMarketing",
};

import type { TemplateRow } from "@/components/dashboard/templates-tab";

type FbTokenRow = Database["public"]["Tables"]["facebook_tokens"]["Row"];
type DistributionListRow = Database["public"]["Tables"]["distribution_lists"]["Row"];
type FacebookGroupRow = Database["public"]["Tables"]["facebook_groups"]["Row"];

interface DashboardPageProps {
  searchParams: { fb_error?: string; fb_success?: string };
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // ── Parallel data fetching ─────────────────────────────────────────────
  const { data: profileData } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();
  const profile = profileData as { full_name: string | null } | null;

  const { data: pagesData } = await supabase
    .from("facebook_tokens")
    .select("id, user_id, page_id, page_name, access_token, token_expires_at, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  const pages = (pagesData ?? []) as FbTokenRow[];

  const { data: postsData } = await supabase
    .from("posts")
    .select(
      "id, content, status, target_id, scheduled_at, published_at, created_at, error_message, facebook_post_id, recurrence_rule, auto_bump_enabled, bump_interval_hours, last_bumped_at, batch_id, facebook_tokens(page_name)"
    )
    .eq("user_id", user.id)
    .eq("is_template", false)
    .order("created_at", { ascending: false })
    .limit(500);
  const posts = (postsData ?? []) as PostRow[];

  const { data: linksData } = await supabase
    .from("links")
    .select("id, slug, destination, label, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);
  const rawLinks = (linksData ?? []) as Array<{
    id: string; slug: string; destination: string;
    label: string | null; created_at: string;
  }>;

  const linkIds = rawLinks.map((l) => l.id);
  const { data: clicksData } =
    linkIds.length > 0
      ? await supabase
          .from("link_clicks")
          .select("link_id")
          .in("link_id", linkIds)
      : { data: [] as Array<{ link_id: string }> };

  const clickCountMap = new Map<string, number>();
  (clicksData ?? []).forEach(({ link_id }) => {
    clickCountMap.set(link_id, (clickCountMap.get(link_id) ?? 0) + 1);
  });

  const links: LinkWithCount[] = rawLinks.map((link) => ({
    ...link,
    clickCount: clickCountMap.get(link.id) ?? 0,
  }));

  const { data: listsData } = await supabase
    .from("distribution_lists")
    .select("id, user_id, name, group_ids, created_at, updated_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(200);
  const distributionLists = (listsData ?? []) as DistributionListRow[];

  const { data: groupsData } = await supabase
    .from("facebook_groups")
    .select("id, user_id, group_id, name, icon_url, synced_at")
    .eq("user_id", user.id)
    .order("name");
  const facebookGroups = (groupsData ?? []) as FacebookGroupRow[];

  const { data: templatesData } = await supabase
    .from("posts")
    .select("id, content, image_urls, link_url, created_at")
    .eq("user_id", user.id)
    .eq("is_template", true)
    .order("created_at", { ascending: false })
    .limit(50);
  const templates = (templatesData ?? []) as TemplateRow[];

  // ── Derived stats ──────────────────────────────────────────────────────
  const displayName = profile?.full_name ?? user.email ?? "משתמש";
  const scheduledCount = posts.filter((p) => p.status === "scheduled").length;
  const publishedCount = posts.filter((p) => p.status === "published").length;
  const totalClicks = links.reduce((sum, l) => sum + l.clickCount, 0);

  const fbError = searchParams.fb_error ?? null;
  const fbSuccess = searchParams.fb_success ?? null;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100/80 flex flex-col">

      {/* ── Header ────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-slate-200/60 px-6 py-3.5 flex items-center justify-between">
        <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
          EasyMarketing
        </span>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500 hidden sm:block">
            {displayName}
          </span>
          <form action={logoutAction}>
            <Button
              variant="ghost"
              size="sm"
              type="submit"
              className="text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all duration-200"
            >
              <LogOut className="h-4 w-4 me-1.5" />
              התנתקות
            </Button>
          </form>
        </div>
      </header>

      {/* ── Main ──────────────────────────────────────────────────────── */}
      <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto w-full space-y-8">

        {/* Welcome */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">לוח בקרה</h1>
          <p className="text-slate-500 mt-1">ברוך הבא בחזרה, {displayName}!</p>
        </div>

        {/* ── Stats ─────────────────────────────────────────────────── */}
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={<CalendarClock className="h-5 w-5" />}
            iconBg="bg-blue-50 text-blue-600"
            label="פוסטים מתוזמנים"
            value={String(scheduledCount)}
            hint={scheduledCount === 0 ? "אין ממתינים" : "ממתינים לפרסום"}
          />
          <StatCard
            icon={<BarChart3 className="h-5 w-5" />}
            iconBg="bg-emerald-50 text-emerald-600"
            label="פוסטים שפורסמו"
            value={String(publishedCount)}
            hint={publishedCount === 0 ? "טרם פורסמו" : "פורסמו בהצלחה"}
          />
          <StatCard
            icon={<Link2 className="h-5 w-5" />}
            iconBg="bg-violet-50 text-violet-600"
            label="קישורים פעילים"
            value={String(links.length)}
            hint={links.length === 0 ? "אין קישורים עדיין" : "קישורים במעקב"}
          />
          <StatCard
            icon={<MousePointerClick className="h-5 w-5" />}
            iconBg="bg-amber-50 text-amber-600"
            label='סה"כ קליקים'
            value={totalClicks.toLocaleString("he-IL")}
            hint={totalClicks === 0 ? "אין קליקים עדיין" : "קליקים על קישורים"}
          />
        </div>

        {/* ── Tabbed content ────────────────────────────────────────── */}
        <DashboardTabs
          pages={pages}
          posts={posts}
          fbError={fbError}
          fbSuccess={fbSuccess}
          links={links}
          appUrl={appUrl}
          distributionLists={distributionLists}
          facebookGroups={facebookGroups}
          templates={templates}
        />

      </main>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({
  icon, iconBg, label, value, hint,
}: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="group bg-white rounded-2xl border border-slate-200/60 shadow-[0_1px_3px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.06)] hover:-translate-y-0.5 transition-all duration-300 ease-out p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs sm:text-sm font-medium text-slate-500 leading-tight">
          {label}
        </span>
        <div className={`h-9 w-9 rounded-xl flex items-center justify-center ${iconBg} transition-transform duration-300 group-hover:scale-110`}>
          {icon}
        </div>
      </div>
      <p className="text-2xl sm:text-3xl font-bold tabular-nums text-slate-900">{value}</p>
      <p className="text-xs text-slate-400 mt-1">{hint}</p>
    </div>
  );
}
