"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { Loader2, CheckCircle2 } from "lucide-react";

import { registerAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

// ── Validation schema (Hebrew messages) ────────────────────────────────────
const registerSchema = z
  .object({
    fullName: z
      .string()
      .min(2, { message: "שם מלא חייב להכיל לפחות 2 תווים." })
      .max(80, { message: "שם מלא ארוך מדי." }),
    email: z
      .string()
      .min(1, { message: "שדה האימייל הוא חובה." })
      .email({ message: "אנא הזן כתובת אימייל תקינה." }),
    password: z
      .string()
      .min(6, { message: "הסיסמה חייבת להכיל לפחות 6 תווים." }),
    confirmPassword: z
      .string()
      .min(1, { message: "אנא אשר את הסיסמה." }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "הסיסמאות אינן תואמות.",
    path: ["confirmPassword"],
  });

type RegisterFormValues = z.infer<typeof registerSchema>;

export function RegisterForm() {
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { fullName: "", email: "", password: "", confirmPassword: "" },
  });

  function onSubmit(values: RegisterFormValues) {
    setServerError(null);
    startTransition(async () => {
      const result = await registerAction({
        fullName: values.fullName,
        email: values.email,
        password: values.password,
      });
      if (result?.error) {
        setServerError(result.error);
      } else if (result?.success) {
        setIsSuccess(true);
      }
    });
  }

  // ── Success state ─────────────────────────────────────────────────────────
  if (isSuccess) {
    return (
      <Card className="w-full max-w-md shadow-lg text-center">
        <CardContent className="pt-10 pb-8 space-y-4">
          <CheckCircle2 className="mx-auto h-16 w-16 text-green-500" />
          <h2 className="text-2xl font-semibold">ההרשמה הושלמה!</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            שלחנו אליך אימייל אימות.
            <br />
            אנא אשר את כתובת האימייל שלך כדי לסיים את ההרשמה.
          </p>
          <Button asChild variant="outline" className="mt-2">
            <Link href="/login">עבור להתחברות</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md shadow-lg">
      <CardHeader className="space-y-1 text-center">
        <CardTitle className="text-2xl">יצירת חשבון חדש</CardTitle>
        <CardDescription>הצטרף ל-EasyMarketing וצא לדרך</CardDescription>
      </CardHeader>

      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>

            {/* Server error */}
            {serverError && (
              <div className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
                {serverError}
              </div>
            )}

            {/* Full Name */}
            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>שם מלא</FormLabel>
                  <FormControl>
                    <Input placeholder="ישראל ישראלי" autoComplete="name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Email */}
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>כתובת אימייל</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="you@example.com"
                      autoComplete="email"
                      dir="ltr"
                      className="text-start"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Password */}
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>סיסמה</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="לפחות 6 תווים"
                      autoComplete="new-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Confirm Password */}
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>אימות סיסמה</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="הזן סיסמה שוב"
                      autoComplete="new-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="ms-2 h-4 w-4 animate-spin" />
                  יוצר חשבון...
                </>
              ) : (
                "הרשמה"
              )}
            </Button>
          </form>
        </Form>
      </CardContent>

      <CardFooter className="flex justify-center text-sm text-muted-foreground">
        <span>
          יש לך חשבון?&nbsp;
          <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            התחבר
          </Link>
        </span>
      </CardFooter>
    </Card>
  );
}
