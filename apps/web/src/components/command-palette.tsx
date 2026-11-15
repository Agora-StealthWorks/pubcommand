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
    <div className="fixed inset-0 z-50 bg-[#0b1220]/30 p-4" onClick={() => setOpen(false)}>
      <div
        className="mx-auto mt-24 max-w-lg overflow-hidden rounded-lg border border-line bg-white shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Jump to a page"
          className="h-12 w-full border-b border-line px-4 text-sm outline-none"
        />
        <ul className="max-h-80 overflow-auto py-2">
          {matches.map((item) => (
            <li key={item.href}>
              <button
                className="block w-full px-4 py-2 text-left text-sm hover:bg-canvas"
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
    <form action="/search" className="hidden md:block">
      <input
        name="q"
        placeholder="Search"
        aria-label="Search"
        className="h-9 w-56 rounded-md border border-line bg-white px-3 text-sm outline-none"
      />
    </form>
  );
}
