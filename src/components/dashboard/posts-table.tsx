"use client";

import { useMemo, useState, useTransition } from "react";
import {
  FileText, AlertCircle, Pencil, Loader2, RefreshCw, X, Trash2, Bell,
  ChevronDown, ChevronUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  cancelScheduledPostAction,
  deletePostAction,
  toggleAutoBumpAction,
  updateBumpIntervalAction,
} from "@/actions/posts";

// ── Types ─────────────────────────────────────────────────────────────────────
export interface PostRow {
  id: string;
  content: string;
  status: "draft" | "scheduled" | "processing" | "published" | "failed" | "cancelled";
  target_id: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  created_at: string;
  error_message: string | null;
  facebook_post_id: string | null;
  recurrence_rule: string | null;
  auto_bump_enabled: boolean;
  bump_interval_hours: number | null;
  last_bumped_at: string | null;
  batch_id: string | null;
  // joined via foreign key
  facebook_tokens: { page_name: string | null } | null;
}

interface PostsTableProps {
  posts: PostRow[];
  onEdit: (post: PostRow) => void;
  onResumeDraft?: (post: PostRow) => void;
  groupNameMap?: Record<string, string>;
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
type DisplayItem =
  | { type: "single"; post: PostRow; sortDate: string }
  | { type: "group"; batchId: string; posts: PostRow[]; sortDate: string };

export function PostsTable({ posts, onEdit, onResumeDraft, groupNameMap }: PostsTableProps) {
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");

  const filtered = posts.filter((p) => {
    if (activeFilter === "published") return p.status === "published";
    if (activeFilter === "scheduled") return p.status === "scheduled" || p.status === "processing";
    if (activeFilter === "draft") return p.status === "draft";
    return true;
  });

  // Group fan-out posts by batch_id
  const displayItems = useMemo<DisplayItem[]>(() => {
    const batched = new Map<string, PostRow[]>();
    const singles: PostRow[] = [];

    for (const p of filtered) {
      if (p.batch_id) {
        const arr = batched.get(p.batch_id);
        if (arr) arr.push(p); else batched.set(p.batch_id, [p]);
      } else {
        singles.push(p);
      }
    }

    const items: DisplayItem[] = [];
    for (const post of singles) {
      items.push({ type: "single", post, sortDate: post.created_at });
    }
    for (const [batchId, batchPosts] of batched) {
      // Use earliest created_at as the group's sort date
      const earliest = batchPosts.reduce((min, p) => p.created_at < min ? p.created_at : min, batchPosts[0].created_at);
      items.push({ type: "group", batchId, posts: batchPosts, sortDate: earliest });
    }

    items.sort((a, b) => b.sortDate.localeCompare(a.sortDate));
    return items;
  }, [filtered]);

  // Count unique display items for "all" pill, individual posts for status pills
  const counts: Record<FilterKey, number> = {
    all: (() => {
      const batchIds = new Set(posts.filter((p) => p.batch_id).map((p) => p.batch_id!));
      return posts.filter((p) => !p.batch_id).length + batchIds.size;
    })(),
    published: posts.filter((p) => p.status === "published").length,
    scheduled: posts.filter((p) => p.status === "scheduled" || p.status === "processing").length,
    draft: posts.filter((p) => p.status === "draft").length,
  };

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
      {displayItems.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300/60 py-14 flex flex-col items-center justify-center text-center gap-3">
          <div className="h-14 w-14 rounded-2xl bg-slate-100 flex items-center justify-center">
            <FileText className="h-7 w-7 text-slate-400" />
          </div>
          <p className="font-semibold text-slate-700">
            {activeFilter === "all" ? "אין פוסטים עדיין" : "אין פוסטים בקטגוריה זו"}
          </p>
          <p className="text-sm text-slate-400 max-w-xs">
            {activeFilter === "all" ? "הפוסטים שתיצור יופיעו כאן" : "נסה לבחור קטגוריה אחרת"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayItems.map((item) =>
            item.type === "single" ? (
              <PostCard
                key={item.post.id}
                post={item.post}
                onEdit={onEdit}
                onResumeDraft={onResumeDraft}
                groupNameMap={groupNameMap}
              />
            ) : (
              <GroupedPostCard
                key={item.batchId}
                posts={item.posts}
                groupNameMap={groupNameMap}
                onEdit={onEdit}
              />
            )
          )}
        </div>
      )}
    </section>
  );
}

// ── Grouped card (fan-out batch) ───────────────────────────────────────────────
function GroupedPostCard({
  posts,
  groupNameMap,
  onEdit,
}: {
  posts: PostRow[];
  groupNameMap?: Record<string, string>;
  onEdit: (post: PostRow) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  // Use the first post for the content preview
  const representative = posts[0];
  const preview =
    representative.content.length > 180
      ? representative.content.slice(0, 180) + "…"
      : representative.content;

  // Aggregate statuses
  const statusCounts: Partial<Record<string, number>> = {};
  for (const p of posts) {
    statusCounts[p.status] = (statusCounts[p.status] ?? 0) + 1;
  }

  // Dominant status for the card badge
  const dominantStatus = Object.entries(statusCounts).sort(
    (a, b) => (b[1] ?? 0) - (a[1] ?? 0)
  )[0]?.[0] as keyof typeof STATUS_CONFIG | undefined;
  const dominantConfig = (dominantStatus && STATUS_CONFIG[dominantStatus]) ?? STATUS_CONFIG.draft;

  // Date from earliest post
  const earliest = posts.reduce(
    (min, p) => (p.created_at < min ? p.created_at : min),
    posts[0].created_at
  );
  const formattedDate = new Intl.DateTimeFormat("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(earliest));

  return (
    <div className="bg-white rounded-2xl border border-slate-200/60 shadow-[0_1px_3px_rgb(0,0,0,0.04)] hover:shadow-[0_4px_16px_rgb(0,0,0,0.06)] transition-shadow duration-200">
      <div className="p-5">
        {/* Header: badge + date */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={dominantConfig.className}>
              {dominantConfig.label}
            </Badge>
            <span className="text-xs text-slate-400 bg-slate-50 rounded-lg px-2 py-0.5">
              {posts.length} קבוצות
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <span>נוצר</span>
            <span dir="ltr">{formattedDate}</span>
          </div>
        </div>

        {/* Content preview */}
        <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap mb-3">
          {preview}
        </p>

        {/* Status summary */}
        <div className="flex flex-wrap gap-2 mb-3">
          {(["published", "scheduled", "processing", "failed", "draft", "cancelled"] as const).map(
            (s) =>
              statusCounts[s] ? (
                <span
                  key={s}
                  className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-medium ${
                    (STATUS_CONFIG[s] ?? STATUS_CONFIG.draft).className
                  }`}
                >
                  {statusCounts[s]} {(STATUS_CONFIG[s] ?? STATUS_CONFIG.draft).label}
                </span>
              ) : null
          )}
        </div>

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 transition-colors"
        >
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
          {expanded ? "הסתר קבוצות" : `הצג ${posts.length} קבוצות`}
        </button>

        {/* Expanded group list */}
        {expanded && (
          <div className="mt-3 border-t border-slate-100 pt-3 max-h-64 overflow-y-auto space-y-1">
            {posts.map((p) => {
              const cfg = STATUS_CONFIG[p.status] ?? STATUS_CONFIG.draft;
              const name = p.target_id
                ? groupNameMap?.[p.target_id] ?? p.target_id
                : "—";
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 text-xs"
                >
                  <Badge
                    variant="outline"
                    className={`shrink-0 text-[10px] px-1.5 py-0 ${cfg.className}`}
                  >
                    {cfg.label}
                  </Badge>
                  <span className="truncate text-slate-700 flex-1" title={name}>
                    {name}
                  </span>
                  {p.error_message && (
                    <span
                      className="truncate text-red-500 max-w-[200px]"
                      title={p.error_message}
                    >
                      {p.error_message}
                    </span>
                  )}
                  {p.status === "scheduled" && (
                    <button
                      onClick={() => onEdit(p)}
                      className="shrink-0 text-slate-400 hover:text-slate-600"
                      aria-label="ערוך"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Single card ────────────────────────────────────────────────────────────────
function PostCard({
  post,
  onEdit,
  onResumeDraft,
  groupNameMap,
}: {
  post: PostRow;
  onEdit: (post: PostRow) => void;
  onResumeDraft?: (post: PostRow) => void;
  groupNameMap?: Record<string, string>;
}) {
  const [isPending, startTransition] = useTransition();
  const [editingInterval, setEditingInterval] = useState(false);
  const [intervalValue, setIntervalValue] = useState(String(post.bump_interval_hours ?? 24));
  const config = STATUS_CONFIG[post.status] ?? STATUS_CONFIG.draft;
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

  function handleCancelToDraft() {
    startTransition(async () => {
      await cancelScheduledPostAction(post.id);
    });
  }

  function handleDelete() {
    if (!window.confirm("האם למחוק טיוטה זו לצמיתות?")) return;
    startTransition(async () => {
      await deletePostAction(post.id);
    });
  }

  const hasActions = post.status === "scheduled" || post.status === "draft";

  return (
    <div
      aria-busy={isPending}
      className={`group bg-white rounded-2xl border border-slate-200/60 shadow-[0_1px_3px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.06)] hover:-translate-y-0.5 transition-all duration-300 ease-out overflow-hidden ${
        isPending ? "opacity-50 pointer-events-none" : ""
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
          <div role="alert" className="mt-2.5 flex items-start gap-1.5 text-xs text-red-600 bg-red-50/60 rounded-xl px-3 py-2 border border-red-100/60">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="line-clamp-2">{post.error_message}</span>
          </div>
        )}

        {/* Meta chips */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
          {post.facebook_tokens?.page_name && (
            <span className="bg-slate-100/70 rounded-lg px-2 py-0.5">
              {post.facebook_tokens.page_name}
            </span>
          )}
          {post.target_id && (
            <span className="bg-blue-50 text-blue-600 rounded-lg px-2 py-0.5 truncate max-w-[200px]" title={post.target_id}>
              {groupNameMap?.[post.target_id] ?? post.target_id}
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
          {post.status === "published" && (
            <span className="flex items-center gap-1.5">
              <button
                type="button"
                role="switch"
                aria-checked={post.auto_bump_enabled}
                aria-label="Auto-Bump"
                onClick={() => startTransition(async () => {
                  await toggleAutoBumpAction(post.id, !post.auto_bump_enabled);
                })}
                disabled={isPending}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 ${
                  post.auto_bump_enabled ? "bg-blue-600" : "bg-slate-200"
                } ${isPending ? "opacity-50" : ""}`}
              >
                <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ${
                  post.auto_bump_enabled ? "ltr:translate-x-4 rtl:-translate-x-4" : "translate-x-0"
                }`} />
              </button>
              <Bell className="h-3 w-3 text-slate-400" />
              <span className="text-[11px] text-slate-400">Bump</span>
            </span>
          )}
          {post.status === "published" && post.auto_bump_enabled && post.last_bumped_at && (
            <Badge variant="secondary" className="rounded-lg text-[11px] font-normal">
              באמפ אחרון:{" "}
              {new Intl.DateTimeFormat("he-IL", {
                day: "2-digit", month: "2-digit",
                hour: "2-digit", minute: "2-digit",
              }).format(new Date(post.last_bumped_at))}
            </Badge>
          )}
          {post.status === "published" && post.auto_bump_enabled && post.bump_interval_hours && (
            editingInterval ? (
              <form
                className="flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  const n = parseInt(intervalValue, 10);
                  if (!n || n < 1 || n > 168) return;
                  startTransition(async () => {
                    await updateBumpIntervalAction(post.id, n);
                    setEditingInterval(false);
                  });
                }}
              >
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={intervalValue}
                  onChange={(e) => setIntervalValue(e.target.value)}
                  autoFocus
                  onBlur={() => setEditingInterval(false)}
                  onKeyDown={(e) => { if (e.key === "Escape") setEditingInterval(false); }}
                  className="w-14 h-6 rounded border border-slate-300 text-center text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <span className="text-[11px] text-slate-400">שעות</span>
              </form>
            ) : (
              <Badge
                variant="secondary"
                className="rounded-lg text-[11px] font-normal cursor-pointer hover:bg-slate-200 transition-colors"
                onClick={() => {
                  setIntervalValue(String(post.bump_interval_hours ?? 24));
                  setEditingInterval(true);
                }}
                title="לחץ לעריכת מרווח"
              >
                כל {post.bump_interval_hours} שעות
                <Pencil className="h-2.5 w-2.5 ms-1 inline opacity-50" />
              </Badge>
            )
          )}
        </div>
      </div>

      {/* Actions footer */}
      {hasActions && (
        <div className="px-5 py-3 bg-slate-50/50 border-t border-slate-100 flex items-center gap-2">
          {post.status === "scheduled" && (
            <>
              {/* Edit scheduled post */}
              <button
                onClick={() => onEdit(post)}
                aria-label="ערוך פוסט מתוזמן"
                className="flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1"
              >
                <Pencil className="h-3.5 w-3.5" />
                ערוך
              </button>
              {/* Cancel → draft */}
              <button
                onClick={handleCancelToDraft}
                disabled={isPending}
                aria-label="בטל תזמון והפוך לטיוטה"
                className="flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-medium text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-1"
                title="הפוך לטיוטה"
              >
                {isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <X className="h-3.5 w-3.5" />
                )}
                בטל תזמון
              </button>
            </>
          )}

          {post.status === "draft" && (
            <>
              {/* Resume draft into composer */}
              <Button
                size="sm"
                onClick={() => onResumeDraft?.(post)}
                className="flex-1 sm:flex-none rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-sm hover:shadow-md transition-all duration-200 text-xs"
              >
                <RefreshCw className="h-3.5 w-3.5 ms-1.5" />
                המשך עריכה
              </Button>
              {/* Delete draft */}
              <button
                onClick={handleDelete}
                disabled={isPending}
                aria-label="מחק טיוטה לצמיתות"
                className="h-8 w-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all duration-200 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1"
                title="מחק טיוטה"
              >
                {isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
