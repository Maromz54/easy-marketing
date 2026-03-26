"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Loader2, Send, CalendarClock, Image as ImageIcon,
  Link2, CheckCircle2, Target, Puzzle, ListChecks, Pencil, X, Upload, RefreshCw,
} from "lucide-react";

import { createPostAction, updatePostAction, saveAsTemplateAction } from "@/actions/posts";
import type { TemplateRow } from "@/components/dashboard/templates-tab";
import { createClient } from "@/lib/supabase/client";
import { PostPreview } from "@/components/dashboard/post-preview";
import { DistributionPanel } from "@/components/dashboard/distribution-panel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Form, FormControl, FormDescription,
  FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { Database } from "@/lib/supabase/types";
import type { PostRow } from "@/components/dashboard/posts-table";

type FacebookToken = Database["public"]["Tables"]["facebook_tokens"]["Row"];
type DistributionListRow = Database["public"]["Tables"]["distribution_lists"]["Row"];

// ── Validation Schema ─────────────────────────────────────────────────────────
const urlSchema = z
  .string()
  .refine((v) => !v || /^https?:\/\/.+/.test(v), {
    message: "כתובת URL חייבת להתחיל ב-http:// או https://",
  });

const postSchema = z
  .object({
    facebookTokenId: z.string().optional(),
    // Multi-distribution: array of selected list IDs
    distributionListIds: z.array(z.string()),
    // Manually entered group IDs (comma-separated string)
    extraGroupIds: z.string(),
    // Single-target fallback (shown when no distribution lists selected)
    targetId: z
      .string()
      .optional()
      .refine((v) => !v || /^\d+$/.test(v.trim()), {
        message: "מזהה היעד חייב להיות מספרי בלבד.",
      }),
    content: z
      .string()
      .min(1, { message: "תוכן הפוסט הוא חובה." })
      .max(63206, { message: "הפוסט ארוך מדי (מקסימום 63,206 תווים)." }),
    // Multiple image URLs (managed by upload widget, not validated individually here)
    imageUrls: z.array(z.string()),
    linkUrl: z
      .string()
      .optional()
      .refine((v) => !v || /^https?:\/\/.+/.test(v), {
        message: "כתובת URL חייבת להתחיל ב-http:// או https://",
      }),
    publishMode: z.enum(["now", "scheduled"]),
    scheduledAt: z.string().optional(),
    // Recurrence: "none" | "weekly" | "monthly"
    recurrenceType: z.enum(["none", "weekly", "monthly"]),
    // Selected weekdays (0=Sun … 6=Sat) when recurrenceType === "weekly"
    recurrenceDays: z.array(z.number()),
  })
  .superRefine((data, ctx) => {
    if (data.publishMode === "scheduled") {
      if (!data.scheduledAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "אנא בחר תאריך ושעה לתזמון.",
          path: ["scheduledAt"],
        });
        return;
      }
      const scheduled = new Date(data.scheduledAt);
      if (isNaN(scheduled.getTime()) || scheduled.getTime() <= Date.now()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "תאריך התזמון חייב להיות בעתיד.",
          path: ["scheduledAt"],
        });
      }
    }
    if (data.recurrenceType === "weekly" && data.recurrenceDays.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "בחר לפחות יום אחד לחזרה שבועית.",
        path: ["recurrenceDays"],
      });
    }
  });

type PostFormValues = z.infer<typeof postSchema>;

// ── Sentinel ──────────────────────────────────────────────────────────────────
const EXTENSION_SENTINEL = "__none__";

// ── Hebrew weekday labels ─────────────────────────────────────────────────────
const WEEKDAYS = [
  { day: 0, label: "א׳" },
  { day: 1, label: "ב׳" },
  { day: 2, label: "ג׳" },
  { day: 3, label: "ד׳" },
  { day: 4, label: "ה׳" },
  { day: 5, label: "ו׳" },
  { day: 6, label: "ש׳" },
];

// ── Component ─────────────────────────────────────────────────────────────────
interface PostComposerProps {
  pages?: FacebookToken[] | null;
  distributionLists?: DistributionListRow[] | null;
  editingPost?: PostRow | null;
  onEditDone?: () => void;
  templateToLoad?: TemplateRow | null;
  onTemplateLoaded?: () => void;
  draftToResume?: PostRow | null;
  onDraftResumed?: () => void;
}

export function PostComposer({
  pages,
  distributionLists,
  editingPost,
  onEditDone,
  templateToLoad,
  onTemplateLoaded,
  draftToResume,
  onDraftResumed,
}: PostComposerProps) {
  const safePages = pages ?? [];
  const safeLists = distributionLists ?? [];
  const isEditing = !!editingPost;

  const [serverError, setServerError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [successCount, setSuccessCount] = useState<number | null>(null);
  const [templateSaved, setTemplateSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Image upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<PostFormValues>({
    resolver: zodResolver(postSchema),
    defaultValues: {
      facebookTokenId: EXTENSION_SENTINEL,
      distributionListIds: [],
      extraGroupIds: "",
      targetId: "",
      content: "",
      imageUrls: [],
      linkUrl: "",
      publishMode: "now",
      scheduledAt: "",
      recurrenceType: "none",
      recurrenceDays: [],
    },
  });

  // Prefill / clear form on edit mode changes
  useEffect(() => {
    if (editingPost) {
      const localScheduledAt = editingPost.scheduled_at
        ? new Date(editingPost.scheduled_at)
            .toLocaleString("sv-SE")
            .replace(" ", "T")
            .slice(0, 16)
        : "";

      const ep = editingPost as PostRow & {
        target_id?: string | null;
        image_url?: string | null;
        image_urls?: string[];
        link_url?: string | null;
        recurrence_rule?: string | null;
      };

      // Parse existing recurrence rule back into form fields
      let recurrenceType: "none" | "weekly" | "monthly" = "none";
      let recurrenceDays: number[] = [];
      if (ep.recurrence_rule?.startsWith("weekly:")) {
        recurrenceType = "weekly";
        recurrenceDays = ep.recurrence_rule.slice(7).split(",").map(Number);
      } else if (ep.recurrence_rule === "monthly") {
        recurrenceType = "monthly";
      }

      // Normalise image_urls: prefer array, fall back to single image_url
      const imageUrls =
        ep.image_urls?.length
          ? ep.image_urls
          : ep.image_url
          ? [ep.image_url]
          : [];

      form.reset({
        facebookTokenId: EXTENSION_SENTINEL,
        distributionListIds: [],
        extraGroupIds: "",
        targetId: ep.target_id ?? "",
        content: editingPost.content,
        imageUrls,
        linkUrl: ep.link_url ?? "",
        publishMode: editingPost.scheduled_at ? "scheduled" : "now",
        scheduledAt: localScheduledAt,
        recurrenceType,
        recurrenceDays,
      });
    } else {
      form.reset({
        facebookTokenId: EXTENSION_SENTINEL,
        distributionListIds: [],
        extraGroupIds: "",
        targetId: "",
        content: "",
        imageUrls: [],
        linkUrl: "",
        publishMode: "now",
        scheduledAt: "",
        recurrenceType: "none",
        recurrenceDays: [],
      });
    }
    setUploadError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingPost]);

  // Load a template into the form when the Templates tab fires "Use Template"
  useEffect(() => {
    if (!templateToLoad) return;
    form.reset({
      facebookTokenId: EXTENSION_SENTINEL,
      distributionListIds: [],
      extraGroupIds: "",
      targetId: "",
      content: templateToLoad.content,
      imageUrls: templateToLoad.image_urls ?? [],
      linkUrl: templateToLoad.link_url ?? "",
      publishMode: "now",
      scheduledAt: "",
      recurrenceType: "none",
      recurrenceDays: [],
    });
    setServerError(null);
    setTemplateSaved(false);
    onTemplateLoaded?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateToLoad]);

  // Resume a saved draft into the form when PostsTable fires "Resume Edit"
  useEffect(() => {
    if (!draftToResume) return;
    const dr = draftToResume as PostRow & {
      image_urls?: string[];
      image_url?: string | null;
      link_url?: string | null;
    };
    const imageUrls = dr.image_urls?.length
      ? dr.image_urls
      : dr.image_url
      ? [dr.image_url]
      : [];
    form.reset({
      facebookTokenId: EXTENSION_SENTINEL,
      distributionListIds: [],
      extraGroupIds: "",
      targetId: "",
      content: draftToResume.content,
      imageUrls,
      linkUrl: dr.link_url ?? "",
      publishMode: "now",
      scheduledAt: "",
      recurrenceType: "none",
      recurrenceDays: [],
    });
    setServerError(null);
    setTemplateSaved(false);
    onDraftResumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftToResume]);

  // Watched values — coerce to non-nullable so downstream code never crashes on
  // undefined (form.watch can return undefined before the first render commit).
  const publishMode       = form.watch("publishMode");
  const watchedTokenId    = form.watch("facebookTokenId");
  const watchedContent    = form.watch("content");
  const watchedImageUrls  = form.watch("imageUrls")  ?? [];
  const watchedDistIds    = form.watch("distributionListIds") ?? [];
  const watchedExtraIds   = form.watch("extraGroupIds") ?? "";
  const recurrenceType           = form.watch("recurrenceType") ?? "none";
  const recurrenceDays           = form.watch("recurrenceDays") ?? [];
  const contentLength            = watchedContent?.length ?? 0;

  const useExtension = safePages.length === 0 || watchedTokenId === EXTENSION_SENTINEL;

  const useDistList =
    watchedDistIds.length > 0 ||
    !!watchedExtraIds?.trim();

  const totalGroupCount = useMemo(() => {
    const fromLists = safeLists
      .filter((l) => watchedDistIds.includes(l.id))
      .flatMap((l) => l.group_ids);
    const manual = (watchedExtraIds ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return new Set([...fromLists, ...manual]).size;
  }, [watchedDistIds, watchedExtraIds, safeLists]);

  const minDateTime = new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 16);

  // Recurrence rule: derived from form fields
  const resolvedRecurrenceRule = useMemo(() => {
    if (recurrenceType === "weekly" && recurrenceDays.length > 0) {
      return `weekly:${[...recurrenceDays].sort().join(",")}`;
    }
    if (recurrenceType === "monthly") return "monthly";
    return undefined;
  }, [recurrenceType, recurrenceDays]);

  // ── Image upload ────────────────────────────────────────────────────────────
  async function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;

    setIsUploading(true);
    setUploadError(null);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setUploadError("שגיאה: המשתמש אינו מחובר.");
      setIsUploading(false);
      return;
    }

    const newUrls: string[] = [];
    for (const file of files) {
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      const { error } = await supabase.storage
        .from("post_images")
        .upload(path, file, { upsert: false });

      if (error) {
        console.error("[PostComposer] Storage upload error:", error);
        setUploadError(`שגיאה בהעלאת "${file.name}": ${error.message}`);
        break;
      }

      const { data: urlData } = supabase.storage.from("post_images").getPublicUrl(path);
      newUrls.push(urlData.publicUrl);
    }

    if (newUrls.length > 0) {
      form.setValue("imageUrls", [...(watchedImageUrls ?? []), ...newUrls], { shouldValidate: true });
    }

    setIsUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeImage(index: number) {
    form.setValue(
      "imageUrls",
      (watchedImageUrls ?? []).filter((_, i) => i !== index),
      { shouldValidate: true }
    );
  }

  // ── Submit ──────────────────────────────────────────────────────────────────
  function onSubmit(values: PostFormValues) {
    setServerError(null);
    startTransition(async () => {
      if (isEditing && editingPost) {
        const result = await updatePostAction({
          postId: editingPost.id,
          content: values.content,
          targetId: values.targetId?.trim() || undefined,
          imageUrls: values.imageUrls.length ? values.imageUrls : undefined,
          linkUrl: values.linkUrl || undefined,
          publishMode: values.publishMode,
          scheduledAt: values.scheduledAt ? new Date(values.scheduledAt).toISOString() : undefined,
          recurrenceRule: resolvedRecurrenceRule,
        });
        if (result.error) {
          setServerError(result.error);
        } else {
          onEditDone?.();
        }
        return;
      }

      const resolvedTokenId =
        values.facebookTokenId === EXTENSION_SENTINEL
          ? undefined
          : values.facebookTokenId?.trim() || undefined;

      const extraGroupIds = (values.extraGroupIds ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const uniqueExtraGroupIds = [...new Set(extraGroupIds)];

      const result = await createPostAction({
        facebookTokenId: resolvedTokenId,
        targetId: values.targetId?.trim() || undefined,
        distributionListIds: values.distributionListIds.length ? values.distributionListIds : undefined,
        extraGroupIds: uniqueExtraGroupIds.length ? uniqueExtraGroupIds : undefined,
        content: values.content,
        imageUrls: values.imageUrls.length ? values.imageUrls : undefined,
        linkUrl: values.linkUrl || undefined,
        publishMode: values.publishMode,
        scheduledAt: values.scheduledAt ? new Date(values.scheduledAt).toISOString() : undefined,
        recurrenceRule: resolvedRecurrenceRule,
      });

      if (result.error) {
        setServerError(result.error);
      } else {
        setIsSuccess(true);
        setSuccessCount(result.count ?? null);
        form.reset({
          facebookTokenId: values.facebookTokenId ?? EXTENSION_SENTINEL,
          distributionListIds: [],
          extraGroupIds: "",
          targetId: values.targetId ?? "",
          publishMode: "now",
          recurrenceType: "none",
          recurrenceDays: [],
        });
        setTimeout(() => { setIsSuccess(false); setSuccessCount(null); }, 5000);
      }
    });
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200/60 shadow-[0_1px_3px_rgb(0,0,0,0.04)] overflow-hidden">
      <div className="px-6 py-5 border-b border-slate-100">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2.5 text-lg font-semibold tracking-tight text-slate-900">
            {isEditing ? (
              <div className="h-8 w-8 rounded-xl bg-amber-50 flex items-center justify-center">
                <Pencil className="h-4 w-4 text-amber-600" />
              </div>
            ) : (
              <div className="h-8 w-8 rounded-xl bg-blue-50 flex items-center justify-center">
                <Send className="h-4 w-4 text-blue-600" />
              </div>
            )}
            {isEditing ? "עריכת פוסט" : "כתיבת פוסט חדש"}
          </span>
          {isEditing && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-slate-400 hover:text-slate-600 text-xs rounded-xl"
              onClick={onEditDone}
            >
              <X className="h-3.5 w-3.5 ms-1" />
              ביטול עריכה
            </Button>
          )}
        </div>
      </div>

      <div className="p-6">
        {/* Notices */}
        {!isEditing && useExtension && !useDistList && (
          <div className="mb-5 flex items-start gap-2.5 rounded-xl bg-blue-50/60 border border-blue-100 px-4 py-3 text-sm text-blue-700">
            <Puzzle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              הפוסט יישמר במסד הנתונים ויפורסם על ידי{" "}
              <strong>תוסף Chrome</strong> — ודא שהוזן מזהה יעד ושהתוסף פעיל.
            </span>
          </div>
        )}

        {!isEditing && useDistList && (
          <div className="mb-5 flex items-start gap-2.5 rounded-xl bg-violet-50/60 border border-violet-100 px-4 py-3 text-sm text-violet-700">
            <ListChecks className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              הפוסט יפורסם ל-<strong>{totalGroupCount} קבוצות ייחודיות</strong> —
              עם השהיה של 2–5 דקות בין קבוצה לקבוצה.
            </span>
          </div>
        )}

        {isSuccess && (
          <div className="mb-4 flex items-center gap-2 rounded-xl bg-emerald-50/60 border border-emerald-100 px-4 py-3 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>
              {successCount && successCount > 1
                ? `נוצרו ${successCount} פוסטים — יפורסמו בהפרש של 2–5 דקות!`
                : publishMode === "now"
                ? "הפוסט נשמר ויפורסם בקרוב על ידי התוסף!"
                : "הפוסט תוזמן בהצלחה!"}
            </span>
          </div>
        )}

        {templateSaved && (
          <div className="mb-4 flex items-center gap-2 rounded-xl bg-emerald-50/60 border border-emerald-100 px-4 py-3 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            התבנית נשמרה בהצלחה! תמצא אותה בלשונית התבניות.
          </div>
        )}

        {serverError && (
          <div className="mb-4 rounded-xl bg-red-50/60 border border-red-100 px-4 py-3 text-sm text-red-600">
            {serverError}
          </div>
        )}

        {/* ── Two-column layout ──────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

          {/* ── Form ──────────────────────────────────────────────────────── */}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>

              {/* Channel selector (hidden in edit mode) */}
              {!isEditing && safePages.length > 0 && (
                <FormField
                  control={form.control}
                  name="facebookTokenId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ערוץ פרסום</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={EXTENSION_SENTINEL}>
                            🧩 פרופיל אישי (באמצעות התוסף)
                          </SelectItem>
                          {safePages.map((page) => (
                            <SelectItem key={page.id} value={page.id}>
                              📄 {page.page_name ?? `דף ${page.page_id}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription className="text-xs">
                        {useExtension
                          ? "יפורסם דרך תוסף Chrome עם הפרופיל האישי"
                          : "יפורסם דרך Graph API עם אסימון הדף"}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Distribution lists (checkbox panel, hidden in edit mode) */}
              {!isEditing && safeLists.length > 0 && (
                <FormField
                  control={form.control}
                  name="distributionListIds"
                  render={() => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1.5">
                        <ListChecks className="h-3.5 w-3.5 text-muted-foreground" />
                        יעדי פרסום
                      </FormLabel>
                      <DistributionPanel
                        lists={safeLists}
                        selectedIds={watchedDistIds}
                        extraGroupIds={watchedExtraIds}
                        onChangeIds={(ids) =>
                          form.setValue("distributionListIds", ids, {
                            shouldDirty: true,
                            shouldTouch: true,
                          })
                        }
                        onChangeExtra={(val) =>
                          form.setValue("extraGroupIds", val, { shouldDirty: true })
                        }
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Single target ID — shown only when no dist lists selected */}
              {!useDistList && (
                <FormField
                  control={form.control}
                  name="targetId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1.5">
                        <Target className="h-3.5 w-3.5 text-muted-foreground" />
                        מזהה יעד{" "}
                        <span className="text-muted-foreground font-normal text-xs">
                          {safePages.length === 0 ? "(נדרש לתוסף)" : "(אופציונלי)"}
                        </span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="123456789012345"
                          dir="ltr"
                          className="text-start font-mono"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription className="text-xs">
                        מזהה קבוצת הפייסבוק לפרסום דרך התוסף
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <Separator />

              {/* Post content */}
              <FormField
                control={form.control}
                name="content"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel>תוכן הפוסט</FormLabel>
                      <span
                        className={`text-xs tabular-nums ${
                          contentLength > 60000 ? "text-destructive" : "text-muted-foreground"
                        }`}
                      >
                        {contentLength.toLocaleString("he-IL")} / 63,206
                      </span>
                    </div>
                    <FormControl>
                      <Textarea
                        placeholder="מה תרצה לשתף היום?"
                        className="min-h-[140px]"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Multi-image upload */}
              <FormField
                control={form.control}
                name="imageUrls"
                render={() => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-1.5 text-muted-foreground font-normal">
                      <ImageIcon className="h-3.5 w-3.5" />
                      תמונות (אופציונלי)
                    </FormLabel>

                    {/* Hidden file input — multiple */}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp"
                      multiple
                      className="hidden"
                      onChange={handleImageSelect}
                    />

                    {/* Thumbnail grid */}
                    {(watchedImageUrls ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {(watchedImageUrls ?? []).map((url, idx) => (
                          <div key={idx} className="relative group">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={url}
                              alt={`תמונה ${idx + 1}`}
                              className="h-20 w-20 rounded-xl object-cover border border-slate-200/60"
                            />
                            <button
                              type="button"
                              onClick={() => removeImage(idx)}
                              className="absolute -top-1.5 -end-1.5 h-5 w-5 rounded-full bg-destructive text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isUploading}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {isUploading ? (
                        <Loader2 className="ms-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="ms-2 h-4 w-4" />
                      )}
                      {isUploading
                        ? "מעלה..."
                        : (watchedImageUrls ?? []).length > 0
                        ? "הוסף תמונות נוספות"
                        : "העלה תמונות"}
                    </Button>

                    {uploadError && (
                      <p className="text-xs text-destructive">{uploadError}</p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Link URL */}
              <FormField
                control={form.control}
                name="linkUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-1.5 text-muted-foreground font-normal">
                      <Link2 className="h-3.5 w-3.5" />
                      קישור לפוסט (אופציונלי)
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="url"
                        placeholder="https://example.com/my-page"
                        dir="ltr"
                        className="text-start"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Separator />

              {/* Publish mode */}
              <FormField
                control={form.control}
                name="publishMode"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel>מועד פרסום</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        value={field.value}
                        className="flex flex-col gap-2 sm:flex-row sm:gap-4"
                      >
                        <label
                          htmlFor="mode-now"
                          className={`flex items-center gap-2.5 cursor-pointer rounded-xl border px-4 py-3 transition-all duration-200 ${
                            field.value === "now"
                              ? "border-blue-200 bg-blue-50/50 shadow-sm"
                              : "border-slate-200 hover:border-slate-300"
                          }`}
                        >
                          <RadioGroupItem value="now" id="mode-now" />
                          <div>
                            <p className="text-sm font-medium text-slate-900">פרסם עכשיו</p>
                            <p className="text-xs text-slate-500">יישמר ויפורסם בדקה הקרובה</p>
                          </div>
                        </label>

                        <label
                          htmlFor="mode-scheduled"
                          className={`flex items-center gap-2.5 cursor-pointer rounded-xl border px-4 py-3 transition-all duration-200 ${
                            field.value === "scheduled"
                              ? "border-blue-200 bg-blue-50/50 shadow-sm"
                              : "border-slate-200 hover:border-slate-300"
                          }`}
                        >
                          <RadioGroupItem value="scheduled" id="mode-scheduled" />
                          <div>
                            <p className="text-sm font-medium text-slate-900">תזמן לעתיד</p>
                            <p className="text-xs text-slate-500">בחר תאריך ושעה</p>
                          </div>
                        </label>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {publishMode === "scheduled" && (
                <>
                  <FormField
                    control={form.control}
                    name="scheduledAt"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>תאריך ושעת פרסום</FormLabel>
                        <FormControl>
                          <Input
                            type="datetime-local"
                            dir="ltr"
                            className="text-start w-full sm:w-auto"
                            min={minDateTime}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Recurrence section */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50/40 px-4 py-3 space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <RefreshCw className="h-3.5 w-3.5" />
                      חזרה (אופציונלי)
                    </div>

                    <FormField
                      control={form.control}
                      name="recurrenceType"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <RadioGroup
                              onValueChange={field.onChange}
                              value={field.value}
                              className="space-y-1.5"
                            >
                              <label htmlFor="rec-none" className="flex items-center gap-2 cursor-pointer text-sm">
                                <RadioGroupItem value="none" id="rec-none" />
                                חד-פעמי (ברירת מחדל)
                              </label>
                              <label htmlFor="rec-weekly" className="flex items-center gap-2 cursor-pointer text-sm">
                                <RadioGroupItem value="weekly" id="rec-weekly" />
                                שבועי
                              </label>
                              <label htmlFor="rec-monthly" className="flex items-center gap-2 cursor-pointer text-sm">
                                <RadioGroupItem value="monthly" id="rec-monthly" />
                                חודשי (באותו תאריך)
                              </label>
                            </RadioGroup>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Weekday checkboxes */}
                    {recurrenceType === "weekly" && (
                      <FormField
                        control={form.control}
                        name="recurrenceDays"
                        render={() => (
                          <FormItem>
                            <div className="flex flex-wrap gap-2 pt-1">
                              {WEEKDAYS.map(({ day, label }) => {
                                const checked = recurrenceDays.includes(day);
                                return (
                                  <label
                                    key={day}
                                    className={`flex items-center gap-1.5 cursor-pointer rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                                      checked
                                        ? "border-primary bg-primary/10 text-primary font-medium"
                                        : "border-input hover:border-muted-foreground/40"
                                    }`}
                                  >
                                    <Checkbox
                                      checked={checked}
                                      onCheckedChange={(c) => {
                                        const current = form.getValues("recurrenceDays");
                                        form.setValue(
                                          "recurrenceDays",
                                          c ? [...current, day] : current.filter((d) => d !== day)
                                        );
                                      }}
                                      className="h-3 w-3"
                                    />
                                    {label}
                                  </label>
                                );
                              })}
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                  </div>
                </>
              )}

              {/* Submit row */}
              <div className="flex flex-wrap gap-2.5 pt-1">
                <Button
                  type="submit"
                  className="w-full sm:w-auto rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-sm hover:shadow-md transition-all duration-200"
                  disabled={isPending || isUploading}
                >
                  {isPending ? (
                    <><Loader2 className="ms-2 h-4 w-4 animate-spin" />שומר...</>
                  ) : isEditing ? (
                    <><Pencil className="ms-2 h-4 w-4" />שמור שינויים</>
                  ) : publishMode === "now" ? (
                    <><Send className="ms-2 h-4 w-4" />שמור לפרסום</>
                  ) : (
                    <><CalendarClock className="ms-2 h-4 w-4" />תזמן פרסום</>
                  )}
                </Button>

                {!isEditing && (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full sm:w-auto rounded-xl border-slate-200 hover:bg-slate-50 transition-all duration-200"
                    disabled={isPending || isUploading}
                    onClick={() => {
                      const values = form.getValues();
                      if (!values.content.trim()) return;
                      setTemplateSaved(false);
                      startTransition(async () => {
                        const result = await saveAsTemplateAction({
                          content: values.content,
                          imageUrls: values.imageUrls.length ? values.imageUrls : undefined,
                          linkUrl: values.linkUrl || undefined,
                        });
                        if (result.error) {
                          setServerError(result.error);
                        } else {
                          setTemplateSaved(true);
                          setTimeout(() => setTemplateSaved(false), 5000);
                        }
                      });
                    }}
                  >
                    שמור כתבנית
                  </Button>
                )}
              </div>
            </form>
          </Form>

          {/* ── Live preview ───────────────────────────────────────────────── */}
          <div className="lg:sticky lg:top-24">
            <PostPreview
              content={watchedContent}
              imageUrl={(watchedImageUrls ?? [])[0]}
            />
          </div>

        </div>
      </div>
    </div>
  );
}
