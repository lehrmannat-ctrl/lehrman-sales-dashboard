"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-2xl border border-charcoal-700 bg-charcoal-900 p-8 shadow-xl">
        <h1 className="text-lg font-semibold text-white">Lehrman Mobile Detail</h1>
        <p className="mt-1 text-sm text-slate-400">Sign in to the sales command center.</p>

        <label className="mt-6 block text-sm text-slate-300">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-charcoal-600 bg-charcoal-800 px-3 py-2 text-sm text-white outline-none focus:border-brand-500"
          />
        </label>

        <label className="mt-4 block text-sm text-slate-300">
          Password
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-charcoal-600 bg-charcoal-800 px-3 py-2 text-sm text-white outline-none focus:border-brand-500"
          />
        </label>

        {error && <p className="mt-3 text-sm text-status-bad">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="mt-6 w-full rounded-lg bg-brand-600 py-2 text-sm font-medium text-white transition hover:bg-brand-500 disabled:opacity-60"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}
