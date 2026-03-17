/**
 * Supabase SERVICE ROLE client.
 *
 * ⚠️  NEVER expose this client or SUPABASE_SERVICE_ROLE_KEY to the browser.
 *      Use ONLY in:
 *        - API Route Handlers (e.g. /api/cron/*)
 *        - Server Actions that need to bypass RLS (e.g. system cron tasks)
 *
 * This client bypasses Row Level Security entirely.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

export function createServiceClient() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        // Prevent the service client from trying to persist sessions
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
