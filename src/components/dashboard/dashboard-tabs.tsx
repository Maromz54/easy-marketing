"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Send, Link2, Puzzle, ListChecks, LayoutTemplate, RefreshCw, Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ConnectedPages } from "./connected-pages";
import { PostComposer } from "./post-composer";
import { PostsTable, type PostRow } from "./posts-table";
import { LinkForm } from "./link-form";
import { LinksTable, type LinkWithCount } from "./links-table";
import { ExtensionTab } from "./extension-tab";
import { DistributionListForm } from "./distribution-list-form";
import { DistributionListsTable } from "./distribution-lists-table";
import { TemplatesTab, type TemplateRow } from "./templates-tab";
import { requestGroupSyncAction } from "@/actions/sync";
import type { Database } from "@/lib/supabase/types";

type FbTokenRow = Database["public"]["Tables"]["facebook_tokens"]["Row"];
type DistributionListRow = Database["public"]["Tables"]["distribution_lists"]["Row"];
type FacebookGroupRow = Database["public"]["Tables"]["facebook_groups"]["Row"];

interface DashboardTabsProps {
  pages: FbTokenRow[];
  posts: PostRow[];
  fbError: string | null;
  fbSuccess: string | null;
  links: LinkWithCount[];
  appUrl: string;
  distributionLists: DistributionListRow[];
  facebookGroups: FacebookGroupRow[];
  templates: TemplateRow[];
}

export function DashboardTabs({
  pages,
  posts,
  fbError,
  fbSuccess,
  links,
  appUrl,
  distributionLists,
  facebookGroups,
  templates,
}: DashboardTabsProps) {
  const router = useRouter();

  const [editingPost, setEditingPost] = useState<PostRow | null>(null);

  const [editingListId, setEditingListId] = useState<string | null>(null);
  const editingList = distributionLists.find((l) => l.id === editingListId) ?? null;

  const [templateToLoad, setTemplateToLoad] = useState<TemplateRow | null>(null);
  const [draftToResume, setDraftToResume] = useState<PostRow | null>(null);
  const [activeTab, setActiveTab] = useState("posts");

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Build a group_id → name lookup for PostCard badges
  const groupNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const g of facebookGroups) m[g.group_id] = g.name;
    return m;
  }, [facebookGroups]);

  function handleEdit(post: PostRow) {
    setEditingPost(post);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleEditDone() {
    setEditingPost(null);
  }

  function handleUseTemplate(t: TemplateRow) {
    setTemplateToLoad(t);
    setActiveTab("posts");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleEditList(id: string) {
    setEditingListId(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleResumeDraft(post: PostRow) {
    setDraftToResume(post);
    setActiveTab("posts");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSyncGroups() {
    setIsSyncing(true);
    setSyncMessage("הסנכרון יתחיל בדקה הקרובה — ההרחבה תסרוק את הקבוצות שלך");
    const result = await requestGroupSyncAction();
    if (result.error) {
      setSyncMessage(`שגיאה: ${result.error}`);
      setIsSyncing(false);
      return;
    }
    let elapsed = 0;
    const poll = setInterval(() => {
      elapsed += 5000;
      if (elapsed >= 3 * 60 * 1000) {
        clearInterval(poll);
        setIsSyncing(false);
        setSyncMessage("הסנכרון לא הסתיים — ודא שהתוסף פעיל ורענן את הדף.");
        return;
      }
      router.refresh();
    }, 5000);
    setTimeout(() => {
      clearInterval(poll);
      setIsSyncing(false);
      setSyncMessage(null);
      router.refresh();
    }, 90_000);
  }

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-0">
      {/* ── Pill-shaped tab bar ──────────────────────────────────────── */}
      <TabsList className="w-full sm:w-auto flex-wrap h-auto gap-1 bg-slate-100/80 p-1 rounded-2xl border border-slate-200/60">
        <TabsTrigger
          value="posts"
          className="flex items-center gap-2 flex-1 sm:flex-none rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 transition-all duration-200 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm"
        >
          <Send className="h-4 w-4" />
          פרסום
        </TabsTrigger>
        <TabsTrigger
          value="links"
          className="flex items-center gap-2 flex-1 sm:flex-none rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 transition-all duration-200 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm"
        >
          <Link2 className="h-4 w-4" />
          קישורים
          {links.length > 0 && (
            <span className="ms-0.5 rounded-full bg-violet-100 text-violet-700 px-1.5 py-0.5 text-[10px] tabular-nums font-semibold leading-none">
              {links.length}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger
          value="lists"
          className="flex items-center gap-2 flex-1 sm:flex-none rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 transition-all duration-200 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm"
        >
          <ListChecks className="h-4 w-4" />
          תפוצה
          {distributionLists.length > 0 && (
            <span className="ms-0.5 rounded-full bg-violet-100 text-violet-700 px-1.5 py-0.5 text-[10px] tabular-nums font-semibold leading-none">
              {distributionLists.length}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger
          value="templates"
          className="flex items-center gap-2 flex-1 sm:flex-none rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 transition-all duration-200 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm"
        >
          <LayoutTemplate className="h-4 w-4" />
          תבניות
          {templates.length > 0 && (
            <span className="ms-0.5 rounded-full bg-violet-100 text-violet-700 px-1.5 py-0.5 text-[10px] tabular-nums font-semibold leading-none">
              {templates.length}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger
          value="extension"
          className="flex items-center gap-2 flex-1 sm:flex-none rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 transition-all duration-200 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm"
        >
          <Puzzle className="h-4 w-4" />
          תוסף
        </TabsTrigger>
      </TabsList>

      {/* ── Posts tab ───────────────────────────────────────────────── */}
      <TabsContent value="posts" className="space-y-8 mt-8">
        <ConnectedPages pages={pages} errorMessage={fbError} successMessage={fbSuccess} />
        <section className="space-y-5">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">
              {editingPost ? "עריכת פוסט" : "יצירת פוסט"}
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              {editingPost
                ? "ערוך את תוכן הפוסט המתוזמן לפני שיפורסם"
                : "כתוב פוסט ופרסם מיידית או תזמן לתאריך עתידי"}
            </p>
          </div>
          <PostComposer
            pages={pages}
            distributionLists={distributionLists}
            editingPost={editingPost}
            onEditDone={handleEditDone}
            templateToLoad={templateToLoad}
            onTemplateLoaded={() => setTemplateToLoad(null)}
            draftToResume={draftToResume}
            onDraftResumed={() => setDraftToResume(null)}
          />
        </section>
        <PostsTable
          posts={posts}
          onEdit={handleEdit}
          onResumeDraft={handleResumeDraft}
          groupNameMap={groupNameMap}
        />
      </TabsContent>

      {/* ── Links tab ───────────────────────────────────────────────── */}
      <TabsContent value="links" className="space-y-8 mt-8">
        <section className="space-y-5">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">יצירת קישור חדש</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              צור קישורים קצרים עם מעקב קליקים לוואטסאפ, דפי נחיתה ועוד
            </p>
          </div>
          <LinkForm appUrl={appUrl} />
        </section>
        <LinksTable links={links} appUrl={appUrl} />
      </TabsContent>

      {/* ── Distribution Lists tab ───────────────────────────────────── */}
      <TabsContent value="lists" className="space-y-8 mt-8">
        <section className="space-y-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">רשימות תפוצה</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                צור רשימות של קבוצות פייסבוק לפרסום מרובה בלחיצה אחת
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSyncGroups}
              disabled={isSyncing}
              className="shrink-0 rounded-xl border-slate-200 hover:bg-slate-50 transition-all duration-200"
            >
              {isSyncing ? (
                <Loader2 className="h-4 w-4 animate-spin ms-1.5" />
              ) : (
                <RefreshCw className="h-4 w-4 ms-1.5" />
              )}
              סנכרן קבוצות מ-Facebook
            </Button>
          </div>

          {syncMessage && (
            <div className="rounded-xl bg-blue-50/80 border border-blue-200/60 px-4 py-3 text-sm text-blue-700">
              {syncMessage}
            </div>
          )}

          {facebookGroups.length > 0 && (
            <p className="text-sm text-slate-500">
              {facebookGroups.length} קבוצות מסונכרנות — בחר אותן ישירות בטופס יצירת הרשימה למטה.
            </p>
          )}

          <DistributionListForm
            editingList={editingList}
            onEditDone={() => setEditingListId(null)}
            facebookGroups={facebookGroups}
          />
        </section>

        <DistributionListsTable
          lists={distributionLists}
          onEdit={handleEditList}
        />
      </TabsContent>

      {/* ── Templates tab ────────────────────────────────────────────── */}
      <TabsContent value="templates" className="space-y-6 mt-8">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">תבניות פוסטים</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            שמור תכנים שבנית לשימוש חוזר. לחץ &quot;שמור כתבנית&quot; בעורך הפוסטים.
          </p>
        </div>
        <TemplatesTab templates={templates} onUseTemplate={handleUseTemplate} />
      </TabsContent>

      {/* ── Extension tab ────────────────────────────────────────────── */}
      <TabsContent value="extension" className="mt-8">
        <ExtensionTab appUrl={appUrl} />
      </TabsContent>
    </Tabs>
  );
}
