"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export function CommandPalette({ items }: { items: { label: string; href: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => item.label.toLowerCase().includes(needle)).slice(0, 8);
  }, [items, query]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-[#0b1220]/30 p-3 sm:p-4" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-label="Jump to a page"
        className="mt-[8vh] flex max-h-[calc(100dvh-1.5rem)] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-line bg-white shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Jump to a page"
          aria-label="Jump to a page"
          className="h-11 w-full shrink-0 border-b border-line px-4 text-sm outline-none"
        />
        <ul className="min-h-0 flex-1 overflow-auto py-2">
          {matches.map((item) => (
            <li key={item.href}>
              <button
                className="flex min-h-11 w-full items-center px-4 text-left text-sm hover:bg-canvas"
                onClick={() => {
                  setOpen(false);
                  router.push(item.href);
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
          {matches.length === 0 ? <li className="px-4 py-3 text-sm text-muted">No matches</li> : null}
        </ul>
      </div>
    </div>
  );
}

export function SearchForm() {
  return (
    <form action="/search" className="min-w-0 sm:max-w-xs sm:flex-1">
      <input
        name="q"
        placeholder="Search"
        aria-label="Search"
        className="h-11 w-full min-w-0 rounded-md border border-line bg-white px-3 text-sm outline-none"
      />
    </form>
  );
}
