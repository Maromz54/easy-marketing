import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logoutAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  // Note: We use sequential calls with explicit column lists to work around
  // Supabase v2.99 type inference limitations with wildcard selects.

  // Profile
  const { data: profileData } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();
  const profile = profileData as { full_name: string | null } | null;

  // Connected Facebook pages
  const { data: pagesData } = await supabase
    .from("facebook_tokens")
    .select("id, user_id, page_id, page_name, access_token, token_expires_at, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  const pages = (pagesData ?? []) as FbTokenRow[];

  // Posts (last 50)
  const { data: postsData } = await supabase
    .from("posts")
    .select(
      "id, content, status, scheduled_at, published_at, created_at, error_message, facebook_post_id, facebook_tokens(page_name)"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  const posts = (postsData ?? []) as PostRow[];

  // Links
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

  // Click counts — one query for all links, then aggregate in JS
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

  // Distribution lists
  const { data: listsData } = await supabase
    .from("distribution_lists")
    .select("id, user_id, name, group_ids, created_at, updated_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(200);
  const distributionLists = (listsData ?? []) as DistributionListRow[];

  // Synced Facebook groups
  const { data: groupsData } = await supabase
    .from("facebook_groups")
    .select("id, user_id, group_id, name, icon_url, synced_at")
    .eq("user_id", user.id)
    .order("name");
  const facebookGroups = (groupsData ?? []) as FacebookGroupRow[];

  // Templates (posts with is_template=true)
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

  // APP_URL for short link display (fallback for local dev)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return (
    <div className="min-h-screen bg-muted/30 flex flex-col">

      {/* ── Header ────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 bg-background border-b px-6 py-3 flex items-center justify-between shadow-sm">
        <span className="text-xl font-bold text-primary">EasyMarketing</span>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground hidden sm:block">
            שלום, {displayName}
          </span>
          <form action={logoutAction}>
            <Button variant="outline" size="sm" type="submit">
              <LogOut className="h-4 w-4 me-1" />
              התנתקות
            </Button>
          </form>
        </div>
      </header>

      {/* ── Main ──────────────────────────────────────────────────────── */}
      <main className="flex-1 p-6 max-w-6xl mx-auto w-full space-y-8">

        {/* Welcome */}
        <div>
          <h1 className="text-3xl font-bold">לוח בקרה</h1>
          <p className="text-muted-foreground mt-1">ברוך הבא בחזרה, {displayName}!</p>
        </div>

        {/* ── Stats ─────────────────────────────────────────────────── */}
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={<CalendarClock className="h-5 w-5 text-blue-500" />}
            label="פוסטים מתוזמנים"
            value={String(scheduledCount)}
            hint={scheduledCount === 0 ? "אין ממתינים" : "ממתינים לפרסום"}
          />
          <StatCard
            icon={<BarChart3 className="h-5 w-5 text-green-500" />}
            label="פוסטים שפורסמו"
            value={String(publishedCount)}
            hint={publishedCount === 0 ? "טרם פורסמו" : "פורסמו בהצלחה"}
          />
          <StatCard
            icon={<Link2 className="h-5 w-5 text-purple-500" />}
            label="קישורים פעילים"
            value={String(links.length)}
            hint={links.length === 0 ? "אין קישורים עדיין" : "קישורים במעקב"}
          />
          <StatCard
            icon={<MousePointerClick className="h-5 w-5 text-orange-500" />}
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
  icon, label, value, hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground leading-tight">
          {label}
        </CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <p className="text-2xl sm:text-3xl font-bold tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{hint}</p>
      </CardContent>
    </Card>
  );
}
