"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { loginAction } from "@/actions/auth";
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
const loginSchema = z.object({
  email: z
    .string()
    .min(1, { message: "שדה האימייל הוא חובה." })
    .email({ message: "אנא הזן כתובת אימייל תקינה." }),
  password: z
    .string()
    .min(6, { message: "הסיסמה חייבת להכיל לפחות 6 תווים." }),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginForm() {
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  function onSubmit(values: LoginFormValues) {
    setServerError(null);
    startTransition(async () => {
      const result = await loginAction(values);
      // loginAction redirects on success, so result only exists on error
      if (result?.error) {
        setServerError(result.error);
      }
    });
  }

  return (
    <Card className="w-full max-w-md shadow-lg">
      <CardHeader className="space-y-1 text-center">
        <CardTitle className="text-2xl">התחברות</CardTitle>
        <CardDescription>הזן את פרטי החשבון שלך כדי להמשיך</CardDescription>
      </CardHeader>

      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>

            {/* Server-level error banner */}
            {serverError && (
              <div className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
                {serverError}
              </div>
            )}

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
                      placeholder="הזן סיסמה"
                      autoComplete="current-password"
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
                  מתחבר...
                </>
              ) : (
                "התחבר"
              )}
            </Button>
          </form>
        </Form>
      </CardContent>

      <CardFooter className="flex justify-center text-sm text-muted-foreground">
        <span>
          אין לך חשבון עדיין?&nbsp;
          <Link href="/register" className="font-medium text-primary underline-offset-4 hover:underline">
            הרשמה
          </Link>
        </span>
      </CardFooter>
    </Card>
  );
}
