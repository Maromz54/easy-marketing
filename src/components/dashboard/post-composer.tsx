"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Loader2, Send, CalendarClock, Image as ImageIcon,
  Link2, CheckCircle2, Target, Puzzle, ListChecks, Pencil, X, Upload,
} from "lucide-react";

import { createPostAction, updatePostAction } from "@/actions/posts";
import { createClient } from "@/lib/supabase/client";
import { PostPreview } from "@/components/dashboard/post-preview";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Database } from "@/lib/supabase/types";
import type { PostRow } from "@/components/dashboard/posts-table";

type FacebookToken = Database["public"]["Tables"]["facebook_tokens"]["Row"];
type DistributionListRow = Database["public"]["Tables"]["distribution_lists"]["Row"];

// ── Validation Schema ─────────────────────────────────────────────────────────
const urlOrEmpty = z
  .string()
  .optional()
  .refine((v) => !v || v === "" || /^https?:\/\/.+/.test(v), {
    message: "כתובת URL חייבת להתחיל ב-http:// או https://",
  });

const postSchema = z
  .object({
    facebookTokenId: z.string().optional(),
    distributionListId: z.string().optional(),
    targetId: z
      .string()
      .optional()
      .refine((v) => !v || v === "" || /^\d+$/.test(v.trim()), {
        message: "מזהה היעד חייב להיות מספרי בלבד (ספרות בלבד, ללא רווחים).",
      }),
    content: z
      .string()
      .min(1, { message: "תוכן הפוסט הוא חובה." })
      .max(63206, { message: "הפוסט ארוך מדי (מקסימום 63,206 תווים)." }),
    imageUrl: urlOrEmpty,
    linkUrl: urlOrEmpty,
    publishMode: z.enum(["now", "scheduled"]),
    scheduledAt: z.string().optional(),
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
  });

type PostFormValues = z.infer<typeof postSchema>;

// ── Sentinels ─────────────────────────────────────────────────────────────────
const EXTENSION_SENTINEL = "__none__";
const DIST_LIST_SENTINEL = "__none__";

// ── Component ─────────────────────────────────────────────────────────────────
interface PostComposerProps {
  pages?: FacebookToken[] | null;
  distributionLists?: DistributionListRow[] | null;
  editingPost?: PostRow | null;
  onEditDone?: () => void;
}

export function PostComposer({ pages, distributionLists, editingPost, onEditDone }: PostComposerProps) {
  const safePages = pages ?? [];
  const safeLists = distributionLists ?? [];
  const isEditing = !!editingPost;

  const [serverError, setServerError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [successCount, setSuccessCount] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  // Image upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<PostFormValues>({
    resolver: zodResolver(postSchema),
    defaultValues: {
      facebookTokenId: EXTENSION_SENTINEL,
      distributionListId: DIST_LIST_SENTINEL,
      targetId: "",
      content: "",
      imageUrl: "",
      linkUrl: "",
      publishMode: "now",
      scheduledAt: "",
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

      form.reset({
        facebookTokenId: EXTENSION_SENTINEL,
        distributionListId: DIST_LIST_SENTINEL,
        targetId: (editingPost as unknown as { target_id: string | null }).target_id ?? "",
        content: editingPost.content,
        imageUrl: (editingPost as unknown as { image_url: string | null }).image_url ?? "",
        linkUrl: (editingPost as unknown as { link_url: string | null }).link_url ?? "",
        publishMode: editingPost.scheduled_at ? "scheduled" : "now",
        scheduledAt: localScheduledAt,
      });
    } else {
      form.reset({
        facebookTokenId: EXTENSION_SENTINEL,
        distributionListId: DIST_LIST_SENTINEL,
        targetId: "",
        content: "",
        imageUrl: "",
        linkUrl: "",
        publishMode: "now",
        scheduledAt: "",
      });
    }
    setUploadError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingPost]);

  // Watched values
  const publishMode      = form.watch("publishMode");
  const watchedTokenId   = form.watch("facebookTokenId");
  const watchedDistListId = form.watch("distributionListId");
  const watchedContent   = form.watch("content");
  const watchedImageUrl  = form.watch("imageUrl");
  const contentLength    = watchedContent?.length ?? 0;

  const useExtension  = safePages.length === 0 || watchedTokenId === EXTENSION_SENTINEL;
  const useDistList   = !!watchedDistListId && watchedDistListId !== DIST_LIST_SENTINEL;
  const selectedList  = safeLists.find((l) => l.id === watchedDistListId);

  const minDateTime = new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 16);

  // ── Image upload ───────────────────────────────────────────────────────────
  async function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setUploadError("שגיאה: המשתמש אינו מחובר.");
      setIsUploading(false);
      return;
    }

    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `${user.id}/${Date.now()}.${ext}`;

    const { error } = await supabase.storage
      .from("post_images")
      .upload(path, file, { upsert: false });

    if (error) {
      console.error("[PostComposer] Storage upload error:", error);
      setUploadError(`שגיאה בהעלאת התמונה: ${error.message}`);
    } else {
      const { data: urlData } = supabase.storage
        .from("post_images")
        .getPublicUrl(path);
      form.setValue("imageUrl", urlData.publicUrl, { shouldValidate: true });
    }

    setIsUploading(false);
    // Reset the file input so the same file can be re-selected if removed
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  function onSubmit(values: PostFormValues) {
    setServerError(null);
    startTransition(async () => {
      if (isEditing && editingPost) {
        const result = await updatePostAction({
          postId: editingPost.id,
          content: values.content,
          targetId: values.targetId?.trim() || undefined,
          imageUrl: values.imageUrl || undefined,
          linkUrl: values.linkUrl || undefined,
          publishMode: values.publishMode,
          // datetime-local gives a local-time string with no timezone (e.g. "2026-03-23T15:00").
          // Convert to UTC ISO so Postgres stores the correct moment in time.
          scheduledAt: values.scheduledAt ? new Date(values.scheduledAt).toISOString() : undefined,
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

      const resolvedDistListId =
        values.distributionListId === DIST_LIST_SENTINEL
          ? undefined
          : values.distributionListId;

      const result = await createPostAction({
        facebookTokenId: resolvedTokenId,
        targetId: values.targetId?.trim() || undefined,
        distributionListId: resolvedDistListId,
        content: values.content,
        imageUrl: values.imageUrl || undefined,
        linkUrl: values.linkUrl || undefined,
        publishMode: values.publishMode,
        scheduledAt: values.scheduledAt ? new Date(values.scheduledAt).toISOString() : undefined,
      });

      if (result.error) {
        setServerError(result.error);
      } else {
        setIsSuccess(true);
        setSuccessCount(result.count ?? null);
        form.reset({
          facebookTokenId: values.facebookTokenId ?? EXTENSION_SENTINEL,
          distributionListId: DIST_LIST_SENTINEL,
          targetId: values.targetId ?? "",
          publishMode: "now",
        });
        setTimeout(() => { setIsSuccess(false); setSuccessCount(null); }, 5000);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-lg">
          <span className="flex items-center gap-2">
            {isEditing ? (
              <Pencil className="h-5 w-5 text-primary" />
            ) : (
              <Send className="h-5 w-5 text-primary" />
            )}
            {isEditing ? "עריכת פוסט" : "כתיבת פוסט חדש"}
          </span>
          {isEditing && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground text-xs"
              onClick={onEditDone}
            >
              <X className="h-3.5 w-3.5 ms-1" />
              ביטול עריכה
            </Button>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent>
        {/* Notices */}
        {!isEditing && useExtension && !useDistList && (
          <div className="mb-5 flex items-start gap-2.5 rounded-md bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
            <Puzzle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              הפוסט יישמר במסד הנתונים ויפורסם על ידי{" "}
              <strong>תוסף Chrome</strong> באמצעות הפרופיל האישי שלך —
              ודא שהוזן מזהה יעד (קבוצה) ושהתוסף פעיל.
            </span>
          </div>
        )}

        {!isEditing && useDistList && selectedList && (
          <div className="mb-5 flex items-start gap-2.5 rounded-md bg-purple-50 border border-purple-200 px-4 py-3 text-sm text-purple-800">
            <ListChecks className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              הפוסט יפורסם ל-<strong>{selectedList.group_ids.length} קבוצות</strong>{" "}
              מרשימת <strong>{selectedList.name}</strong> — עם השהיה של 2–5 דקות בין קבוצה לקבוצה.
            </span>
          </div>
        )}

        {isSuccess && (
          <div className="mb-4 flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>
              {successCount && successCount > 1
                ? `נוצרו ${successCount} פוסטים — יפורסמו בהפרש של 2–5 דקות בין קבוצה לקבוצה!`
                : publishMode === "now"
                ? "הפוסט נשמר ויפורסם בקרוב על ידי התוסף!"
                : "הפוסט תוזמן בהצלחה!"}
            </span>
          </div>
        )}

        {serverError && (
          <div className="mb-4 rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
            {serverError}
          </div>
        )}

        {/* ── Two-column layout: form + live preview ─────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

          {/* ── Form column ───────────────────────────────────────────────── */}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>

              {/* Page selector + Distribution list (hidden in edit mode) */}
              {!isEditing && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {safePages.length > 0 && (
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

                  {safeLists.length > 0 && (
                    <FormField
                      control={form.control}
                      name="distributionListId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center gap-1.5">
                            <ListChecks className="h-3.5 w-3.5 text-muted-foreground" />
                            רשימת תפוצה
                          </FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value={DIST_LIST_SENTINEL}>
                                פרסום ליעד בודד
                              </SelectItem>
                              {safeLists.map((list) => (
                                <SelectItem key={list.id} value={list.id}>
                                  {list.name} ({list.group_ids.length} קבוצות)
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormDescription className="text-xs">
                            {useDistList
                              ? `יפורסם ל-${selectedList?.group_ids.length ?? 0} קבוצות עם השהיה`
                              : "בחר רשימה לפרסום מרובה"}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>
              )}

              {/* Target ID */}
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

              {useDistList && selectedList && (
                <div className="rounded-md border border-purple-200 bg-purple-50/50 px-4 py-3 text-sm text-purple-700">
                  <span className="font-medium">{selectedList.name}</span>
                  {" — "}
                  {selectedList.group_ids.slice(0, 3).join(", ")}
                  {selectedList.group_ids.length > 3 && ` +${selectedList.group_ids.length - 3} נוספות`}
                </div>
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

              {/* Image upload */}
              <FormField
                control={form.control}
                name="imageUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-1.5 text-muted-foreground font-normal">
                      <ImageIcon className="h-3.5 w-3.5" />
                      תמונה (אופציונלי)
                    </FormLabel>

                    {/* Hidden file input */}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp"
                      className="hidden"
                      onChange={handleImageSelect}
                    />

                    {/* Hidden form field value — set programmatically */}
                    <input type="hidden" {...field} />

                    {field.value ? (
                      /* Thumbnail + remove */
                      <div className="flex items-start gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={field.value}
                          alt="תצוגה מקדימה"
                          className="h-20 w-20 rounded-md object-cover border"
                        />
                        <div className="flex flex-col gap-1.5">
                          <p className="text-xs text-muted-foreground truncate max-w-[180px]" dir="ltr">
                            {field.value.split("/").pop()}
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:text-destructive w-fit"
                            onClick={() => form.setValue("imageUrl", "", { shouldValidate: true })}
                          >
                            <X className="h-3.5 w-3.5 ms-1" />
                            הסר תמונה
                          </Button>
                        </div>
                      </div>
                    ) : (
                      /* Upload button */
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
                        {isUploading ? "מעלה..." : "העלה תמונה"}
                      </Button>
                    )}

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
                          className={`flex items-center gap-2.5 cursor-pointer rounded-lg border px-4 py-3 transition-colors ${
                            field.value === "now"
                              ? "border-primary bg-primary/5"
                              : "border-input hover:border-muted-foreground/40"
                          }`}
                        >
                          <RadioGroupItem value="now" id="mode-now" />
                          <div>
                            <p className="text-sm font-medium">פרסם עכשיו</p>
                            <p className="text-xs text-muted-foreground">יישמר ויפורסם בדקה הקרובה</p>
                          </div>
                        </label>

                        <label
                          htmlFor="mode-scheduled"
                          className={`flex items-center gap-2.5 cursor-pointer rounded-lg border px-4 py-3 transition-colors ${
                            field.value === "scheduled"
                              ? "border-primary bg-primary/5"
                              : "border-input hover:border-muted-foreground/40"
                          }`}
                        >
                          <RadioGroupItem value="scheduled" id="mode-scheduled" />
                          <div>
                            <p className="text-sm font-medium">תזמן לעתיד</p>
                            <p className="text-xs text-muted-foreground">בחר תאריך ושעה</p>
                          </div>
                        </label>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {publishMode === "scheduled" && (
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
              )}

              {/* Submit */}
              <Button type="submit" className="w-full sm:w-auto" disabled={isPending || isUploading}>
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
            </form>
          </Form>

          {/* ── Live preview column ──────────────────────────────────────── */}
          <div className="lg:sticky lg:top-24">
            <PostPreview content={watchedContent} imageUrl={watchedImageUrl} />
          </div>

        </div>
      </CardContent>
    </Card>
  );
}
