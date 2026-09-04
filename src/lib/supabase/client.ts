import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client. Only ever constructed with the public
 * anon key — RLS is what keeps a sales_associate from reading another
 * salesperson's data, not this client.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
