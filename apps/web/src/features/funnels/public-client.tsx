"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Event kinds a public page may record (the sync route accepts only these). */
type SyncBody = { kind: string; dayId?: string | null; percent?: number; key?: string; page?: string; target?: string | null };

function send(url: string, body: SyncBody) {
  try {
    // wd: the browser says it is automated (navigator.webdriver); the server flags it in stats.
    const wd = typeof navigator !== "undefined" && navigator.webdriver === true;
    return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, wd }), keepalive: true, credentials: "same-origin" });
  } catch {
    return null;
  }
}

/**
 * Reload to a URL, but never the same URL twice within 15 seconds. Every
 * auto-refresh (countdowns, unlock refresh) goes through this, so a page whose
 * server still says "locked" can never reload itself in a loop.
 */
export function guardedReload(url: string): void {
  const key = `pcf-reload:${url}`;
  let recent = false;
  try {
    recent = Date.now() - Number(window.sessionStorage.getItem(key) || 0) < 15_000;
    window.sessionStorage.setItem(key, String(Date.now()));
  } catch {
    /* storage blocked */
  }
  if (!recent) window.location.assign(url);
}

/** Milliseconds to add to the viewer's clock to get the server's (from the render time). */
function useSkew(serverNow: number): number {
  const [skew] = useState(() => serverNow - Date.now());
  return skew;
}

/**
 * Countdown. Uses the server's clock (corrected for the viewer's), and reloads
 * `reloadTo` only when it actually RUNS OUT while the page is open. A countdown
 * already at zero when the page loads never reloads.
 */
export function Countdown({
  target,
  serverNow,
  reloadTo,
  variant = "big",
  labelColor,
  boxColor,
  digitColor,
}: {
  target: number;
  serverNow: number;
  /** null = never reload (time-travel previews: time is frozen there). */
  reloadTo: string | null;
  /** "box": inside a module's video box, smaller, days hidden at zero. */
  variant?: "big" | "box";
  labelColor: string;
  boxColor: string;
  digitColor: string;
}) {
  const skew = useSkew(serverNow);
  const [left, setLeft] = useState(Math.max(0, target - serverNow));
  useEffect(() => {
    if (target - serverNow <= 0) return;
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, target - (Date.now() + skew));
      setLeft(remaining);
      if (remaining <= 0) {
        window.clearInterval(timer);
        // A short grace so the server's clock is past the target too.
        if (reloadTo) window.setTimeout(() => guardedReload(reloadTo), 1500);
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [target, serverNow, skew, reloadTo]);
  const seconds = Math.floor(left / 1000);
  const days = Math.floor(seconds / 86400);
  const parts: [string, number][] = [
    ...(variant === "box" && days === 0 ? [] : ([["Days", days]] as [string, number][])),
    ["Hours", Math.floor((seconds % 86400) / 3600)],
    ["Minutes", Math.floor((seconds % 3600) / 60)],
    ["Seconds", seconds % 60],
  ];
  return (
    <div>
      <div className={`pcf-countdown${variant === "box" ? " is-box" : ""}`} role="timer" aria-live="off">
        {parts.map(([label, value]) => (
          <div key={label} className="pcf-cd-box" style={{ background: boxColor, color: digitColor }}>
            <span className="pcf-cd-num">{String(value).padStart(2, "0")}</span>
            <span className="pcf-cd-label" style={labelColor === "currentColor" ? undefined : { color: digitColor }}>
              {label}
            </span>
          </div>
        ))}
      </div>
      {left <= 0 ? <p className="mt-3 text-lg font-bold">Starting now…</p> : null}
    </div>
  );
}

/** Invisible: reloads a locked page the moment it unlocks or goes live (within the next 24 hours). */
export function UnlockRefresh({ at, serverNow, reloadTo }: { at: number; serverNow: number; reloadTo: string }) {
  useEffect(() => {
    const wait = at - serverNow;
    if (!(wait > 0 && wait < 86_400_000)) return;
    const timer = window.setTimeout(() => guardedReload(reloadTo), wait + 1500);
    return () => window.clearTimeout(timer);
  }, [at, serverNow, reloadTo]);
  return null;
}

/** Before `revealAt` shows its children (Add to calendar); from then on a "join early" button, live on an open page. */
export function EarlyJoin({ revealAt, serverNow, url, text, children }: { revealAt: number; serverNow: number; url: string; text: string; children?: ReactNode }) {
  const skew = useSkew(serverNow);
  const [shown, setShown] = useState(serverNow >= revealAt);
  useEffect(() => {
    if (shown) return;
    const timer = window.setInterval(() => {
      if (Date.now() + skew >= revealAt) {
        setShown(true);
        window.clearInterval(timer);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [shown, revealAt, skew]);
  if (!shown) return <>{children}</>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" data-track="early_join" data-track-target={url} className="pcf-btn inline-flex items-center gap-2 text-base" style={{ background: "#d92d20", color: "#ffffff", borderColor: "#d92d20" }}>
      <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-white" aria-hidden="true" /> {text}
    </a>
  );
}

/** "We're live": a short countdown on the button, then the visitor is sent to the room (previews too). */
export function LiveRedirect({ url, headline, sub, syncUrl, dayId }: { url: string | null; headline: string; sub: string; syncUrl: string | null; dayId: string }) {
  const [left, setLeft] = useState(3);
  useEffect(() => {
    if (!url) return;
    const tick = window.setInterval(() => setLeft((value) => Math.max(0, value - 1)), 1000);
    const go = window.setTimeout(() => {
      if (syncUrl) send(syncUrl, { kind: "live_redirect", dayId, page: "day", target: url });
      window.location.assign(url);
    }, 3000);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(go);
    };
  }, [url, syncUrl, dayId]);
  return (
    <div className="pcf-live">
      <div className="pcf-live-dot" aria-hidden="true" />
      <h2 className="pcf-live-h [overflow-wrap:anywhere]">{headline}</h2>
      {sub ? <p className="pcf-live-sub [overflow-wrap:anywhere]">{sub}</p> : null}
      {url ? (
        <a href={url} data-track="live_join" data-track-target={url} className="pcf-btn text-base">
          Join the livestream now{left > 0 ? ` (${left})` : ""}
        </a>
      ) : (
        <p className="pcf-live-sub">The livestream room link isn&apos;t posted yet. Refresh in a moment.</p>
      )}
    </div>
  );
}

/** Text modules: with "unlock by watching" they count as read after 5 seconds open, then the page refreshes. */
export function TextProgress({ syncUrl, dayId }: { syncUrl: string; dayId: string }) {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const request = send(syncUrl, { kind: "watch", dayId, percent: 100 });
      void request?.then(() => router.refresh()).catch(() => undefined);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [syncUrl, dayId, router]);
  return null;
}

/** Records the page view (and a presented ?k= key) and refreshes the signed viewer cookie. */
export function ViewerSync({ syncUrl, dayId, unlockKey, refreshOnUnlock, page = "day" }: { syncUrl: string | null; dayId: string | null; unlockKey?: string | null; refreshOnUnlock?: boolean; page?: string }) {
  const sent = useRef(false);
  useEffect(() => {
    if (!syncUrl || sent.current) return;
    sent.current = true;
    const request = send(syncUrl, { kind: "view", dayId, page, ...(unlockKey ? { key: unlockKey } : {}) });
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
  }, [syncUrl, dayId, unlockKey, refreshOnUnlock, page]);
  return null;
}

/**
 * Click tracking for the whole page: any element with data-track="<kind>"
 * (and an optional data-track-target) is recorded. keepalive survives the
 * navigation the click causes.
 */
export function ClickTracker({ syncUrl, dayId, page }: { syncUrl: string | null; dayId: string | null; page: string }) {
  useEffect(() => {
    if (!syncUrl) return;
    const onClick = (event: MouseEvent) => {
      const element = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-track]");
      if (!element) return;
      const kind = element.dataset.track ?? "";
      const target = element.dataset.trackTarget ?? element.textContent?.trim().slice(0, 200) ?? null;
      send(syncUrl, { kind, dayId: element.dataset.trackDay ?? dayId, page, target });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [syncUrl, dayId, page]);
  return null;
}

type WistiaVideo = { bind: (event: string, fn: (...args: number[]) => void) => void; percentWatched: () => number; time: () => number };
type YouTubePlayer = { getCurrentTime: () => number; getDuration: () => number; getPlayerState: () => number };
declare global {
  interface Window {
    _wq?: unknown[];
    YT?: { Player: new (id: string, options: Record<string, unknown>) => YouTubePlayer };
    onYouTubeIframeAPIReady?: () => void;
    Vidalytics?: { Embed?: new () => { run: (containerId: string) => void } };
    VidalyticsL?: { Loader?: new () => { loadScript: (url: string, done: () => void) => void } };
  }
}

/** Only provider scripts on these hosts are ever loaded. */
const SCRIPT_HOSTS = new Set(["fast.wistia.com", "www.youtube.com", "fast.vidalytics.com"]);

function loadScript(src: string, onLoad?: () => void) {
  try {
    if (!SCRIPT_HOSTS.has(new URL(src).hostname)) return;
  } catch {
    return;
  }
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
  if (existing) {
    if (onLoad) {
      if (existing.dataset.loaded === "1") onLoad();
      else existing.addEventListener("load", onLoad, { once: true });
    }
    return;
  }
  const script = document.createElement("script");
  script.src = src;
  script.async = true;
  script.addEventListener("load", () => {
    script.dataset.loaded = "1";
    onLoad?.();
  });
  document.head.appendChild(script);
}

const SAFE_ID = /^[A-Za-z0-9_-]{4,40}$/;

/**
 * The module's video (Wistia, YouTube or Vidalytics). Reports watched % (the
 * server re-checks it), broadcasts the playback time on `window` ("pcf-time")
 * for the timed CTA, and refreshes the page when the unlock threshold is
 * crossed so the next module opens without a manual reload.
 */
export function DayVideo({
  provider,
  videoId,
  dayId,
  syncUrl,
  unlockAt,
  alreadyWatched,
  durationHint,
}: {
  provider: "wistia" | "youtube" | "vidalytics";
  videoId: string;
  dayId: string;
  syncUrl: string | null;
  /** Watch % at which the next module unlocks (watch progression), else null. */
  unlockAt: number | null;
  alreadyWatched: number;
  /** Seconds, for the Vidalytics time-on-page fallback. */
  durationHint: number | null;
}) {
  const router = useRouter();
  const reported = useRef(alreadyWatched);
  const refreshed = useRef(unlockAt !== null && alreadyWatched >= unlockAt);
  const elementId = `pcf-video-${dayId}`;
  const [account, embed] = provider === "vidalytics" ? videoId.split("/") : [];
  const vidalyticsId = embed && SAFE_ID.test(embed) ? `vidalytics_embed_${embed}` : "";

  useEffect(() => {
    let apiReady = false;
    const time = (seconds: number) => window.dispatchEvent(new CustomEvent("pcf-time", { detail: { dayId, seconds } }));
    const progress = (fraction: number, seconds: number) => {
      apiReady = true;
      time(seconds);
      const percent = Math.floor(Math.max(0, Math.min(1, fraction)) * 100);
      // Every 5 points, and exactly when the unlock threshold is crossed.
      const crossed = unlockAt !== null && percent >= unlockAt && reported.current < unlockAt;
      if (percent < reported.current + 5 && !crossed) return;
      reported.current = percent;
      if (!syncUrl) return;
      const request = send(syncUrl, { kind: "watch", dayId, percent });
      if (crossed && !refreshed.current) {
        refreshed.current = true;
        void request?.then(() => router.refresh()).catch(() => undefined);
      }
    };
    const timers: number[] = [];
    const intervals: number[] = [];
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
    } else if (provider === "youtube") {
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
              intervals.push(
                window.setInterval(() => {
                  if (player.getPlayerState() !== 1) return;
                  const duration = player.getDuration();
                  watched += 1;
                  if (duration > 0) progress(Math.min(watched, duration) / duration, player.getCurrentTime());
                }, 1000),
              );
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
    } else if (provider === "vidalytics" && account && embed && SAFE_ID.test(account) && vidalyticsId) {
      const base = `https://fast.vidalytics.com/embeds/${account}/${embed}/`;
      loadScript(`${base}loader.min.js`, () => {
        try {
          const Loader = window.VidalyticsL?.Loader;
          const loader = Loader ? new Loader() : null;
          const run = () => {
            const Embed = window.Vidalytics?.Embed;
            if (Embed) new Embed().run(vidalyticsId);
          };
          if (loader) loader.loadScript(`${base}player.min.js`, run);
          else loadScript(`${base}player.min.js`, run);
        } catch {
          /* the fallback below takes over */
        }
      });
      // The player renders a normal <video> inside the container: read it directly.
      let watchedSeconds = 0;
      let lastTick = 0;
      intervals.push(
        window.setInterval(() => {
          const video = document.getElementById(vidalyticsId)?.querySelector("video");
          if (!video) return;
          apiReady = true;
          if (!video.paused && !video.ended) {
            const now = Date.now();
            if (lastTick) watchedSeconds += Math.min(2, (now - lastTick) / 1000);
            lastTick = now;
          } else lastTick = 0;
          if (video.duration > 0) progress(Math.min(watchedSeconds, video.duration) / video.duration, video.currentTime);
        }, 1000),
      );
    }
    // If the player can't be read (blocked script, unknown player), fall back to time on the page.
    timers.push(
      window.setTimeout(() => {
        if (apiReady) return;
        const started = Date.now();
        intervals.push(
          window.setInterval(() => {
            const seconds = (Date.now() - started) / 1000;
            if (durationHint && durationHint > 0) progress(Math.min(1, seconds / durationHint), seconds);
            else time(seconds);
          }, 1000),
        );
      }, 15000),
    );
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      intervals.forEach((interval) => window.clearInterval(interval));
    };
  }, [provider, videoId, dayId, syncUrl, elementId, unlockAt, router, account, embed, vidalyticsId, durationHint]);

  return (
    <div className="pcf-player" data-video-provider={provider}>
      {provider === "wistia" ? (
        <div className="wistia_responsive_padding" style={{ position: "absolute", inset: 0 }}>
          <div className={`wistia_embed wistia_async_${videoId} videoFoam=false`} style={{ height: "100%", width: "100%" }} />
        </div>
      ) : provider === "youtube" ? (
        <div id={elementId} className="absolute inset-0 h-full w-full" />
      ) : (
        <div id={vidalyticsId} className="absolute inset-0 h-full w-full" />
      )}
    </div>
  );
}

/**
 * The call to action under the video. always: shown; datetime: pops in at the
 * moment (checked every second); video_time: once playback passes the mark.
 * Once revealed it stays revealed for this browser.
 */
export function CtaButton({
  dayId,
  reveal,
  seconds,
  at,
  serverNow,
  text,
  subtext,
  url,
  newTab,
  bg,
  color,
  borderColor,
}: {
  dayId: string;
  reveal: "always" | "datetime" | "video_time";
  seconds: number;
  at: number | null;
  serverNow: number;
  text: string;
  subtext: string;
  url: string;
  newTab: boolean;
  bg: string;
  color: string;
  borderColor: string;
}) {
  const key = `pcf-cta-${dayId}`;
  const skew = useSkew(serverNow);
  const [shown, setShown] = useState(reveal === "always" || (reveal === "datetime" && at !== null && serverNow >= at));
  useEffect(() => {
    if (shown && reveal === "always") return;
    const show = () => {
      setShown(true);
      try {
        window.localStorage.setItem(key, "1");
      } catch {
        /* storage blocked */
      }
    };
    try {
      if (window.localStorage.getItem(key) === "1") {
        show();
        return;
      }
    } catch {
      /* storage blocked */
    }
    if (reveal === "datetime" && at !== null) {
      const timer = window.setInterval(() => {
        if (Date.now() + skew >= at) {
          show();
          window.clearInterval(timer);
        }
      }, 1000);
      return () => window.clearInterval(timer);
    }
    if (reveal === "video_time") {
      const onTime = (event: Event) => {
        const detail = (event as CustomEvent<{ dayId: string; seconds: number }>).detail;
        if (detail.dayId === dayId && detail.seconds >= seconds) show();
      };
      window.addEventListener("pcf-time", onTime);
      return () => window.removeEventListener("pcf-time", onTime);
    }
  }, [reveal, at, seconds, dayId, key, skew, shown]);
  if (!shown) return null;
  return (
    <div className="pcf-cta">
      <a href={url} className="pcf-btn" data-track="cta" data-track-target={text} style={{ background: bg, color, borderColor }} {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : { rel: "noopener" })}>
        {text}
      </a>
      {subtext ? <p className="pcf-cta-sub">{subtext}</p> : null}
    </div>
  );
}

/** A tracked call-to-action link (home blocks and other pages). */
export function TrackedLink({ href, syncUrl, dayId, className, style, children }: { href: string; syncUrl: string | null; dayId: string | null; className?: string; style?: React.CSSProperties; children: ReactNode }) {
  return (
    <a
      href={href}
      className={className}
      style={style}
      rel="noopener"
      onClick={() => {
        if (syncUrl) send(syncUrl, { kind: "cta", dayId, target: typeof children === "string" ? children : null });
      }}
    >
      {children}
    </a>
  );
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
