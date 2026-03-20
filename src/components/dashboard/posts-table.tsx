"use client";

import { FileText, AlertCircle, Pencil, X, Loader2 } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ── Types ─────────────────────────────────────────────────────────────────────
export interface PostRow {
  id: string;
  content: string;
  status: "draft" | "scheduled" | "processing" | "published" | "failed" | "cancelled";
  scheduled_at: string | null;
  published_at: string | null;
  created_at: string;
  error_message: string | null;
  facebook_post_id: string | null;
  // joined via foreign key
  facebook_tokens: { page_name: string | null } | null;
}

interface PostsTableProps {
  posts: PostRow[];
  onEdit: (post: PostRow) => void;
  onCancel: (postId: string) => void;
  cancellingId: string | null;
}

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  published: {
    label: "פורסם",
    className: "border-transparent bg-green-100 text-green-800 hover:bg-green-100",
  },
  scheduled: {
    label: "מתוזמן",
    className: "border-transparent bg-amber-100 text-amber-800 hover:bg-amber-100",
  },
  failed: {
    label: "נכשל",
    className: "border-transparent bg-red-100 text-red-800 hover:bg-red-100",
  },
  draft: {
    label: "טיוטה",
    className: "border-transparent bg-slate-100 text-slate-600 hover:bg-slate-100",
  },
  processing: {
    label: "בביצוע",
    className: "border-transparent bg-blue-100 text-blue-800 hover:bg-blue-100",
  },
  cancelled: {
    label: "בוטל",
    className: "border-transparent bg-slate-100 text-slate-400 hover:bg-slate-100",
  },
} as const;

// ── Component ─────────────────────────────────────────────────────────────────
export function PostsTable({ posts, onEdit, onCancel, cancellingId }: PostsTableProps) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">היסטוריית פוסטים</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          כל הפוסטים שנוצרו — מפורסמים, מתוזמנים ושנכשלו
        </p>
      </div>

      {posts.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-14 flex flex-col items-center justify-center text-center gap-3">
            <FileText className="h-10 w-10 text-muted-foreground/30" />
            <p className="font-medium text-muted-foreground">אין פוסטים עדיין</p>
            <p className="text-sm text-muted-foreground/60">
              הפוסטים שתיצור יופיעו כאן
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {posts.length} פוסטים
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[35%]">תוכן</TableHead>
                  <TableHead>דף</TableHead>
                  <TableHead>סטטוס</TableHead>
                  <TableHead>תאריך</TableHead>
                  <TableHead className="w-[100px]">פעולות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {posts.map((post) => (
                  <PostTableRow
                    key={post.id}
                    post={post}
                    onEdit={onEdit}
                    onCancel={onCancel}
                    cancellingId={cancellingId}
                  />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

// ── Single row ─────────────────────────────────────────────────────────────────
function PostTableRow({
  post,
  onEdit,
  onCancel,
  cancellingId,
}: {
  post: PostRow;
  onEdit: (post: PostRow) => void;
  onCancel: (postId: string) => void;
  cancellingId: string | null;
}) {
  const config = STATUS_CONFIG[post.status] ?? STATUS_CONFIG.draft;
  const isCancelling = cancellingId === post.id;

  const contentPreview =
    post.content.length > 100 ? post.content.slice(0, 100) + "…" : post.content;

  const displayDate =
    post.status === "published" && post.published_at
      ? { label: "פורסם", value: post.published_at }
      : post.status === "scheduled" && post.scheduled_at
      ? { label: "מתוזמן ל", value: post.scheduled_at }
      : { label: "נוצר", value: post.created_at };

  const formattedDate = new Intl.DateTimeFormat("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(displayDate.value));

  return (
    <TableRow className={isCancelling ? "opacity-50" : ""}>
      {/* Content */}
      <TableCell className="align-top">
        <p className="text-sm leading-relaxed">{contentPreview}</p>
        {post.status === "failed" && post.error_message && (
          <div className="mt-1.5 flex items-start gap-1 text-xs text-red-600">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="line-clamp-2">{post.error_message}</span>
          </div>
        )}
        {post.facebook_post_id && (
          <p className="mt-1 text-xs text-muted-foreground/60 font-mono" dir="ltr">
            ID: {post.facebook_post_id}
          </p>
        )}
      </TableCell>

      {/* Page name */}
      <TableCell className="text-sm text-muted-foreground">
        {post.facebook_tokens?.page_name ?? "—"}
      </TableCell>

      {/* Status badge */}
      <TableCell>
        <Badge className={config.className}>{config.label}</Badge>
      </TableCell>

      {/* Date */}
      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
        <span className="block text-xs text-muted-foreground/60 mb-0.5">
          {displayDate.label}
        </span>
        <span dir="ltr">{formattedDate}</span>
      </TableCell>

      {/* Actions — only for scheduled posts */}
      <TableCell>
        {post.status === "scheduled" && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => onEdit(post)}
              title="ערוך פוסט"
            >
              <Pencil className="h-3.5 w-3.5" />
              <span className="sr-only">ערוך</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => onCancel(post.id)}
              disabled={isCancelling}
              title="בטל פוסט"
            >
              {isCancelling ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <X className="h-3.5 w-3.5" />
              )}
              <span className="sr-only">בטל</span>
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}
