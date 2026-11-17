"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/performance", label: "Portfolios" },
  { href: "/performance/archive", label: "Call archive" },
  { href: "/performance/import", label: "Import" },
];

export function TrackTabs({ canWrite }: { canWrite: boolean }) {
  const pathname = usePathname() ?? "";
  const tail = pathname.replace(/^\/sites\/org\/[^/]+/, "");
  const tabs = canWrite ? TABS : TABS.filter((tab) => tab.href !== "/performance/import");
  return (
    <nav className="flex flex-wrap gap-1 rounded-lg border border-line bg-white p-1" aria-label="Track Record">
      {tabs.map((tab) => {
        const active =
          tab.href === "/performance"
            ? !tail.startsWith("/performance/archive") && !tail.startsWith("/performance/import")
            : tail.startsWith(tab.href);
        return (
          <Link key={tab.href} href={tab.href} className={`inline-flex min-h-9 items-center rounded-md px-3 text-sm font-semibold ${active ? "bg-accent text-white" : "text-ink hover:bg-canvas"}`}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
