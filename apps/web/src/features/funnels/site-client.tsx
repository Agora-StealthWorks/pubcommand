"use client";

import { useEffect, useRef, useState } from "react";
import { dismissKey, isDismissed, rememberDismiss } from "../../../../../modules/funnels/deadline";

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function parts(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(seconds / 86400);
  const pad = (value: number) => String(value).padStart(2, "0");
  const clock = `${pad(Math.floor((seconds % 86400) / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
  return days > 0 ? `${days}d ${clock}` : clock;
}

/**
 * The deadline ribbon. The server decides the deadline and the reveal time (the
 * pure `deadlineBar`); the browser only counts down, appears at the reveal time
 * and disappears at zero. `nowOffset` keeps admin "preview as of" honest.
 */
export function DeadlineBarClient({
  at,
  revealAt,
  text,
  bg,
  color,
  position,
  sticky,
  nowOffset = 0,
  funnelId = "",
  dismissible = false,
  button = null,
}: {
  at: number;
  revealAt: number | null;
  text: string;
  bg: string;
  color: string;
  position: "top" | "bottom";
  sticky: boolean;
  nowOffset?: number;
  funnelId?: string;
  /** Show a × that hides the bar for the rest of the browser session (per deadline). */
  dismissible?: boolean;
  button?: { text: string; href: string | null } | null;
}) {
  const clock = useNow();
  const key = dismissKey(funnelId, at);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (dismissible && isDismissed(sessionStore(), key)) setDismissed(true);
  }, [dismissible, key]);
  const now = clock === null ? null : clock + nowOffset;
  const visible = now === null ? revealAt === null : now < at && (revealAt === null || now >= revealAt);
  if (!visible || dismissed) return null;
  return (
    <div
      role="timer"
      aria-live="off"
      className={`z-40 flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-center text-sm font-semibold ${sticky ? "sticky" : ""} ${dismissible ? "pr-11" : ""} relative`}
      style={{ background: bg, color, ...(sticky ? (position === "top" ? { top: 0 } : { bottom: 0 }) : {}) }}
      data-deadline-bar={position}
    >
      <span className="[overflow-wrap:anywhere]">
        {text} <span className="ml-1 inline-block rounded-md bg-black/20 px-2 py-0.5 font-mono tabular-nums">{now === null ? "--:--:--" : parts(at - now)}</span>
      </span>
      {button?.href ? (
        <a href={button.href} className="inline-flex min-h-9 items-center rounded-md px-3 text-sm font-bold shadow-sm" style={{ background: color, color: bg }} {...(/^https?:/i.test(button.href) ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
          {button.text}
        </a>
      ) : null}
      {dismissible ? (
        <button
          type="button"
          aria-label="Close"
          className="absolute right-1.5 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-lg leading-none hover:bg-black/15"
          onClick={() => {
            rememberDismiss(sessionStore(), key);
            setDismissed(true);
          }}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

/**
 * Admin-written HTML (custom pages, the Custom HTML block) in a sandboxed
 * iframe: scripts and forms run, but with an opaque origin they cannot touch
 * the funnel page, its cookies or the viewer. It reports its height so it
 * sizes itself, unless a fixed height is set.
 */
export function HtmlFrame({ html, title, height = 0, textColor = "#1f2937", linkColor = "#1d4ed8", font = "system-ui, sans-serif" }: { html: string; title: string; height?: number; textColor?: string; linkColor?: string; font?: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [auto, setAuto] = useState(240);
  useEffect(() => {
    if (height > 0) return;
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as { type?: string; h?: number } | null;
      if (data?.type === "pcf-frame-height" && typeof data.h === "number") setAuto(Math.max(40, Math.min(8000, Math.ceil(data.h))));
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [height]);
  const safe = (value: string) => (/^#[0-9a-f]{6}$/i.test(value) ? value : "#1f2937");
  const fontStack = font.replace(/[<>{};]/g, "");
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"><style>html,body{margin:0;padding:0}body{font-family:${fontStack};color:${safe(textColor)};line-height:1.5;overflow-wrap:anywhere}a{color:${safe(linkColor)}}img,iframe,video{max-width:100%;height:auto}</style></head><body>${html}<script>(function(){function s(){parent.postMessage({type:"pcf-frame-height",h:document.documentElement.scrollHeight},"*")}if(window.ResizeObserver){new ResizeObserver(s).observe(document.documentElement)}window.addEventListener("load",s);setTimeout(s,50);setTimeout(s,1000)})()</script></body></html>`;
  return (
    <iframe
      ref={frame}
      title={title}
      srcDoc={doc}
      sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      className="block w-full border-0 bg-transparent"
      style={{ height: height > 0 ? height : auto }}
      loading="lazy"
    />
  );
}
