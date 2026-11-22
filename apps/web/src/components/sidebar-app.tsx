"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Item = { label: string; href: string };

const STORAGE_KEY = "pc-sidebar-open";

function readOpen(): Record<string, boolean> {
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    return value && typeof value === "object" ? (value as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeOpen(id: string, open: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readOpen(), [id]: open }));
  } catch {
    // Private windows can refuse storage; the menu still works for this page.
  }
}

/**
 * One app in the sidebar. An app with its own pages (e.g. Websites) opens and closes
 * when you click its name; its first sub-item is the app's overview. Each app remembers
 * whether you left it open. It starts open while you are inside the app.
 */
export function SidebarApp({
  id,
  name,
  icon,
  href,
  open,
  subnav,
  activeSub,
  linkClass,
}: {
  id: string;
  name: string;
  icon: string;
  href: string;
  open: boolean;
  subnav: Item[];
  activeSub: string | null;
  linkClass: string;
}) {
  const [expanded, setExpanded] = useState(open);
  useEffect(() => {
    const saved = readOpen()[id];
    if (typeof saved === "boolean") setExpanded(saved || open);
  }, [id, open]);

  if (!subnav.length) {
    return (
      <Link className={linkClass} href={href}>
        <span aria-hidden className="w-5 text-center">
          {icon}
        </span>
        <span className="truncate">{name}</span>
      </Link>
    );
  }

  const toggle = () => {
    setExpanded((value) => {
      writeOpen(id, !value);
      return !value;
    });
  };
  const items = [{ label: "Overview", href }, ...subnav.filter((item) => item.href !== href)];
  const overviewActive = open && (activeSub === null || activeSub === href);
  return (
    <div>
      <button type="button" onClick={toggle} aria-expanded={expanded} className={`${linkClass} w-full text-left`}>
        <span aria-hidden className="w-5 text-center">
          {icon}
        </span>
        <span className="truncate">{name}</span>
        <span aria-hidden className="ml-auto text-xs text-muted">
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded ? (
        <div className="mb-1 ml-5 mt-1 border-l-2 border-[#e0e7ff] pl-2" aria-label={`${name} pages`}>
          {items.map((item) => {
            const active = item.href === href ? overviewActive : activeSub === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex min-h-9 items-center rounded-md px-2.5 text-[13px] ${active ? "bg-[#f1f4fb] font-semibold text-[#1e3a8a]" : "text-muted hover:bg-canvas hover:text-ink"}`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
