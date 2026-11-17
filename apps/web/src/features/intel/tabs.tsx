"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/intel", label: "Inbox" },
  { href: "/intel/radar", label: "Promo Radar" },
  { href: "/intel/competitors", label: "Competitors" },
  { href: "/intel/add", label: "Add emails" },
  { href: "/intel/gmail", label: "Gmail" },
];

export function IntelTabs() {
  const pathname = usePathname() ?? "";
  // Pages are rewritten under /sites/org/<slug>; match on the tail.
  const tail = pathname.replace(/^\/sites\/org\/[^/]+/, "");
  return (
    <nav className="flex max-w-full flex-wrap gap-1 rounded-lg border border-line bg-white p-1" aria-label="Intel">
      {TABS.map((tab) => {
        const active = tab.href === "/intel" ? tail === "/intel" || tail.startsWith("/intel/emails") : tail.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`inline-flex min-h-9 items-center rounded-md px-3 text-sm font-semibold ${active ? "bg-accent text-white" : "text-ink hover:bg-canvas"}`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
