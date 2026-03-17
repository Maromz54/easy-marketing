/**
 * Facebook Graph API v19.0 — helper functions for OAuth and token management.
 * All functions are server-side only (never expose APP_SECRET to the client).
 */

const FB_API_VERSION = "v19.0";
const FB_GRAPH_BASE = `https://graph.facebook.com/${FB_API_VERSION}`;
const FB_DIALOG_BASE = `https://www.facebook.com/${FB_API_VERSION}/dialog/oauth`;

/** Scopes required to manage and publish to Facebook Pages */
export const FB_REQUIRED_SCOPES = [
  "pages_manage_posts",
  "pages_read_engagement",
  "pages_show_list",
  "public_profile",
].join(",");

// ── Types ────────────────────────────────────────────────────────────────────

export interface FbPage {
  id: string;
  name: string;
  access_token: string;
  category: string;
}

export interface FbTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number; // seconds; absent for long-lived tokens in some cases
}

export interface FbErrorResponse {
  error: {
    message: string;
    type: string;
    code: number;
  };
}

// ── OAuth URL ────────────────────────────────────────────────────────────────

/**
 * Build the Facebook OAuth dialog URL.
 * @param redirectUri  The exact URI registered in the Facebook App dashboard.
 * @param state        A CSRF-prevention nonce (store it in a cookie before redirecting).
 */
export function buildFacebookAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.NEXT_PUBLIC_FACEBOOK_APP_ID!,
    redirect_uri: redirectUri,
    scope: FB_REQUIRED_SCOPES,
    response_type: "code",
    state,
  });
  return `${FB_DIALOG_BASE}?${params.toString()}`;
}

// ── Token Exchange ────────────────────────────────────────────────────────────

/**
 * Step 1: Exchange the OAuth `code` for a short-lived user access token.
 */
export async function exchangeCodeForToken(
  code: string,
  redirectUri: string
): Promise<FbTokenResponse> {
  const params = new URLSearchParams({
    client_id: process.env.NEXT_PUBLIC_FACEBOOK_APP_ID!,
    client_secret: process.env.FACEBOOK_APP_SECRET!,
    redirect_uri: redirectUri,
    code,
  });

  const res = await fetch(`${FB_GRAPH_BASE}/oauth/access_token?${params.toString()}`);
  const data = await res.json();

  if (!res.ok || data.error) {
    throw new Error(
      `שגיאת פייסבוק בהחלפת קוד: ${data.error?.message ?? "שגיאה לא ידועה"}`
    );
  }
  return data as FbTokenResponse;
}

/**
 * Step 2: Exchange a short-lived user token for a long-lived one (~60 days).
 */
export async function exchangeForLongLivedToken(
  shortLivedToken: string
): Promise<FbTokenResponse & { expires_in: number }> {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: process.env.NEXT_PUBLIC_FACEBOOK_APP_ID!,
    client_secret: process.env.FACEBOOK_APP_SECRET!,
    fb_exchange_token: shortLivedToken,
  });

  const res = await fetch(`${FB_GRAPH_BASE}/oauth/access_token?${params.toString()}`);
  const data = await res.json();

  if (!res.ok || data.error) {
    throw new Error(
      `שגיאה בהמרה לטוקן ארוך-טווח: ${data.error?.message ?? "שגיאה לא ידועה"}`
    );
  }
  // expires_in is in seconds; default to 60 days if missing
  return { ...data, expires_in: data.expires_in ?? 60 * 24 * 3600 };
}

/**
 * Step 3: Fetch all Facebook Pages managed by the authenticated user.
 * The returned page tokens are already long-lived when the parent user token is long-lived.
 */
export async function getUserPages(longLivedUserToken: string): Promise<FbPage[]> {
  const params = new URLSearchParams({
    fields: "id,name,access_token,category",
    access_token: longLivedUserToken,
  });

  const res = await fetch(`${FB_GRAPH_BASE}/me/accounts?${params.toString()}`);
  const data = await res.json();

  if (!res.ok || data.error) {
    throw new Error(
      `שגיאה בשליפת דפי פייסבוק: ${data.error?.message ?? "שגיאה לא ידועה"}`
    );
  }
  return (data.data ?? []) as FbPage[];
}

// ── Publishing ────────────────────────────────────────────────────────────────

export interface PublishPostPayload {
  message: string;
  link?: string;
  /** URL of an image to attach (use /photos endpoint if needed) */
  picture?: string;
}

/**
 * Publish a post immediately to a Facebook Page.
 * Returns the Facebook post ID on success.
 */
export async function publishToPage(
  pageId: string,
  pageAccessToken: string,
  payload: PublishPostPayload
): Promise<string> {
  const body = new URLSearchParams({
    message: payload.message,
    access_token: pageAccessToken,
  });
  if (payload.link) body.set("link", payload.link);
  if (payload.picture) body.set("picture", payload.picture);

  const res = await fetch(`${FB_GRAPH_BASE}/${pageId}/feed`, {
    method: "POST",
    body,
  });
  const data = await res.json();

  if (!res.ok || data.error) {
    throw new Error(
      `שגיאה בפרסום הפוסט: ${data.error?.message ?? "שגיאה לא ידועה"}`
    );
  }
  return data.id as string;
}
