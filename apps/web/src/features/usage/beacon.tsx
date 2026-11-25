"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const ENDPOINT = "/api/usage/beacon";
const TICK_MS = 15_000;
const BEAT_MS = 60_000;
/** Input in the last minute counts the tab as in use. */
const ACTIVE_WINDOW_MS = 60_000;

type Page = { path: string; viewSent: boolean; activeSeconds: number; bytes: number };

/**
 * App usage heartbeat for the signed-in shells (org workspace, platform console). Counts a
 * page view per page, the seconds the tab is visible with input in the last minute, and the
 * bytes the browser downloaded. A beat goes out every minute and when leaving a page or tab.
 * When the server says the session ended (idle timeout), the page reloads to the sign-in page.
 */
export function UsageBeacon() {
  const pathname = usePathname();
  const page = useRef<Page | null>(null);
  const lastInput = useRef(Date.now());
  const inputSinceBeat = useRef(true);

  useEffect(() => {
    const onInput = () => {
      lastInput.current = Date.now();
      inputSinceBeat.current = true;
    };
    const events = ["pointerdown", "keydown", "scroll", "touchstart", "wheel", "mousemove"] as const;
    for (const name of events) window.addEventListener(name, onInput, { passive: true, capture: true });

    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((list) => {
        if (!page.current) return;
        for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
          if (entry.name.includes(ENDPOINT)) continue;
          page.current.bytes += entry.transferSize || 0;
        }
      });
      observer.observe({ type: "resource", buffered: false });
      observer.observe({ type: "navigation", buffered: true });
    } catch {
      observer = null;
    }

    const tick = setInterval(() => {
      if (!page.current || document.visibilityState !== "visible") return;
      if (Date.now() - lastInput.current <= ACTIVE_WINDOW_MS) page.current.activeSeconds += TICK_MS / 1000;
    }, TICK_MS);
    const beat = setInterval(() => send(false), BEAT_MS);
    const onHide = () => {
      if (document.visibilityState === "hidden") send(true);
    };
    const onLeave = () => send(true);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onLeave);
    return () => {
      for (const name of events) window.removeEventListener(name, onInput, { capture: true });
      observer?.disconnect();
      clearInterval(tick);
      clearInterval(beat);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onLeave);
      send(true);
    };
  }, []);

  useEffect(() => {
    if (page.current && page.current.path !== pathname) send(false);
    page.current = { path: pathname, viewSent: false, activeSeconds: 0, bytes: 0 };
    lastInput.current = Date.now();
    inputSinceBeat.current = true;
  }, [pathname]);

  function send(leaving: boolean) {
    const current = page.current;
    if (!current) return;
    const payload = {
      path: current.path,
      view: !current.viewSent,
      activeSeconds: Math.round(current.activeSeconds),
      bytes: current.bytes,
      active: inputSinceBeat.current,
    };
    if (!payload.view && !payload.activeSeconds && !payload.bytes && !payload.active) return;
    current.viewSent = true;
    current.activeSeconds = 0;
    current.bytes = 0;
    inputSinceBeat.current = false;
    const body = JSON.stringify(payload);
    if (leaving && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "text/plain" }));
      return;
    }
    fetch(ENDPOINT, { method: "POST", body, keepalive: true, headers: { "content-type": "text/plain" }, credentials: "same-origin" })
      .then((response) => {
        if (response.status === 401) window.location.reload();
      })
      .catch(() => undefined);
  }

  return null;
}
