"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, ListChecks, CheckCircle2, Pencil, Search } from "lucide-react";

import {
  createDistributionListAction,
  updateDistributionListAction,
} from "@/actions/distribution-lists";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import type { Database } from "@/lib/supabase/types";

type DistributionListRow = Database["public"]["Tables"]["distribution_lists"]["Row"];
type FacebookGroupRow = Database["public"]["Tables"]["facebook_groups"]["Row"];

// Map: group_id → list names that already contain it (excluding the list being edited)
function buildGroupListMap(
  groups: FacebookGroupRow[],
  allLists: DistributionListRow[],
  editingListId?: string
): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const g of groups) {
    map[g.group_id] = allLists
      .filter((l) => l.id !== editingListId && l.group_ids.includes(g.group_id))
      .map((l) => l.name);
  }
  return map;
}

const distributionListSchema = z.object({
  name: z
    .string()
    .min(1, { message: "שם הרשימה הוא חובה." })
    .max(100, { message: "השם ארוך מדי (מקסימום 100 תווים)." }),
  groupIdsRaw: z.string().refine(
    (v) => {
      if (!v.trim()) return true;
      return v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .every((id) => /^\d+$/.test(id));
    },
    { message: "כל מזהה קבוצה חייב להיות מספרי בלבד. הפרד בין מזהים בפסיק." }
  ),
});

type DistributionListFormValues = z.infer<typeof distributionListSchema>;

interface DistributionListFormProps {
  editingList?: DistributionListRow | null;
  onEditDone?: () => void;
  facebookGroups?: FacebookGroupRow[];
  allLists?: DistributionListRow[];
}

export function DistributionListForm({
  editingList,
  onEditDone,
  facebookGroups,
  allLists = [],
}: DistributionListFormProps) {
  const isEditing = !!editingList;
  const safeGroups = facebookGroups ?? [];

  const [serverError, setServerError] = useState<string | null>(null);
  const [successName, setSuccessName] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [groupSearch, setGroupSearch] = useState("");

  const filteredGroups = useMemo(() => {
    const q = groupSearch.trim().toLowerCase();
    if (!q) return safeGroups;
    return safeGroups.filter(
      (g) => g.name.toLowerCase().includes(q) || g.group_id.includes(q)
    );
  }, [safeGroups, groupSearch]);

  // For each group_id: which OTHER lists already contain it?
  const groupListMap = useMemo(
    () => buildGroupListMap(safeGroups, allLists, editingList?.id),
    [safeGroups, allLists, editingList?.id]
  );

  const form = useForm<DistributionListFormValues>({
    resolver: zodResolver(distributionListSchema),
    defaultValues: { name: "", groupIdsRaw: "" },
  });

  useEffect(() => {
    if (editingList) {
      const syncedIds = new Set(safeGroups.map((g) => g.group_id));
      const preChecked = editingList.group_ids.filter((id) => syncedIds.has(id));
      const manualOnly = editingList.group_ids.filter((id) => !syncedIds.has(id));

      setSelectedGroupIds(preChecked);
      form.reset({
        name: editingList.name,
        groupIdsRaw: manualOnly.join(", "),
      });
      setServerError(null);
      setSuccessName(null);
      setGroupSearch("");
    } else {
      setSelectedGroupIds([]);
      form.reset({ name: "", groupIdsRaw: "" });
      setGroupSearch("");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingList]);

  function toggleGroup(groupId: string) {
    setSelectedGroupIds((prev) =>
      prev.includes(groupId) ? prev.filter((x) => x !== groupId) : [...prev, groupId]
    );
  }

  function selectAll() {
    const allIds = filteredGroups.map((g) => g.group_id);
    setSelectedGroupIds((prev) => [...new Set([...prev, ...allIds])]);
  }

  function onSubmit(values: DistributionListFormValues) {
    setServerError(null);
    setSuccessName(null);

    const manualIds = values.groupIdsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const combinedIds = [...new Set([...selectedGroupIds, ...manualIds])];

    if (combinedIds.length === 0) {
      setServerError("יש לבחור לפחות קבוצה אחת.");
      return;
    }
    if (combinedIds.length > 50) {
      setServerError(`נבחרו ${combinedIds.length} קבוצות — ניתן להוסיף עד 50 קבוצות לרשימה.`);
      return;
    }

    startTransition(async () => {
      if (isEditing && editingList) {
        const result = await updateDistributionListAction({
          id: editingList.id,
          name: values.name,
          groupIds: combinedIds,
        });
        if (result.error) {
          setServerError(result.error);
        } else {
          onEditDone?.();
        }
      } else {
        const result = await createDistributionListAction({
          name: values.name,
          groupIds: combinedIds,
        });
        if (result.error) {
          setServerError(result.error);
        } else {
          setSuccessName(values.name);
          setSelectedGroupIds([]);
          form.reset();
        }
      }
    });
  }

  return (
    <div className={`bg-white rounded-2xl border shadow-[0_1px_3px_rgb(0,0,0,0.04)] overflow-hidden transition-all duration-300 ${
      isEditing ? "border-blue-200 shadow-[0_4px_20px_rgb(59,130,246,0.08)]" : "border-slate-200/60"
    }`}>
      {/* Header */}
      <div className="px-6 py-5 border-b border-slate-100">
        <div className="flex items-center gap-2.5 text-lg font-semibold tracking-tight text-slate-900">
          {isEditing ? (
            <div className="h-8 w-8 rounded-xl bg-amber-50 flex items-center justify-center">
              <Pencil className="h-4 w-4 text-amber-600" />
            </div>
          ) : (
            <div className="h-8 w-8 rounded-xl bg-violet-50 flex items-center justify-center">
              <ListChecks className="h-4 w-4 text-violet-600" />
            </div>
          )}
          {isEditing ? `עריכת רשימה: ${editingList?.name}` : "יצירת רשימת תפוצה חדשה"}
        </div>
      </div>

      <div className="p-6 space-y-5">
        {/* Success */}
        {successName && (
          <div role="status" aria-live="polite" className="flex items-center gap-2 rounded-xl bg-emerald-50/60 border border-emerald-100 px-4 py-3 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>הרשימה <strong>{successName}</strong> נוצרה בהצלחה!</span>
          </div>
        )}

        {serverError && (
          <div role="alert" className="rounded-xl bg-red-50/60 border border-red-100 px-4 py-3 text-sm text-red-600">
            {serverError}
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-slate-700">שם הרשימה</FormLabel>
                  <FormControl>
                    <Input
                      placeholder='למשל: "קבוצות נדל״ן בצפון"'
                      className="rounded-xl border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 transition-all duration-200"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* ── Premium group gallery ─────────────────────────────────── */}
            {safeGroups.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700">
                    בחר קבוצות מסונכרנות
                  </span>
                  <div className="flex items-center gap-3">
                    {selectedGroupIds.length > 0 && (
                      <button
                        type="button"
                        aria-label="נקה את כל הקבוצות שנבחרו"
                        className="text-xs text-slate-400 hover:text-slate-600 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 rounded"
                        onClick={() => setSelectedGroupIds([])}
                      >
                        נקה הכל
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label="בחר את כל הקבוצות המסונכרנות"
                      className="text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1 rounded"
                      onClick={selectAll}
                    >
                      בחר הכל
                    </button>
                    <span className="text-xs tabular-nums bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full font-semibold">
                      {selectedGroupIds.length} / {safeGroups.length}
                    </span>
                  </div>
                </div>

                {/* Search */}
                <div className="relative">
                  <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <Input
                    placeholder="חפש קבוצה..."
                    dir="rtl"
                    aria-label="חפש קבוצה מסונכרנת"
                    className="h-9 text-sm rounded-xl border-slate-200 ps-9 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 transition-all duration-200"
                    value={groupSearch}
                    onChange={(e) => setGroupSearch(e.target.value)}
                  />
                </div>

                {/* Grid */}
                <div className="rounded-2xl border border-slate-200/60 bg-slate-50/30 max-h-72 overflow-y-auto">
                  {filteredGroups.length === 0 ? (
                    <p className="px-4 py-8 text-center text-sm text-slate-400">לא נמצאו קבוצות</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-slate-200/40">
                      {filteredGroups.map((group) => {
                        const checked = selectedGroupIds.includes(group.group_id);
                        const overlapLists = groupListMap[group.group_id] ?? [];
                        return (
                          <label
                            key={group.group_id}
                            htmlFor={`fg-${group.group_id}`}
                            className={`flex items-start gap-3 px-3.5 py-3 cursor-pointer transition-all duration-200 ${
                              checked
                                ? "bg-blue-50/70"
                                : "bg-white hover:bg-slate-50/80"
                            }`}
                          >
                            <Checkbox
                              id={`fg-${group.group_id}`}
                              checked={checked}
                              onCheckedChange={() => toggleGroup(group.group_id)}
                              className="transition-all duration-200 mt-0.5"
                            />
                            <div className={`h-9 w-9 rounded-xl shrink-0 overflow-hidden bg-slate-100 flex items-center justify-center transition-all duration-200 ${
                              checked ? "ring-2 ring-blue-400/40" : ""
                            }`}>
                              {group.icon_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={group.icon_url}
                                  alt=""
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <span className="text-xs font-bold text-slate-400">
                                  {group.name.charAt(0)}
                                </span>
                              )}
                            </div>
                            <span className="flex-1 min-w-0">
                              <span className="block text-sm font-medium text-slate-700 truncate">
                                {group.name}
                              </span>
                              <span className="text-[11px] text-slate-400 font-mono">
                                {group.group_id}
                              </span>
                              {overlapLists.length > 0 && (
                                <span className="mt-1 flex flex-wrap gap-1">
                                  {overlapLists.map((listName) => (
                                    <span
                                      key={listName}
                                      title={`קיים גם ברשימה: ${listName}`}
                                      className="inline-block rounded-md bg-amber-50 border border-amber-200 text-amber-700 text-[10px] px-1.5 py-0.5 leading-tight"
                                    >
                                      {listName}
                                    </span>
                                  ))}
                                </span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Manual IDs */}
            <FormField
              control={form.control}
              name="groupIdsRaw"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-slate-700">
                    {safeGroups.length > 0
                      ? "מזהי קבוצות נוספים (אופציונלי)"
                      : "מזהי קבוצות (מופרדים בפסיק)"}
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="123456789012345, 987654321098765"
                      dir="ltr"
                      className="min-h-[56px] font-mono text-sm rounded-xl border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 transition-all duration-200"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription className="text-xs text-slate-400">
                    {safeGroups.length > 0
                      ? "הדבק כאן מזהי קבוצות שאינם ברשימה המסונכרנת."
                      : "הזן את מזהי קבוצות הפייסבוק מופרדים בפסיקים."}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex gap-2.5 pt-1">
              <Button
                type="submit"
                disabled={isPending}
                aria-busy={isPending}
                className="w-full sm:w-auto rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-sm hover:shadow-md transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              >
                {isPending ? (
                  <>
                    <Loader2 className="ms-2 h-4 w-4 animate-spin" />
                    {isEditing ? "מעדכן..." : "יוצר רשימה..."}
                  </>
                ) : (
                  <>
                    {isEditing ? <Pencil className="ms-2 h-4 w-4" /> : <ListChecks className="ms-2 h-4 w-4" />}
                    {isEditing ? "עדכן רשימה" : "צור רשימה"}
                  </>
                )}
              </Button>
              {isEditing && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onEditDone}
                  disabled={isPending}
                  aria-label="ביטול עריכת רשימה"
                  className="rounded-xl border-slate-200 hover:bg-slate-50 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
                >
                  ביטול
                </Button>
              )}
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
}
