"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Loader2, Send, CalendarClock, Image as ImageIcon,
  Link2, CheckCircle2, Target, Puzzle,
} from "lucide-react";

import { createPostAction } from "@/actions/posts";
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

type FacebookToken = Database["public"]["Tables"]["facebook_tokens"]["Row"];

// ── Validation Schema ─────────────────────────────────────────────────────────
const urlOrEmpty = z
  .string()
  .optional()
  .refine((v) => !v || v === "" || /^https?:\/\/.+/.test(v), {
    message: "כתובת URL חייבת להתחיל ב-http:// או https://",
  });

const postSchema = z
  .object({
    // Optional — when empty the post is saved for the Chrome Extension to handle
    facebookTokenId: z.string().optional(),
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

// ── Component ─────────────────────────────────────────────────────────────────
interface PostComposerProps {
  pages?: FacebookToken[] | null;
}

export function PostComposer({ pages }: PostComposerProps) {
  const safePages = pages ?? [];

  const [serverError, setServerError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  const form = useForm<PostFormValues>({
    resolver: zodResolver(postSchema),
    defaultValues: {
      facebookTokenId: safePages[0]?.id ?? "",
      targetId: "",
      content: "",
      imageUrl: "",
      linkUrl: "",
      publishMode: "now",
      scheduledAt: "",
    },
  });

  const publishMode = form.watch("publishMode");
  const contentLength = form.watch("content")?.length ?? 0;

  // Min datetime: now + 5 minutes
  const minDateTime = new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 16);

  function onSubmit(values: PostFormValues) {
    setServerError(null);
    startTransition(async () => {
      const result = await createPostAction({
        facebookTokenId: values.facebookTokenId?.trim() || undefined,
        targetId: values.targetId?.trim() || undefined,
        content: values.content,
        imageUrl: values.imageUrl || undefined,
        linkUrl: values.linkUrl || undefined,
        publishMode: values.publishMode,
        scheduledAt: values.scheduledAt || undefined,
      });

      if (result.error) {
        setServerError(result.error);
      } else {
        setIsSuccess(true);
        form.reset({
          facebookTokenId: values.facebookTokenId ?? "",
          targetId: values.targetId ?? "",
          publishMode: "now",
        });
        setTimeout(() => setIsSuccess(false), 4000);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Send className="h-5 w-5 text-primary" />
          כתיבת פוסט חדש
        </CardTitle>
      </CardHeader>

      <CardContent>
        {/* Extension-mode notice when no pages are connected */}
        {safePages.length === 0 && (
          <div className="mb-5 flex items-start gap-2.5 rounded-md bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
            <Puzzle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              לא חוברו דפי פייסבוק. הפוסט יישמר במסד הנתונים ויפורסם
              על ידי <strong>תוסף Chrome</strong> — ודא שהוזן מזהה יעד (קבוצה).
            </span>
          </div>
        )}

        {/* Success */}
        {isSuccess && (
          <div className="mb-4 flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>
              {publishMode === "now"
                ? "הפוסט נשמר ויפורסם בקרוב על ידי התוסף!"
                : "הפוסט תוזמן בהצלחה!"}
            </span>
          </div>
        )}

        {/* Server error */}
        {serverError && (
          <div className="mb-4 rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
            {serverError}
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>

            {/* ── Row: Page selector (optional) + Target ID ────────────── */}
            <div className="grid gap-4 sm:grid-cols-2">

              {/* Page selector — only shown when pages are connected */}
              {safePages.length > 0 && (
                <FormField
                  control={form.control}
                  name="facebookTokenId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>דף פייסבוק (מקור האסימון)</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="בחר דף (אופציונלי)..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {safePages.map((page) => (
                            <SelectItem key={page.id} value={page.id}>
                              {page.page_name ?? `דף ${page.page_id}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription className="text-xs">
                        השאר ריק לפרסום דרך תוסף Chrome בלבד
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Target ID — Group ID for extension posts */}
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
            </div>

            <Separator />

            {/* ── Post content ─────────────────────────────────────────── */}
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

            {/* ── Optional: Image URL ─────────────────────────────────── */}
            <FormField
              control={form.control}
              name="imageUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-1.5 text-muted-foreground font-normal">
                    <ImageIcon className="h-3.5 w-3.5" />
                    כתובת תמונה (אופציונלי)
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="url"
                      placeholder="https://example.com/image.jpg"
                      dir="ltr"
                      className="text-start"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* ── Optional: Link URL ──────────────────────────────────── */}
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

            {/* ── Publish mode ─────────────────────────────────────────── */}
            <FormField
              control={form.control}
              name="publishMode"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel>מועד פרסום</FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      defaultValue={field.value}
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
                          <p className="text-xs text-muted-foreground">
                            יישמר ויפורסם בדקה הקרובה
                          </p>
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

            {/* ── Date/Time picker ─────────────────────────────────────── */}
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

            {/* ── Submit ───────────────────────────────────────────────── */}
            <Button type="submit" className="w-full sm:w-auto" disabled={isPending}>
              {isPending ? (
                <><Loader2 className="ms-2 h-4 w-4 animate-spin" />שומר...</>
              ) : publishMode === "now" ? (
                <><Send className="ms-2 h-4 w-4" />שמור לפרסום</>
              ) : (
                <><CalendarClock className="ms-2 h-4 w-4" />תזמן פרסום</>
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
