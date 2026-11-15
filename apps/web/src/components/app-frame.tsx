"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export function AppFrame({
  sidebar,
  header,
  banner,
  children,
}: {
  sidebar: React.ReactNode;
  header: React.ReactNode;
  banner?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-screen max-w-full bg-canvas text-ink">
      {banner}
      <div className="md:grid md:min-h-screen md:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="hidden border-r border-line bg-white md:block">{sidebar}</aside>
        {open ? (
          <div className="fixed inset-0 z-40 md:hidden">
            <button
              type="button"
              aria-label="Close menu"
              className="absolute inset-0 bg-[#0b1220]/30"
              onClick={() => setOpen(false)}
            />
            <aside className="absolute inset-y-0 left-0 flex w-[min(18rem,calc(100%-2.5rem))] max-w-full flex-col overflow-y-auto border-r border-line bg-white shadow-lg">
              <div className="flex h-14 shrink-0 items-center justify-end border-b border-line px-2">
                <button
                  type="button"
                  aria-label="Close menu"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-line text-lg"
                  onClick={() => setOpen(false)}
                >
                  ×
                </button>
              </div>
              <div
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest("a")) setOpen(false);
                }}
              >
                {sidebar}
              </div>
            </aside>
          </div>
        ) : null}
        <div className="min-w-0 max-w-full">
          <header className="flex min-h-14 min-w-0 items-center gap-2 border-b border-line bg-white px-3 py-2">
            <button
              type="button"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-line bg-white md:hidden"
              aria-label="Open menu"
              aria-expanded={open}
              onClick={() => setOpen(true)}
            >
              <span className="flex flex-col gap-1" aria-hidden>
                <span className="block h-0.5 w-4 bg-ink" />
                <span className="block h-0.5 w-4 bg-ink" />
                <span className="block h-0.5 w-4 bg-ink" />
              </span>
            </button>
            <div className="min-w-0 flex-1">{header}</div>
          </header>
          <main className="pc-main min-w-0 px-4 py-5 sm:px-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
