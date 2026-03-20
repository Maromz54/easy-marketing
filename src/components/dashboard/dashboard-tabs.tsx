"use client";

import { useState, useTransition } from "react";
import { Send, Link2, Puzzle, ListChecks } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { ConnectedPages } from "./connected-pages";
import { PostComposer } from "./post-composer";
import { PostsTable, type PostRow } from "./posts-table";
import { LinkForm } from "./link-form";
import { LinksTable, type LinkWithCount } from "./links-table";
import { ExtensionTab } from "./extension-tab";
import { DistributionListForm } from "./distribution-list-form";
import { DistributionListsTable } from "./distribution-lists-table";
import { cancelPostAction } from "@/actions/posts";
import type { Database } from "@/lib/supabase/types";

type FbTokenRow = Database["public"]["Tables"]["facebook_tokens"]["Row"];
type DistributionListRow = Database["public"]["Tables"]["distribution_lists"]["Row"];

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
}

export function DashboardTabs({
  pages,
  posts,
  fbError,
  fbSuccess,
  links,
  appUrl,
  distributionLists,
}: DashboardTabsProps) {
  const [editingPost, setEditingPost] = useState<PostRow | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [, startCancelTransition] = useTransition();

  function handleEdit(post: PostRow) {
    setEditingPost(post);
    // Scroll the composer into view
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

  return (
    <Tabs defaultValue="posts" className="space-y-0">
      {/* ── Tab bar ─────────────────────────────────────────────────── */}
      <TabsList className="w-full sm:w-auto">
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
        <TabsTrigger value="extension" className="flex items-center gap-2 flex-1 sm:flex-none">
          <Puzzle className="h-4 w-4" />
          חיבור תוסף
        </TabsTrigger>
      </TabsList>

      {/* ── Posts tab ───────────────────────────────────────────────── */}
      <TabsContent value="posts" className="space-y-8 mt-6">
        {/* Connected Pages */}
        <ConnectedPages
          pages={pages}
          errorMessage={fbError}
          successMessage={fbSuccess}
        />

        <Separator />

        {/* Post Composer (also serves as Edit form) */}
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
          />
        </section>

        <Separator />

        {/* Posts history */}
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
          <div>
            <h2 className="text-xl font-semibold">רשימות תפוצה</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              צור רשימות של קבוצות פייסבוק לפרסום מרובה בלחיצה אחת
            </p>
          </div>
          <DistributionListForm />
        </section>

        <Separator />

        <DistributionListsTable lists={distributionLists} />
      </TabsContent>

      {/* ── Extension tab ────────────────────────────────────────────── */}
      <TabsContent value="extension" className="mt-6">
        <ExtensionTab appUrl={appUrl} />
      </TabsContent>
    </Tabs>
  );
}
