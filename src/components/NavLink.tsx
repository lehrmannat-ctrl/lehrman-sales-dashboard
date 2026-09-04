"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

export function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href || pathname?.startsWith(href + "/");

  return (
    <Link
      href={href}
      className={clsx(
        "block rounded-lg px-3 py-2 text-sm transition",
        active ? "bg-brand-600/15 text-brand-500 font-medium" : "text-slate-400 hover:bg-charcoal-800 hover:text-white"
      )}
    >
      {label}
    </Link>
  );
}
