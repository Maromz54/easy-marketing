"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, ListChecks, CheckCircle2 } from "lucide-react";

import { createDistributionListAction } from "@/actions/distribution-lists";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
const distributionListSchema = z.object({
  name: z
    .string()
    .min(1, { message: "שם הרשימה הוא חובה." })
    .max(100, { message: "השם ארוך מדי (מקסימום 100 תווים)." }),
  groupIdsRaw: z
    .string()
    .min(1, { message: "יש להזין לפחות מזהה קבוצה אחד." })
    .refine(
      (v) => {
        const ids = v.split(",").map((s) => s.trim()).filter(Boolean);
        return ids.length > 0 && ids.every((id) => /^\d+$/.test(id));
      },
      { message: "כל מזהה קבוצה חייב להיות מספרי בלבד. הפרד בין מזהים בפסיק." }
    )
    .refine(
      (v) => {
        const ids = v.split(",").map((s) => s.trim()).filter(Boolean);
        return ids.length <= 50;
      },
      { message: "ניתן להוסיף עד 50 קבוצות לרשימה." }
    ),
});

type DistributionListFormValues = z.infer<typeof distributionListSchema>;

// ── Component ─────────────────────────────────────────────────────────────────
export function DistributionListForm() {
  const [serverError, setServerError] = useState<string | null>(null);
  const [successName, setSuccessName] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const form = useForm<DistributionListFormValues>({
    resolver: zodResolver(distributionListSchema),
    defaultValues: { name: "", groupIdsRaw: "" },
  });

  function onSubmit(values: DistributionListFormValues) {
    setServerError(null);
    setSuccessName(null);
    startTransition(async () => {
      const groupIds = values.groupIdsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const result = await createDistributionListAction({ name: values.name, groupIds });

      if (result.error) {
        setServerError(result.error);
      } else {
        setSuccessName(values.name);
        form.reset();
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ListChecks className="h-5 w-5 text-primary" />
          יצירת רשימת תפוצה חדשה
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Success */}
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

            {/* Group IDs */}
            <FormField
              control={form.control}
              name="groupIdsRaw"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>מזהי קבוצות (מופרדים בפסיק)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="123456789012345, 987654321098765, 112233445566778"
                      dir="ltr"
                      className="min-h-[80px] font-mono text-sm"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription className="text-xs">
                    הזן את מזהי קבוצות הפייסבוק מופרדים בפסיקים. המזהה מופיע בכתובת הקבוצה (מספרים בלבד).
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Separator />

            <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
              {isPending ? (
                <>
                  <Loader2 className="ms-2 h-4 w-4 animate-spin" />
                  יוצר רשימה...
                </>
              ) : (
                <>
                  <ListChecks className="ms-2 h-4 w-4" />
                  צור רשימה
                </>
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
