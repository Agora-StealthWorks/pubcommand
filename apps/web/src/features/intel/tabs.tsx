"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: { href: string; label: string; also?: string[] }[] = [
  { href: "/ispy", label: "Inbox" },
  { href: "/ispy/radar", label: "Promo Radar" },
  { href: "/ispy/videos", label: "Videos" },
  { href: "/ispy/competitors", label: "Competitors" },
  { href: "/ispy/experts", label: "Registry", also: ["/ispy/lists", "/ispy/topics", "/ispy/registry"] },
  { href: "/ispy/add", label: "Add emails" },
  { href: "/ispy/gmail", label: "Gmail" },
  { href: "/ispy/settings", label: "Settings" },
];

export function IntelTabs() {
  const pathname = usePathname() ?? "";
  // Pages are rewritten under /sites/org/<slug>; match on the tail.
  const tail = pathname.replace(/^\/sites\/org\/[^/]+/, "");
  return (
    <nav className="flex max-w-full flex-wrap gap-1 rounded-lg border border-line bg-white p-1" aria-label="iSpy">
      {TABS.map((tab) => {
        const active =
          tab.href === "/ispy" ? tail === "/ispy" || tail.startsWith("/ispy/emails") : tail.startsWith(tab.href) || Boolean(tab.also?.some((prefix) => tail.startsWith(prefix)));
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
