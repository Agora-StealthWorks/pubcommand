"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The builder's live preview: the real public page in an iframe, showing the
 * unsaved draft (`?preview=1&draft=1`). The editor saves the draft a moment
 * after each change and bumps `version`, which reloads the frame.
 */
export function LivePreview({ src, version, status, paths }: { src: string; version: number; status: "idle" | "saving" | "saved" | "error"; paths?: { label: string; path: string }[] }) {
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const [path, setPath] = useState(paths?.[0]?.path ?? "");
  const frame = useRef<HTMLIFrameElement>(null);
  const scroll = useRef(0);
  const url = `${src}${path}?preview=1&draft=1&v=${version}`;

  // Keep the scroll position across reloads so the block being edited stays in view.
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const onLoad = () => {
      try {
        element.contentWindow?.scrollTo(0, scroll.current);
        element.contentWindow?.addEventListener("scroll", () => {
          scroll.current = element.contentWindow?.scrollY ?? 0;
        });
      } catch {
        /* cross-origin (custom domain): ignore */
      }
    };
    element.addEventListener("load", onLoad);
    return () => element.removeEventListener("load", onLoad);
  }, []);

  const toggle = "inline-flex min-h-9 items-center rounded-md px-3 text-xs font-semibold";
  return (
    <div className="min-w-0 rounded-xl border border-line bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <p className="text-sm font-semibold">Live preview</p>
        <span className="text-xs text-muted" aria-live="polite">
          {status === "saving" ? "Updating…" : status === "error" ? "Preview not updated" : "Unsaved changes show here only"}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {paths && paths.length > 1 ? (
            <select aria-label="Preview page" className="pc-control min-h-9 text-xs" value={path} onChange={(event) => setPath(event.target.value)}>
              {paths.map((item) => (
                <option key={item.path} value={item.path}>
                  {item.label}
                </option>
              ))}
            </select>
          ) : null}
          <div className="flex rounded-md border border-line p-0.5">
            <button type="button" className={`${toggle} ${device === "desktop" ? "bg-accent text-white" : ""}`} onClick={() => setDevice("desktop")}>
              Desktop
            </button>
            <button type="button" className={`${toggle} ${device === "phone" ? "bg-accent text-white" : ""}`} onClick={() => setDevice("phone")}>
              Phone
            </button>
          </div>
          <a href={url} target="_blank" rel="noopener" className="inline-flex min-h-9 items-center px-2 text-xs font-semibold text-accent">
            Open ↗
          </a>
        </div>
      </div>
      <div className="overflow-hidden bg-canvas p-2">
        <iframe ref={frame} key={`${path}`} src={url} title="Live preview" className="mx-auto block h-[70vh] min-h-[420px] rounded-md border border-line bg-white" style={{ width: device === "phone" ? 375 : "100%", maxWidth: "100%" }} />
      </div>
    </div>
  );
}

/** Debounced draft saving: call `queue(payload)` on every change. */
export function useDraftSaver<T>(save: (payload: T) => Promise<{ ok: boolean }>, delay = 700) {
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef<T | null>(null);
  const queue = (payload: T) => {
    latest.current = payload;
    setStatus("saving");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const result = await save(latest.current as T).catch(() => ({ ok: false }));
      setStatus(result.ok ? "saved" : "error");
      if (result.ok) setVersion((value) => value + 1);
    }, delay);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  /** Drop a pending draft save (call before saving for real, so a late draft cannot reappear). */
  const cancel = () => {
    window.clearTimeout(timer.current);
    setStatus("idle");
  };
  return { version, status, queue, cancel };
}
