"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, Link2, Puzzle, ListChecks, LayoutTemplate, RefreshCw, Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
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
import { cancelPostAction } from "@/actions/posts";
import { requestGroupSyncAction } from "@/actions/sync";
import type { Database } from "@/lib/supabase/types";

type FbTokenRow = Database["public"]["Tables"]["facebook_tokens"]["Row"];
type DistributionListRow = Database["public"]["Tables"]["distribution_lists"]["Row"];
type FacebookGroupRow = Database["public"]["Tables"]["facebook_groups"]["Row"];

interface DashboardTabsProps {
  // Posts tab
  pages: FbTokenRow[];
  posts: PostRow[];
  fbError: string | null;
  fbSuccess: string | null;
  // Links tab
  links: LinkWithCount[];
  appUrl: string;
  // Distribution lists tab
  distributionLists: DistributionListRow[];
  facebookGroups: FacebookGroupRow[];
  // Templates tab
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

  // Post editing
  const [editingPost, setEditingPost] = useState<PostRow | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [, startCancelTransition] = useTransition();

  // Distribution list editing
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const editingList = distributionLists.find((l) => l.id === editingListId) ?? null;

  // Template loading into composer
  const [templateToLoad, setTemplateToLoad] = useState<TemplateRow | null>(null);
  const [activeTab, setActiveTab] = useState("posts");

  // Sync state
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  function handleEdit(post: PostRow) {
    setEditingPost(post);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleCancelPost(postId: string) {
    setCancellingId(postId);
    startCancelTransition(async () => {
      await cancelPostAction(postId);
      setCancellingId(null);
    });
  }

  function handleEditDone() {
    setEditingPost(null);
  }

  function handleUseTemplate(t: TemplateRow) {
    setTemplateToLoad(t);
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
    // Poll every 5 seconds for up to 3 minutes for the sync job to complete
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
    // Stop the spinner once we detect new groups (router.refresh re-renders with new data)
    // We stop after 90 s as a reasonable timeout if data doesn't visibly change
    setTimeout(() => {
      clearInterval(poll);
      setIsSyncing(false);
      setSyncMessage(null);
      router.refresh();
    }, 90_000);
  }

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-0">
      {/* ── Tab bar ─────────────────────────────────────────────────── */}
      <TabsList className="w-full sm:w-auto flex-wrap h-auto gap-1">
        <TabsTrigger value="posts" className="flex items-center gap-2 flex-1 sm:flex-none">
          <Send className="h-4 w-4" />
          פרסום פוסטים
        </TabsTrigger>
        <TabsTrigger value="links" className="flex items-center gap-2 flex-1 sm:flex-none">
          <Link2 className="h-4 w-4" />
          ניהול קישורים
          {links.length > 0 && (
            <span className="ms-1 rounded-full bg-primary/15 text-primary px-1.5 py-0.5 text-xs tabular-nums">
              {links.length}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="lists" className="flex items-center gap-2 flex-1 sm:flex-none">
          <ListChecks className="h-4 w-4" />
          רשימות תפוצה
          {distributionLists.length > 0 && (
            <span className="ms-1 rounded-full bg-primary/15 text-primary px-1.5 py-0.5 text-xs tabular-nums">
              {distributionLists.length}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="templates" className="flex items-center gap-2 flex-1 sm:flex-none">
          <LayoutTemplate className="h-4 w-4" />
          תבניות
          {templates.length > 0 && (
            <span className="ms-1 rounded-full bg-primary/15 text-primary px-1.5 py-0.5 text-xs tabular-nums">
              {templates.length}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="extension" className="flex items-center gap-2 flex-1 sm:flex-none">
          <Puzzle className="h-4 w-4" />
          חיבור תוסף
        </TabsTrigger>
      </TabsList>

      {/* ── Posts tab ───────────────────────────────────────────────── */}
      <TabsContent value="posts" className="space-y-8 mt-6">
        <ConnectedPages pages={pages} errorMessage={fbError} successMessage={fbSuccess} />
        <Separator />
        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">
              {editingPost ? "עריכת פוסט" : "יצירת פוסט"}
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
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
          />
        </section>
        <Separator />
        <PostsTable
          posts={posts}
          onEdit={handleEdit}
          onCancel={handleCancelPost}
          cancellingId={cancellingId}
        />
      </TabsContent>

      {/* ── Links tab ───────────────────────────────────────────────── */}
      <TabsContent value="links" className="space-y-8 mt-6">
        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">יצירת קישור חדש</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              צור קישורים קצרים עם מעקב קליקים לוואטסאפ, דפי נחיתה ועוד
            </p>
          </div>
          <LinkForm appUrl={appUrl} />
        </section>
        <Separator />
        <LinksTable links={links} appUrl={appUrl} />
      </TabsContent>

      {/* ── Distribution Lists tab ───────────────────────────────────── */}
      <TabsContent value="lists" className="space-y-8 mt-6">
        <section className="space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-xl font-semibold">רשימות תפוצה</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                צור רשימות של קבוצות פייסבוק לפרסום מרובה בלחיצה אחת
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSyncGroups}
              disabled={isSyncing}
              className="shrink-0"
            >
              {isSyncing ? (
                <Loader2 className="h-4 w-4 animate-spin ms-1" />
              ) : (
                <RefreshCw className="h-4 w-4 ms-1" />
              )}
              סנכרן קבוצות מ-Facebook
            </Button>
          </div>

          {syncMessage && (
            <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
              {syncMessage}
            </div>
          )}

          {facebookGroups.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {facebookGroups.length} קבוצות מסונכרנות — בחר אותן ישירות בטופס יצירת הרשימה למטה.
            </p>
          )}

          <DistributionListForm
            editingList={editingList}
            onEditDone={() => setEditingListId(null)}
            facebookGroups={facebookGroups}
          />
        </section>

        <Separator />

        <DistributionListsTable
          lists={distributionLists}
          onEdit={(id) => setEditingListId(id)}
        />
      </TabsContent>

      {/* ── Templates tab ────────────────────────────────────────────── */}
      <TabsContent value="templates" className="space-y-6 mt-6">
        <div>
          <h2 className="text-xl font-semibold">תבניות פוסטים</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            שמור תכנים שבנית לשימוש חוזר. לחץ "שמור כתבנית" בעורך הפוסטים.
          </p>
        </div>
        <TemplatesTab templates={templates} onUseTemplate={handleUseTemplate} />
      </TabsContent>

      {/* ── Extension tab ────────────────────────────────────────────── */}
      <TabsContent value="extension" className="mt-6">
        <ExtensionTab appUrl={appUrl} />
      </TabsContent>
    </Tabs>
  );
}
