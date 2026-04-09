/**
 * GET /r/[slug]
 *
 * Fast redirect engine with fire-and-forget click analytics.
 *
 * Performance notes:
 * - This route is excluded from auth middleware (see src/middleware.ts matcher).
 * - Uses the service client (no session overhead) for a faster DB lookup.
 * - The click log is a non-blocking Promise — the 302 response is returned
 *   BEFORE the DB write completes, so the user's browser is never held up.
 *   On Vercel, the serverless function stays alive until all promises settle,
 *   so the write will succeed in the vast majority of cases.
 *
 * Privacy / GDPR:
 * - IP addresses are never stored; only a SHA-256 hash is saved.
 */
import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET(
  request: Request,
  { params }: { params: { slug: string } }
) {
  const { slug } = params;
  const supabase = createServiceClient();

  // ── Look up the link ────────────────────────────────────────────────────
  const { data: link } = await supabase
    .from("links")
    .select("id, destination")
    .eq("slug", slug)
    .maybeSingle();

  if (!link) {
    // Unknown slug → redirect to homepage
    return NextResponse.redirect(new URL("/", request.url), { status: 302 });
  }

  // ── Fire-and-forget analytics ───────────────────────────────────────────
  // We intentionally do NOT await this Promise.
  // The response is sent immediately; Vercel keeps the function alive
  // until the write completes (within the function timeout).
  recordClick(supabase, link.id, request);

  // ── 302 redirect to destination ─────────────────────────────────────────
  return NextResponse.redirect(link.destination, { status: 302 });
}

// ── Bot/crawler user-agent patterns ────────────────────────────────────────
// These generate link previews and should NOT count as real clicks.
const BOT_UA_PATTERN =
  /bot|crawl|spider|preview|fetch|scan|check|monitor|facebookexternalhit|WhatsApp|TelegramBot|Twitterbot|LinkedInBot|Slackbot|Discordbot|pinterest|Google-Read-Aloud|DuckDuckBot|baiduspider|YandexBot|SemrushBot|AhrefsBot|MJ12bot|ia_archiver|curl|python-requests|okhttp|axios|Go-http/i;

function isBot(ua: string | null): boolean {
  if (!ua) return true; // no user-agent → treat as bot
  return BOT_UA_PATTERN.test(ua);
}

// ── Helper: record one click event ─────────────────────────────────────────
async function recordClick(
  supabase: ReturnType<typeof createServiceClient>,
  linkId: string,
  request: Request
): Promise<void> {
  try {
    const ua = request.headers.get("user-agent") ?? null;

    // Skip bots and link-preview crawlers — they inflate counts
    if (isBot(ua)) return;

    // Prefer x-forwarded-for (set by proxies/CDN) then fall back to cf-connecting-ip
    const rawIp =
      request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
      request.headers.get("cf-connecting-ip") ??
      "unknown";

    // SHA-256 hash — never store the raw IP
    const ipHash = createHash("sha256").update(rawIp).digest("hex");

    // Country code from Vercel's edge geo header (available on Vercel deployments)
    const country = request.headers.get("x-vercel-ip-country") ?? null;

    await supabase.from("link_clicks").insert({
      link_id: linkId,
      ip_hash: ipHash,
      user_agent: ua,
      country,
    });
  } catch (err) {
    // Never let analytics errors affect users
    console.error("[r/slug] Click log failed:", err);
  }
}
