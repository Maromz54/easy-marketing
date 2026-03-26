"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, ListChecks, CheckCircle2, Pencil } from "lucide-react";

import {
  createDistributionListAction,
  updateDistributionListAction,
} from "@/actions/distribution-lists";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Separator } from "@/components/ui/separator";
import type { Database } from "@/lib/supabase/types";

type DistributionListRow = Database["public"]["Tables"]["distribution_lists"]["Row"];
type FacebookGroupRow = Database["public"]["Tables"]["facebook_groups"]["Row"];

// ── Schema ────────────────────────────────────────────────────────────────────
// groupIdsRaw is optional — the user can select groups via checkboxes instead.
// Any IDs entered manually must still be numeric.
const distributionListSchema = z.object({
  name: z
    .string()
    .min(1, { message: "שם הרשימה הוא חובה." })
    .max(100, { message: "השם ארוך מדי (מקסימום 100 תווים)." }),
  groupIdsRaw: z.string().refine(
    (v) => {
      if (!v.trim()) return true; // empty is fine — checkboxes cover it
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

// ── Component ─────────────────────────────────────────────────────────────────
interface DistributionListFormProps {
  editingList?: DistributionListRow | null;
  onEditDone?: () => void;
  facebookGroups?: FacebookGroupRow[];
}

export function DistributionListForm({
  editingList,
  onEditDone,
  facebookGroups,
}: DistributionListFormProps) {
  const isEditing = !!editingList;
  const safeGroups = facebookGroups ?? [];

  const [serverError, setServerError] = useState<string | null>(null);
  const [successName, setSuccessName] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Visual group picker state (outside Zod — local UI state)
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [groupSearch, setGroupSearch] = useState("");

  const filteredGroups = useMemo(() => {
    const q = groupSearch.trim().toLowerCase();
    if (!q) return safeGroups;
    return safeGroups.filter(
      (g) => g.name.toLowerCase().includes(q) || g.group_id.includes(q)
    );
  }, [safeGroups, groupSearch]);

  const form = useForm<DistributionListFormValues>({
    resolver: zodResolver(distributionListSchema),
    defaultValues: { name: "", groupIdsRaw: "" },
  });

  // Pre-fill when entering edit mode
  useEffect(() => {
    if (editingList) {
      // Split the stored group_ids into checkbox selections vs. manual overflow.
      // Groups that exist in the synced list → pre-check their boxes.
      // The rest (manually entered IDs not in the synced list) → put in the textarea.
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

  function onSubmit(values: DistributionListFormValues) {
    setServerError(null);
    setSuccessName(null);

    // Combine checkbox selections with manually entered IDs
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
    <Card className={isEditing ? "border-primary/40 bg-primary/5" : ""}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          {isEditing ? (
            <>
              <Pencil className="h-5 w-5 text-primary" />
              עריכת רשימה: {editingList?.name}
            </>
          ) : (
            <>
              <ListChecks className="h-5 w-5 text-primary" />
              יצירת רשימת תפוצה חדשה
            </>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Success (create only) */}
        {successName && (
          <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>הרשימה <strong>{successName}</strong> נוצרה בהצלחה!</span>
          </div>
        )}

        {/* Server error */}
        {serverError && (
          <div className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
            {serverError}
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>

            {/* List name */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>שם הרשימה</FormLabel>
                  <FormControl>
                    <Input placeholder='למשל: "קבוצות נדל״ן בצפון"' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* ── Visual group picker (shown only when synced groups exist) ── */}
            {safeGroups.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">
                    בחר קבוצות מסונכרנות ({safeGroups.length})
                  </Label>
                  {selectedGroupIds.length > 0 && (
                    <span className="text-xs text-purple-700 font-medium">
                      {selectedGroupIds.length} נבחרו
                    </span>
                  )}
                </div>

                <Input
                  placeholder="חפש קבוצה לפי שם או מזהה..."
                  dir="rtl"
                  className="h-8 text-xs"
                  value={groupSearch}
                  onChange={(e) => setGroupSearch(e.target.value)}
                />

                <div className="rounded-md border border-input bg-muted/30 max-h-60 overflow-y-auto divide-y divide-border">
                  {filteredGroups.length === 0 ? (
                    <p className="px-3 py-3 text-xs text-muted-foreground">לא נמצאו קבוצות</p>
                  ) : (
                    filteredGroups.map((group) => {
                      const checked = selectedGroupIds.includes(group.group_id);
                      return (
                        <label
                          key={group.group_id}
                          htmlFor={`fg-${group.group_id}`}
                          className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors hover:bg-muted/60 ${
                            checked ? "bg-purple-50/60" : ""
                          }`}
                        >
                          <Checkbox
                            id={`fg-${group.group_id}`}
                            checked={checked}
                            onCheckedChange={() => toggleGroup(group.group_id)}
                          />
                          {group.icon_url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={group.icon_url}
                              alt=""
                              className="h-7 w-7 rounded-full object-cover shrink-0"
                            />
                          )}
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm truncate">{group.name}</span>
                            <span className="text-xs text-muted-foreground font-mono">
                              {group.group_id}
                            </span>
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>

                {selectedGroupIds.length > 0 && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                    onClick={() => setSelectedGroupIds([])}
                  >
                    נקה בחירה
                  </button>
                )}
              </div>
            )}

            {/* Manual group IDs (fallback / extra) */}
            <FormField
              control={form.control}
              name="groupIdsRaw"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {safeGroups.length > 0
                      ? "מזהי קבוצות נוספים (אופציונלי)"
                      : "מזהי קבוצות (מופרדים בפסיק)"}
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="123456789012345, 987654321098765, 112233445566778"
                      dir="ltr"
                      className="min-h-[64px] font-mono text-sm"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription className="text-xs">
                    {safeGroups.length > 0
                      ? "הדבק כאן מזהי קבוצות שאינם ברשימה המסונכרנת."
                      : "הזן את מזהי קבוצות הפייסבוק מופרדים בפסיקים. המזהה מופיע בכתובת הקבוצה (מספרים בלבד)."}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Separator />

            <div className="flex gap-2">
              <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
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
                <Button type="button" variant="outline" onClick={onEditDone} disabled={isPending}>
                  ביטול
                </Button>
              )}
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
