"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/charts", label: "Editor" },
  { href: "/charts/projects", label: "Projects" },
  { href: "/charts/bulk", label: "Bulk" },
  { href: "/charts/templates", label: "Templates" },
  { href: "/charts/api", label: "API" },
];

export function ChartsTabs() {
  const pathname = usePathname() ?? "";
  // Pages are rewritten under /sites/org/<slug>; match on the tail.
  const tail = pathname.replace(/^\/sites\/org\/[^/]+/, "");
  return (
    <nav className="flex flex-wrap gap-1 rounded-lg border border-line bg-white p-1" aria-label="ChartBuilder">
      {TABS.map((tab) => {
        const active = tab.href === "/charts" ? tail === "/charts" || tail === "" : tail.startsWith(tab.href);
        return (
          <Link key={tab.href} href={tab.href} className={`inline-flex min-h-9 items-center rounded-md px-3 text-sm font-semibold ${active ? "bg-accent text-white" : "text-ink hover:bg-canvas"}`}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
