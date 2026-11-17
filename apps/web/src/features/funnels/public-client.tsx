"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type SyncBody = { kind: "view" | "watch" | "cta"; dayId?: string | null; percent?: number; key?: string };

function send(url: string, body: SyncBody) {
  try {
    // wd: the browser says it is automated (navigator.webdriver); the server flags it in stats.
    const wd = typeof navigator !== "undefined" && navigator.webdriver === true;
    return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, wd }), keepalive: true, credentials: "same-origin" });
  } catch {
    return null;
  }
}

/** Big countdown. At zero it reloads, so the entry router can send people in. */
export function Countdown({ target, labelColor, boxColor, digitColor, reloadAtZero = true }: { target: number; labelColor: string; boxColor: string; digitColor: string; reloadAtZero?: boolean }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const left = now === null ? null : Math.max(0, target - now);
  useEffect(() => {
    if (left === 0 && reloadAtZero) {
      const timer = window.setTimeout(() => window.location.reload(), 1500);
      return () => window.clearTimeout(timer);
    }
  }, [left, reloadAtZero]);
  const seconds = left === null ? null : Math.floor(left / 1000);
  const parts: [string, number | null][] = [
    ["Days", seconds === null ? null : Math.floor(seconds / 86400)],
    ["Hours", seconds === null ? null : Math.floor((seconds % 86400) / 3600)],
    ["Minutes", seconds === null ? null : Math.floor((seconds % 3600) / 60)],
    ["Seconds", seconds === null ? null : seconds % 60],
  ];
  return (
    <div className="grid grid-cols-4 gap-2 sm:gap-4" role="timer" aria-live="off">
      {parts.map(([label, value]) => (
        <div key={label} className="flex flex-col items-center">
          <span className="flex w-full items-center justify-center rounded-lg py-3 text-3xl font-bold tabular-nums shadow-sm sm:py-5 sm:text-6xl" style={{ background: boxColor, color: digitColor }}>
            {value === null ? "–" : String(value).padStart(2, "0")}
          </span>
          <span className="mt-1.5 text-[11px] font-semibold uppercase tracking-wider sm:text-xs" style={{ color: labelColor }}>
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Records the page view (and a presented ?k= key) and refreshes the signed viewer cookie. */
export function ViewerSync({ syncUrl, dayId, unlockKey, refreshOnUnlock }: { syncUrl: string | null; dayId: string | null; unlockKey?: string | null; refreshOnUnlock?: boolean }) {
  const sent = useRef(false);
  useEffect(() => {
    if (!syncUrl || sent.current) return;
    sent.current = true;
    const request = send(syncUrl, { kind: "view", dayId, ...(unlockKey ? { key: unlockKey } : {}) });
    if (request && refreshOnUnlock) {
      void request.then(async (response) => {
        const body = (await response.json().catch(() => null)) as { unlocked?: boolean } | null;
        if (body?.unlocked) {
          // Drop ?k= from the address bar once the browser remembers it.
          const url = new URL(window.location.href);
          url.searchParams.delete("k");
          window.history.replaceState(null, "", url.toString());
        }
      });
    }
  }, [syncUrl, dayId, unlockKey, refreshOnUnlock]);
  return null;
}

type WistiaVideo = { bind: (event: string, fn: (...args: number[]) => void) => void; percentWatched: () => number; time: () => number };
type YouTubePlayer = { getCurrentTime: () => number; getDuration: () => number; getPlayerState: () => number };
declare global {
  interface Window {
    _wq?: unknown[];
    YT?: { Player: new (id: string, options: Record<string, unknown>) => YouTubePlayer };
    onYouTubeIframeAPIReady?: () => void;
  }
}

function loadScript(src: string) {
  if (document.querySelector(`script[src="${src}"]`)) return;
  const script = document.createElement("script");
  script.src = src;
  script.async = true;
  document.head.appendChild(script);
}

/**
 * The day's video (Wistia or YouTube), reporting watched % for progression and
 * stats, and revealing a timed CTA once playback passes its mark.
 */
export function DayVideo({
  provider,
  videoId,
  dayId,
  syncUrl,
  ctaSeconds,
  cta,
}: {
  provider: "wistia" | "youtube";
  videoId: string;
  dayId: string;
  syncUrl: string | null;
  /** null = no timed CTA. */
  ctaSeconds: number | null;
  cta: ReactNode;
}) {
  const storageKey = `pcf-cta-${dayId}`;
  const [revealed, setRevealed] = useState(false);
  const reported = useRef(0);
  const elementId = `yt-${dayId}`;

  useEffect(() => {
    try {
      if (ctaSeconds !== null && window.localStorage.getItem(storageKey) === "1") setRevealed(true);
    } catch {
      /* storage blocked */
    }
  }, [ctaSeconds, storageKey]);

  useEffect(() => {
    let apiReady = false;
    const reveal = () => {
      setRevealed(true);
      try {
        window.localStorage.setItem(storageKey, "1");
      } catch {
        /* storage blocked */
      }
    };
    const progress = (fraction: number, position: number) => {
      apiReady = true;
      const percent = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
      if (syncUrl && percent >= reported.current + 5) {
        reported.current = percent - (percent % 5);
        send(syncUrl, { kind: "watch", dayId, percent });
      }
      if (ctaSeconds !== null && position >= ctaSeconds) reveal();
    };
    let poll: number | undefined;
    if (provider === "wistia") {
      loadScript("https://fast.wistia.com/assets/external/E-v1.js");
      window._wq = window._wq || [];
      window._wq.push({
        id: videoId,
        onReady: (video: WistiaVideo) => {
          apiReady = true;
          video.bind("timechange", (seconds: number) => progress(video.percentWatched(), seconds));
        },
      });
    } else {
      let watched = 0;
      const start = () => {
        if (!window.YT) return;
        const player = new window.YT.Player(elementId, {
          videoId,
          playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
          host: "https://www.youtube-nocookie.com",
          events: {
            onReady: () => {
              apiReady = true;
              poll = window.setInterval(() => {
                if (player.getPlayerState() !== 1) return;
                const duration = player.getDuration();
                watched += 1;
                if (duration > 0) progress(Math.min(watched, duration) / duration, player.getCurrentTime());
              }, 1000);
            },
          },
        });
      };
      if (window.YT?.Player) start();
      else {
        const previous = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
          previous?.();
          start();
        };
        loadScript("https://www.youtube.com/iframe_api");
      }
    }
    // If the player API never loads (blocked script), fall back to time on the page.
    const fallback = ctaSeconds !== null ? window.setTimeout(() => {
      if (!apiReady) window.setTimeout(reveal, ctaSeconds * 1000);
    }, 15000) : undefined;
    return () => {
      if (poll) window.clearInterval(poll);
      if (fallback) window.clearTimeout(fallback);
    };
  }, [provider, videoId, dayId, syncUrl, ctaSeconds, elementId, storageKey]);

  return (
    <div>
      <div className="relative w-full overflow-hidden rounded-lg bg-black shadow-lg" style={{ aspectRatio: "16 / 9" }}>
        {provider === "wistia" ? (
          <div className={`wistia_responsive_padding`} style={{ position: "absolute", inset: 0 }}>
            <div className={`wistia_embed wistia_async_${videoId} videoFoam=false`} style={{ height: "100%", width: "100%" }} />
          </div>
        ) : (
          <div id={elementId} className="absolute inset-0 h-full w-full" />
        )}
      </div>
      {ctaSeconds !== null && revealed ? <div className="mt-5">{cta}</div> : null}
    </div>
  );
}

/** A tracked call-to-action link. */
export function TrackedLink({ href, syncUrl, dayId, className, style, children }: { href: string; syncUrl: string | null; dayId: string | null; className?: string; style?: React.CSSProperties; children: ReactNode }) {
  return (
    <a
      href={href}
      className={className}
      style={style}
      rel="noopener"
      onClick={() => {
        if (syncUrl) send(syncUrl, { kind: "cta", dayId });
      }}
    >
      {children}
    </a>
  );
}

/** "We're live": sends the visitor to the room after a short pause. */
export function LiveRedirect({ url, seconds = 4 }: { url: string; seconds?: number }) {
  useEffect(() => {
    const timer = window.setTimeout(() => window.location.assign(url), seconds * 1000);
    return () => window.clearTimeout(timer);
  }, [url, seconds]);
  return null;
}

/** An embedded Form (/embed/<slug>) that sizes itself from the form's height messages. */
export function FormEmbed({ src, title }: { src: string; title: string }) {
  const [height, setHeight] = useState(520);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as { type?: string; height?: number } | null;
      if (data?.type === "pubcommand-form:height" && typeof data.height === "number") setHeight(Math.max(200, Math.min(4000, Math.ceil(data.height))));
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);
  return <iframe ref={frame} src={src} title={title} className="w-full rounded-lg border-0 bg-transparent" style={{ height }} loading="lazy" />;
}
