import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client (Server Components, Route Handlers, Server
 * Actions). Uses the anon key + the caller's session cookie, so every query
 * still goes through Postgres RLS (see supabase/migrations/0002_rls.sql) —
 * this file grants NO extra privilege by itself.
 */
export function createSupabaseServerClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Called from a Server Component with no request context to
            // mutate — the middleware refresh path handles this instead.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: "", ...options });
          } catch {
            // see note above
          }
        },
      },
    }
  );
}

/**
 * Privileged client for trusted server-only contexts: integration sync
 * jobs, webhook handlers, the alert-generation cron route. NEVER import
 * this from a Client Component and never let SUPABASE_SERVICE_ROLE_KEY
 * reach the browser bundle (it bypasses RLS entirely).
 */
export function createSupabaseServiceRoleClient() {
  const { createClient } = require("@supabase/supabase-js");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. This client must only be used server-side, " +
        "and only where a privileged write genuinely requires bypassing RLS " +
        "(e.g. an integration sync job writing records on behalf of the system)."
    );
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
