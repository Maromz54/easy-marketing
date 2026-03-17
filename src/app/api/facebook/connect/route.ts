/**
 * GET /api/facebook/connect
 *
 * Initiates the Facebook OAuth flow.
 * 1. Generates a random CSRF state token.
 * 2. Stores it in a short-lived HttpOnly cookie.
 * 3. Redirects the browser to the Facebook OAuth dialog.
 *
 * The user must be authenticated (Supabase session) to reach this route.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildFacebookAuthUrl } from "@/lib/facebook";
import { randomBytes } from "crypto";

export async function GET(request: Request) {
  // Require an authenticated session
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Generate a CSRF state nonce
  const state = randomBytes(16).toString("hex");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  const redirectUri = `${appUrl}/api/facebook/callback`;

  const facebookAuthUrl = buildFacebookAuthUrl(redirectUri, state);

  // Store state in a short-lived (10 min) HttpOnly cookie
  const response = NextResponse.redirect(facebookAuthUrl);
  response.cookies.set("fb_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });

  return response;
}
