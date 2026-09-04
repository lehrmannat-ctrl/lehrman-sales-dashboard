import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PAGES_BY_ROLE } from "@/lib/permissions";
import type { UserRole } from "@/types/database";
import { NavLink } from "@/components/NavLink";
import { SignOutButton } from "@/components/SignOutButton";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("full_name, role").eq("id", user.id).single();
  const role: UserRole = (profile?.role as UserRole) ?? "sales_associate";
  const pages = PAGES_BY_ROLE[role];

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r border-charcoal-800 bg-charcoal-900 md:flex md:flex-col">
        <div className="border-b border-charcoal-800 px-5 py-5">
          <p className="text-sm font-semibold text-white">Lehrman Mobile Detail</p>
          <p className="text-xs text-slate-500">Grand Rapids · Sales</p>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {pages.map((p) => (
            <NavLink key={p.href} href={p.href} label={p.label} />
          ))}
        </nav>
        <div className="border-t border-charcoal-800 px-5 py-4 text-xs text-slate-500">
          <p className="text-slate-300">{profile?.full_name ?? user.email}</p>
          <p className="capitalize">{role.replace("_", " ")}</p>
          <SignOutButton />
        </div>
      </aside>

      <main className="flex-1 overflow-x-hidden bg-charcoal-950 px-4 py-6 md:px-8">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
