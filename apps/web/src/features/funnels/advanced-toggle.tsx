"use client";

import { useEffect, useState, type ReactNode } from "react";

const KEY = "pcf-builder-advanced";

/**
 * "Show advanced options": wraps the builder. Off, every field or section marked
 * `advanced` (data-advanced) is hidden; hidden inputs still submit, so saving never
 * loses a value. The choice is remembered per browser.
 */
export function AdvancedToggle({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    try {
      setOn(window.localStorage.getItem(KEY) === "1");
    } catch {
      /* storage blocked */
    }
  }, []);
  const flip = (next: boolean) => {
    setOn(next);
    try {
      window.localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      /* storage blocked */
    }
  };
  return (
    <div className={on ? "pcf-adv-on" : "pcf-adv-off"}>
      <style>{`.pcf-adv-off [data-advanced]{display:none !important}`}</style>
      <label className="mb-3 inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-semibold">
        <input type="checkbox" checked={on} onChange={(event) => flip(event.target.checked)} className="h-4 w-4 accent-accent" />
        Show advanced options
      </label>
      {children}
    </div>
  );
}
