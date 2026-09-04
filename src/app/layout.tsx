import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lehrman Mobile Detail — Sales Command Center",
  description: "Sales command center for Lehrman Mobile Detail LLC",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-charcoal-950 font-sans text-slate-100 antialiased">{children}</body>
    </html>
  );
}
