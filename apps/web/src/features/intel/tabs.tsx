"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** ISpy tabs. "My captures" is the org's own private Intel (uploads, Gmail, competitors, registry). */
const TABS: { href: string; label: string; match: (tail: string) => boolean }[] = [
  { href: "/intel", label: "Feed", match: (t) => t === "/intel" || t.startsWith("/intel/mail") || t.startsWith("/intel/copies") },
  { href: "/intel/promos", label: "Promo Radar", match: (t) => t.startsWith("/intel/promos") },
  { href: "/intel/trends", label: "Trends", match: (t) => t.startsWith("/intel/trends") },
  { href: "/intel/publishers", label: "Publishers", match: (t) => t.startsWith("/intel/publishers") },
  { href: "/intel/videos", label: "Videos", match: (t) => t.startsWith("/intel/videos") },
  {
    href: "/intel/captures",
    label: "My captures",
    match: (t) => ["/intel/captures", "/intel/emails", "/intel/radar", "/intel/competitors", "/intel/experts", "/intel/lists", "/intel/topics", "/intel/registry", "/intel/add", "/intel/gmail"].some((p) => t.startsWith(p)),
  },
  { href: "/intel/settings", label: "Settings", match: (t) => t.startsWith("/intel/settings") },
];

/** Sub-tabs inside My captures (the old Intel). */
const CAPTURE_TABS: { href: string; label: string; also?: string[] }[] = [
  { href: "/intel/captures", label: "Inbox", also: ["/intel/emails"] },
  { href: "/intel/radar", label: "Radar" },
  { href: "/intel/competitors", label: "Competitors" },
  { href: "/intel/experts", label: "Registry", also: ["/intel/lists", "/intel/topics", "/intel/registry"] },
  { href: "/intel/add", label: "Add emails" },
  { href: "/intel/gmail", label: "Gmail" },
];

function useTail(): string {
  const pathname = usePathname() ?? "";
  // Pages are rewritten under /sites/org/<slug>; match on the tail.
  return pathname.replace(/^\/sites\/org\/[^/]+/, "");
}

export function IntelTabs() {
  const tail = useTail();
  return (
    <nav className="flex max-w-full flex-wrap gap-1 rounded-lg border border-line bg-white p-1" aria-label="ISpy">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={`inline-flex min-h-9 items-center rounded-md px-3 text-sm font-semibold ${tab.match(tail) ? "bg-accent text-white" : "text-ink hover:bg-canvas"}`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

export function CaptureTabs() {
  const tail = useTail();
  if (!TABS[5]!.match(tail)) return null;
  return (
    <nav className="mb-4 flex max-w-full flex-wrap gap-1 border-b border-line" aria-label="My captures">
      {CAPTURE_TABS.map((tab) => {
        const active = tab.href === "/intel/captures" ? tail.startsWith("/intel/captures") || tail.startsWith("/intel/emails") : tail.startsWith(tab.href) || Boolean(tab.also?.some((p) => tail.startsWith(p)));
        return (
          <Link key={tab.href} href={tab.href} className={`-mb-px inline-flex min-h-10 items-center border-b-2 px-3 text-sm font-semibold ${active ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
