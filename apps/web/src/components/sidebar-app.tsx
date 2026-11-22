"use client";

import Link from "next/link";
import { useState } from "react";

type Item = { label: string; href: string };

/**
 * One app in the sidebar. Apps with their own pages (e.g. Websites) get a separate
 * expand button, so the sub-menu opens without leaving the current page. It starts
 * open while you are inside the app.
 */
export function SidebarApp({
  name,
  icon,
  href,
  open,
  subnav,
  activeSub,
  linkClass,
}: {
  name: string;
  icon: string;
  href: string;
  open: boolean;
  subnav: Item[];
  activeSub: string | null;
  linkClass: string;
}) {
  const [expanded, setExpanded] = useState(open);
  const show = subnav.length > 0 && expanded;
  return (
    <div>
      <div className="flex items-center">
        <Link className={`${linkClass} min-w-0 flex-1`} href={href}>
          <span aria-hidden className="w-5 text-center">
            {icon}
          </span>
          <span className="truncate">{name}</span>
        </Link>
        {subnav.length ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={show}
            aria-label={`${show ? "Hide" : "Show"} ${name} pages`}
            className="ml-1 inline-flex min-h-10 w-9 shrink-0 items-center justify-center rounded-md text-xs text-muted hover:bg-canvas hover:text-ink"
          >
            {show ? "▾" : "▸"}
          </button>
        ) : null}
      </div>
      {show ? (
        <div className="mb-1 ml-5 mt-1 border-l-2 border-[#e0e7ff] pl-2" aria-label={`${name} pages`}>
          {subnav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-h-9 items-center rounded-md px-2.5 text-[13px] ${
                activeSub === item.href ? "bg-[#f1f4fb] font-semibold text-[#1e3a8a]" : "text-muted hover:bg-canvas hover:text-ink"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
