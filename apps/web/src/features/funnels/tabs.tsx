"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/funnels", label: "Launch funnels" },
  { href: "/funnels/text", label: "Text-letter sites" },
];

export function FunnelsTabs() {
  const pathname = usePathname() ?? "";
  // Pages are rewritten under /sites/org/<slug>; match on the tail.
  const tail = pathname.replace(/^\/sites\/org\/[^/]+/, "");
  const textActive = tail.startsWith("/funnels/text");
  return (
    <nav className="flex flex-wrap gap-1 rounded-lg border border-line bg-white p-1" aria-label="Funnels">
      {TABS.map((tab) => {
        const active = tab.href === "/funnels/text" ? textActive : !textActive;
        return (
          <Link key={tab.href} href={tab.href} className={`inline-flex min-h-9 items-center rounded-md px-3 text-sm font-semibold ${active ? "bg-accent text-white" : "text-ink hover:bg-canvas"}`}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Section tabs inside one funnel or site (plain links, server-rendered pages). */
export function SectionTabs({ items, active, label }: { items: { key: string; label: string; href: string }[]; active: string; label: string }) {
  return (
    <nav className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-1" aria-label={label}>
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.key === active ? "page" : undefined}
          className={`inline-flex min-h-10 shrink-0 items-center rounded-md border px-3 text-sm font-semibold ${item.key === active ? "border-accent bg-[#eef2ff] text-[#1e3a8a]" : "border-line bg-white text-ink hover:bg-canvas"}`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
