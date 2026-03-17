"use client";

import { Send, Link2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { ConnectedPages } from "./connected-pages";
import { PostComposer } from "./post-composer";
import { PostsTable, type PostRow } from "./posts-table";
import { LinkForm } from "./link-form";
import { LinksTable, type LinkWithCount } from "./links-table";
import type { Database } from "@/lib/supabase/types";

type FbTokenRow = Database["public"]["Tables"]["facebook_tokens"]["Row"];

interface DashboardTabsProps {
  // Posts tab
  pages: FbTokenRow[];
  posts: PostRow[];
  fbError: string | null;
  fbSuccess: string | null;
  // Links tab
  links: LinkWithCount[];
  appUrl: string;
}

export function DashboardTabs({
  pages,
  posts,
  fbError,
  fbSuccess,
  links,
  appUrl,
}: DashboardTabsProps) {
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

        {/* Post Composer */}
        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">יצירת פוסט</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              כתוב פוסט ופרסם מיידית או תזמן לתאריך עתידי
            </p>
          </div>
          <PostComposer pages={pages} />
        </section>

        <Separator />

        {/* Posts history */}
        <PostsTable posts={posts} />
      </TabsContent>

      {/* ── Links tab ───────────────────────────────────────────────── */}
      <TabsContent value="links" className="space-y-8 mt-6">
        {/* Link creator */}
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

        {/* Links analytics table */}
        <LinksTable links={links} appUrl={appUrl} />
      </TabsContent>
    </Tabs>
  );
}
