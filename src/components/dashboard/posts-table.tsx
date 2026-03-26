"use client";

import { useState } from "react";
import { FileText, AlertCircle, Pencil, X, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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
  recurrence_rule: string | null;
  // joined via foreign key
  facebook_tokens: { page_name: string | null } | null;
}

interface PostsTableProps {
  posts: PostRow[];
  onEdit: (post: PostRow) => void;
  onCancel: (postId: string) => void;
  cancellingId: string | null;
  onResumeDraft?: (post: PostRow) => void;
}

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  published: {
    label: "פורסם",
    className: "border-transparent bg-emerald-100 text-emerald-700 hover:bg-emerald-100",
  },
  scheduled: {
    label: "מתוזמן",
    className: "border-transparent bg-amber-100 text-amber-700 hover:bg-amber-100",
  },
  failed: {
    label: "נכשל",
    className: "border-transparent bg-red-100 text-red-700 hover:bg-red-100",
  },
  draft: {
    label: "טיוטה",
    className: "border-transparent bg-slate-100 text-slate-600 hover:bg-slate-100",
  },
  processing: {
    label: "בביצוע",
    className: "border-transparent bg-blue-100 text-blue-700 hover:bg-blue-100",
  },
  cancelled: {
    label: "בוטל",
    className: "border-transparent bg-slate-100 text-slate-400 hover:bg-slate-100",
  },
} as const;

type FilterKey = "all" | "published" | "scheduled" | "draft";

// ── Component ─────────────────────────────────────────────────────────────────
export function PostsTable({ posts, onEdit, onCancel, cancellingId, onResumeDraft }: PostsTableProps) {
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");

  const counts: Record<FilterKey, number> = {
    all: posts.length,
    published: posts.filter((p) => p.status === "published").length,
    scheduled: posts.filter((p) => p.status === "scheduled" || p.status === "processing").length,
    draft: posts.filter((p) => p.status === "draft").length,
  };

  const filtered = posts.filter((p) => {
    if (activeFilter === "published") return p.status === "published";
    if (activeFilter === "scheduled") return p.status === "scheduled" || p.status === "processing";
    if (activeFilter === "draft") return p.status === "draft";
    return true;
  });

  const FILTERS: { id: FilterKey; label: string }[] = [
    { id: "all", label: "הכל" },
    { id: "published", label: "פורסמו" },
    { id: "scheduled", label: "מתוזמנים" },
    { id: "draft", label: "טיוטות" },
  ];

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">היסטוריית פוסטים</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          כל הפוסטים שנוצרו — מפורסמים, מתוזמנים ושנכשלו
        </p>
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setActiveFilter(f.id)}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm font-medium transition-all duration-200 ${
              activeFilter === f.id
                ? "bg-slate-900 text-white shadow-sm"
                : "bg-white border border-slate-200/80 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            {f.label}
            {counts[f.id] > 0 && (
              <span
                className={`tabular-nums rounded-full px-1.5 py-0.5 text-[10px] leading-none font-semibold ${
                  activeFilter === f.id
                    ? "bg-white/20 text-white"
                    : "bg-slate-100 text-slate-500"
                }`}
              >
                {counts[f.id]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Posts list */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300/60 py-14 flex flex-col items-center justify-center text-center gap-3">
          <div className="h-14 w-14 rounded-2xl bg-slate-100 flex items-center justify-center">
            <FileText className="h-7 w-7 text-slate-400" />
          </div>
          <p className="font-semibold text-slate-700">
            {activeFilter === "all" ? "אין פוסטים עדיין" : "אין פוסטים בקטגוריה זו"}
          </p>
          <p className="text-sm text-slate-400 max-w-xs">
            {activeFilter === "all"
              ? "הפוסטים שתיצור יופיעו כאן"
              : "נסה לבחור קטגוריה אחרת"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              onEdit={onEdit}
              onCancel={onCancel}
              cancellingId={cancellingId}
              onResumeDraft={onResumeDraft}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ── Single card ────────────────────────────────────────────────────────────────
function PostCard({
  post,
  onEdit,
  onCancel,
  cancellingId,
  onResumeDraft,
}: {
  post: PostRow;
  onEdit: (post: PostRow) => void;
  onCancel: (postId: string) => void;
  cancellingId: string | null;
  onResumeDraft?: (post: PostRow) => void;
}) {
  const config = STATUS_CONFIG[post.status] ?? STATUS_CONFIG.draft;
  const isCancelling = cancellingId === post.id;
  const preview =
    post.content.length > 180 ? post.content.slice(0, 180) + "…" : post.content;

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

  const recurrenceLabel =
    post.recurrence_rule === "monthly"
      ? "חודשי"
      : post.recurrence_rule?.startsWith("weekly:")
      ? "שבועי"
      : null;

  const hasActions = post.status === "scheduled" || post.status === "draft";

  return (
    <div
      className={`group bg-white rounded-2xl border border-slate-200/60 shadow-[0_1px_3px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.06)] hover:-translate-y-0.5 transition-all duration-300 ease-out overflow-hidden ${
        isCancelling ? "opacity-50 pointer-events-none" : ""
      }`}
    >
      <div className="p-5">
        {/* Header row */}
        <div className="flex items-center justify-between gap-3 mb-3">
          <Badge className={`${config.className} rounded-lg px-2.5 py-0.5 text-xs font-semibold`}>
            {config.label}
          </Badge>
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className="text-slate-300">{displayDate.label}</span>
            <span dir="ltr">{formattedDate}</span>
          </div>
        </div>

        {/* Content preview */}
        <p
          className="text-sm text-slate-700 line-clamp-3 whitespace-pre-line leading-relaxed"
          dir="auto"
        >
          {preview}
        </p>

        {/* Error message */}
        {post.status === "failed" && post.error_message && (
          <div className="mt-2.5 flex items-start gap-1.5 text-xs text-red-600 bg-red-50/60 rounded-xl px-3 py-2 border border-red-100/60">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="line-clamp-2">{post.error_message}</span>
          </div>
        )}

        {/* Meta row */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
          {post.facebook_tokens?.page_name && (
            <span className="bg-slate-100/70 rounded-lg px-2 py-0.5">
              {post.facebook_tokens.page_name}
            </span>
          )}
          {recurrenceLabel && (
            <span className="bg-violet-50 text-violet-600 rounded-lg px-2 py-0.5">
              🔁 {recurrenceLabel}
            </span>
          )}
          {post.facebook_post_id && (
            <span className="font-mono text-slate-300 truncate max-w-[120px]" dir="ltr">
              {post.facebook_post_id}
            </span>
          )}
        </div>
      </div>

      {/* Actions footer */}
      {hasActions && (
        <div className="px-5 py-3 bg-slate-50/50 border-t border-slate-100 flex items-center gap-2">
          {post.status === "draft" && (
            <Button
              size="sm"
              onClick={() => onResumeDraft?.(post)}
              className="flex-1 sm:flex-none rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-sm hover:shadow-md transition-all duration-200 text-xs"
            >
              <RefreshCw className="h-3.5 w-3.5 ms-1.5" />
              המשך עריכה
            </Button>
          )}
          {post.status === "scheduled" && (
            <>
              <button
                onClick={() => onEdit(post)}
                className="flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition-all duration-200"
              >
                <Pencil className="h-3.5 w-3.5" />
                ערוך
              </button>
              <button
                onClick={() => onCancel(post.id)}
                disabled={isCancelling}
                className="flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-medium text-slate-400 hover:text-red-600 hover:bg-red-50 transition-all duration-200"
              >
                {isCancelling ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <X className="h-3.5 w-3.5" />
                )}
                בטל
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
