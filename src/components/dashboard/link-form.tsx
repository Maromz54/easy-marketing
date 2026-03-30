"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Link2, CheckCircle2, Copy, ExternalLink } from "lucide-react";

import { createLinkAction } from "@/actions/links";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

// ── Schema ────────────────────────────────────────────────────────────────────
const linkSchema = z.object({
  destination: z
    .string()
    .trim()
    .min(1, { message: "כתובת היעד היא שדה חובה." })
    .refine(
      (v) => {
        const url = /^https?:\/\//i.test(v) ? v : `https://${v}`;
        try { new URL(url); return true; } catch { return false; }
      },
      { message: "אנא הזן כתובת URL תקינה." }
    ),
  label: z.string().trim().max(80, { message: "השם ארוך מדי (מקסימום 80 תווים)." }).optional(),
  // Form inputs always produce strings (never undefined), so we must NOT use
  // .optional() here — it inserts ZodOptional between .trim() and .refine(),
  // breaking the execution order in Zod v4's resolver path.
  // Empty string is explicitly allowed and converted to undefined in onSubmit.
  customSlug: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || /^[a-z0-9_-]{2,50}$/.test(v),
      { message: "הסיומת יכולה להכיל רק אותיות אנגלית קטנות, מספרים, מקף ו-underscore (2–50 תווים)." }
    ),
});

type LinkFormValues = z.infer<typeof linkSchema>;

// ── Component ─────────────────────────────────────────────────────────────────
interface LinkFormProps {
  appUrl: string;
}

export function LinkForm({ appUrl }: LinkFormProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [createdSlug, setCreatedSlug] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  const form = useForm<LinkFormValues>({
    resolver: zodResolver(linkSchema),
    defaultValues: { destination: "", label: "", customSlug: "" },
  });

  const shortUrl = createdSlug ? `${appUrl}/r/${createdSlug}` : null;

  function onSubmit(values: LinkFormValues) {
    setServerError(null);
    setCreatedSlug(null);
    startTransition(async () => {
      const result = await createLinkAction({
        destination: values.destination,
        label: values.label || undefined,
        customSlug: values.customSlug || undefined,
      });

      if (result.error) {
        setServerError(result.error);
      } else if (result.slug) {
        setCreatedSlug(result.slug);
        form.reset();
      }
    });
  }

  function copyToClipboard() {
    if (!shortUrl) return;
    navigator.clipboard.writeText(shortUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Link2 className="h-5 w-5 text-primary" />
          יצירת קישור חדש
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ── Success banner ──────────────────────────────────────── */}
        {shortUrl && (
          <div className="rounded-lg bg-green-50 border border-green-200 p-4 space-y-2">
            <div className="flex items-center gap-2 text-green-800 font-medium text-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              הקישור נוצר בהצלחה!
            </div>
            <div className="flex items-center gap-2">
              <code
                className="flex-1 rounded bg-white border border-green-200 px-3 py-1.5 text-sm font-mono text-green-900 truncate"
                dir="ltr"
              >
                {shortUrl}
              </code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={copyToClipboard}
                className="shrink-0"
              >
                {copied ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                <span className="me-1">{copied ? "הועתק!" : "העתק"}</span>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                asChild
              >
                <a href={shortUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            </div>
          </div>
        )}

        {/* ── Server error ────────────────────────────────────────── */}
        {serverError && (
          <div className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
            {serverError}
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>

            {/* Destination URL */}
            <FormField
              control={form.control}
              name="destination"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    כתובת יעד <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="https://wa.me/972501234567"
                      dir="ltr"
                      className="text-start"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    לאן יועברו המשתמשים לאחר הלחיצה (לינק לוואטסאפ, אתר, דף נחיתה וכד׳)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              {/* Label */}
              <FormField
                control={form.control}
                name="label"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      שם הקישור{" "}
                      <span className="text-muted-foreground font-normal text-xs">(אופציונלי)</span>
                    </FormLabel>
                    <FormControl>
                      <Input placeholder='למשל: "קמפיין יולי"' {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Custom slug */}
              <FormField
                control={form.control}
                name="customSlug"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      סיומת מותאמת{" "}
                      <span className="text-muted-foreground font-normal text-xs">(אופציונלי)</span>
                    </FormLabel>
                    <FormControl>
                      {/* Slug is always LTR */}
                      <div className="flex items-center gap-0">
                        <span className="inline-flex h-10 items-center rounded-s-md border border-e-0 border-input bg-muted px-3 text-sm text-muted-foreground shrink-0">
                          /r/
                        </span>
                        <Input
                          placeholder="july-sale"
                          dir="ltr"
                          className="rounded-s-none text-start"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormDescription>
                      השאר ריק לסיומת אוטומטית
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
              {isPending ? (
                <>
                  <Loader2 className="ms-2 h-4 w-4 animate-spin" />
                  יוצר קישור...
                </>
              ) : (
                <>
                  <Link2 className="ms-2 h-4 w-4" />
                  צור קישור
                </>
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
