"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSignOut() {
    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    // Full navigation (not router.push) so every server component re-reads
    // the now-signed-out session instead of serving cached authed data.
    window.location.assign("/login");
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={loading}
      className="mt-3 w-full rounded-lg border border-charcoal-700 px-3 py-1.5 text-left text-xs text-slate-400 transition hover:border-charcoal-600 hover:text-white disabled:opacity-60"
    >
      {loading ? "Signing out..." : "Log out"}
    </button>
  );
}
