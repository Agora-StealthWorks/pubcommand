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
  digitColor = null,
  buttonBg = null,
  spacing = "narrow",
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
  digitColor?: string | null;
  buttonBg?: string | null;
  /** Desktop: narrow = grouped at the centre, wide = spread across the bar. */
  spacing?: "narrow" | "wide";
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
  const left = now === null ? null : Math.max(0, Math.floor((at - now) / 1000));
  const units: [string, number | null][] = [
    ["Days", left === null ? null : Math.floor(left / 86400)],
    ["Hours", left === null ? null : Math.floor((left % 86400) / 3600)],
    ["Mins", left === null ? null : Math.floor((left % 3600) / 60)],
    ["Secs", left === null ? null : left % 60],
  ];
  const shown = units[0]![1] ? units : units.slice(1);
  const fixedBottom = sticky && position === "bottom";
  const external = button?.href ? /^https?:/i.test(button.href) : false;
  return (
    <div
      role="timer"
      aria-live="off"
      className={`pcf-dbar z-50 w-full ${sticky && position === "top" ? "sticky top-0" : ""} ${fixedBottom ? "fixed inset-x-0 bottom-0 shadow-[0_-6px_20px_rgba(0,0,0,.25)]" : "relative"}`}
      style={{ background: bg, color }}
      data-deadline-bar={position}
      title={parts(at - (now ?? at))}
    >
      <div className={`pcf-wrap relative flex flex-col items-center gap-1.5 py-2 text-center sm:flex-row sm:py-2.5 ${spacing === "wide" ? "sm:justify-between" : "sm:justify-center sm:gap-9"} ${dismissible ? "pr-10" : ""}`}>
        <span className="px-4 text-[14.5px] font-semibold leading-tight [overflow-wrap:anywhere] sm:px-0 sm:text-left sm:text-[clamp(16px,2vw,21px)]">{text}</span>
        <span className="flex items-center gap-2 sm:gap-3">
          {shown.map(([label, value]) => (
            <span key={label} className="flex min-w-[2.2em] flex-col items-center leading-none">
              <b className="text-[22px] font-extrabold tabular-nums sm:text-[clamp(24px,3.4vw,38px)]" style={digitColor ? { color: digitColor } : undefined}>
                {value === null ? "--" : String(value).padStart(2, "0")}
              </b>
              <small className="mt-1 text-[8.5px] font-bold uppercase tracking-[0.12em] opacity-85 sm:text-[9.5px]">{label}</small>
            </span>
          ))}
        </span>
        {button?.href ? (
          <a
            href={button.href}
            data-track="deadline_bar"
            data-track-target={button.text}
            className="inline-block whitespace-nowrap rounded px-3 py-2 text-[12.5px] font-extrabold uppercase tracking-wide sm:px-4 sm:py-2.5 sm:text-sm"
            style={{ background: buttonBg ?? "var(--pcf-accent, #1d4ed8)", color: "var(--pcf-accent-text, #ffffff)" }}
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          >
            {button.text}
          </a>
        ) : null}
        {dismissible ? (
          <button
            type="button"
            aria-label="Close"
            className="absolute right-1 top-1 inline-flex h-9 w-9 items-center justify-center rounded-md text-lg leading-none opacity-70 hover:opacity-100"
            onClick={() => {
              rememberDismiss(sessionStore(), key);
              setDismissed(true);
            }}
          >
            ×
          </button>
        ) : null}
      </div>
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
