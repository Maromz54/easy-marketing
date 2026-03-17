/**
 * GET /api/facebook/callback
 *
 * Facebook redirects here after the user grants (or denies) permissions.
 *
 * Flow:
 * 1. Validate CSRF state.
 * 2. Check the user didn't deny permissions.
 * 3. Exchange the short-lived code → long-lived user token.
 * 4. Fetch all Pages managed by this user via /me/accounts.
 * 5. Upsert each page's token into the `facebook_tokens` table.
 * 6. Redirect to /dashboard with a success or error message.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  getUserPages,
} from "@/lib/facebook";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  const dashboardUrl = new URL("/dashboard", request.url);

  // ── User denied the permissions ───────────────────────────────────────────
  if (error) {
    console.error("[FB Callback] User denied or error:", error, errorDescription);
    dashboardUrl.searchParams.set("fb_error", "הגישה לפייסבוק נדחתה. אנא נסה שוב.");
    const res = NextResponse.redirect(dashboardUrl);
    res.cookies.delete("fb_oauth_state");
    return res;
  }

  // ── CSRF state validation ─────────────────────────────────────────────────
  const cookies = request.headers.get("cookie") ?? "";
  const storedState = cookies
    .split(";")
    .find((c) => c.trim().startsWith("fb_oauth_state="))
    ?.split("=")[1]
    ?.trim();

  if (!storedState || storedState !== state) {
    dashboardUrl.searchParams.set("fb_error", "שגיאת אבטחה. אנא נסה לחבר שוב.");
    const res = NextResponse.redirect(dashboardUrl);
    res.cookies.delete("fb_oauth_state");
    return res;
  }

  if (!code) {
    dashboardUrl.searchParams.set("fb_error", "לא התקבל קוד הרשאה מפייסבוק.");
    const res = NextResponse.redirect(dashboardUrl);
    res.cookies.delete("fb_oauth_state");
    return res;
  }

  // ── Require authenticated Supabase session ────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
    const redirectUri = `${appUrl}/api/facebook/callback`;

    // Step 1: Short-lived token
    const shortLivedToken = await exchangeCodeForToken(code, redirectUri);

    // Step 2: Long-lived user token (~60 days)
    const longLivedUserToken = await exchangeForLongLivedToken(
      shortLivedToken.access_token
    );

    // Step 3: Fetch pages — page tokens are already long-lived
    const pages = await getUserPages(longLivedUserToken.access_token);

    if (pages.length === 0) {
      dashboardUrl.searchParams.set(
        "fb_error",
        "לא נמצאו דפי פייסבוק. ודא שאתה מנהל של לפחות דף אחד."
      );
      const res = NextResponse.redirect(dashboardUrl);
      res.cookies.delete("fb_oauth_state");
      return res;
    }

    // Step 4: Upsert each page token
    const tokenExpiresAt = new Date(
      Date.now() + longLivedUserToken.expires_in * 1000
    ).toISOString();

    const upsertRows = pages.map((page) => ({
      user_id: user.id,
      page_id: page.id,
      page_name: page.name,
      access_token: page.access_token, // page-level long-lived token
      token_expires_at: tokenExpiresAt,
    }));

    const { error: dbError } = await supabase
      .from("facebook_tokens")
      .upsert(upsertRows, { onConflict: "user_id,page_id" });

    if (dbError) {
      console.error("[FB Callback] DB upsert error:", dbError);
      dashboardUrl.searchParams.set("fb_error", "שגיאה בשמירת נתוני הדף. אנא נסה שוב.");
      const res = NextResponse.redirect(dashboardUrl);
      res.cookies.delete("fb_oauth_state");
      return res;
    }

    // ── Success ───────────────────────────────────────────────────────────
    dashboardUrl.searchParams.set(
      "fb_success",
      `חוברו בהצלחה ${pages.length} דף/דפים מפייסבוק!`
    );
    const res = NextResponse.redirect(dashboardUrl);
    res.cookies.delete("fb_oauth_state");
    return res;
  } catch (err) {
    console.error("[FB Callback] Unexpected error:", err);
    dashboardUrl.searchParams.set(
      "fb_error",
      err instanceof Error ? err.message : "שגיאה לא צפויה בחיבור לפייסבוק."
    );
    const res = NextResponse.redirect(dashboardUrl);
    res.cookies.delete("fb_oauth_state");
    return res;
  }
}
