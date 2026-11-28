import type { DayState } from "../../../../../modules/funnels/state";
import { dayLabel, dayThumb, type DayRow, type FunnelRow } from "./data";

function LockBadge() {
  return (
    <span className="pcf-lock" aria-label="Locked" role="img">
      <span className="pcf-lock-badge">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
          <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z" />
        </svg>
      </span>
    </span>
  );
}

/** "22 hrs 51 mins", "3 days", "40 mins": a rough time span for status lines. */
export function spanText(ms: number): string {
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (days >= 2) return plural(days, "day");
  if (hours >= 1) return `${plural(hours, "hr")} ${plural(minutes % 60, "min")}`;
  return plural(minutes, "min");
}

/** The status line under an episode in the sidebar list. */
export function episodeStatus(state: DayState, now: Date, current: boolean): { text: string; now: boolean } {
  switch (state.kind) {
    case "video":
      if (state.expiresAt) return { text: `Expires in ${spanText(state.expiresAt.getTime() - now.getTime())}`, now: true };
      return { text: current ? "Now playing" : "Watch now", now: current };
    case "live":
      return { text: "Live now", now: true };
    case "replay_pending":
      return { text: "Replay coming soon", now: false };
    case "coming_soon":
      return { text: "Coming soon", now: false };
    case "closed":
      return { text: "Closed", now: false };
    case "locked":
      if (state.reason === "expired") return { text: "Access expired", now: false };
      if (state.reason === "passed") return { text: "No longer available", now: false };
      if (state.unlockAt && state.unlockAt > now) {
        const ms = state.unlockAt.getTime() - now.getTime();
        const days = Math.round(ms / 86_400_000);
        return { text: ms >= 20 * 3_600_000 ? `Available in ${days} day${days === 1 ? "" : "s"}` : `Available in ${spanText(ms)}`, now: false };
      }
      return { text: "Locked", now: false };
  }
}

/**
 * The sidebar episode list (design "sidebar"): every module as a row with its
 * thumbnail (blurred when locked, if the funnel says so), label, title and a
 * status line: expires in / access expired / available in N days.
 */
export function EpisodeList({ funnel, days, states, base, carry, currentDayId, now }: { funnel: FunnelRow; days: DayRow[]; states: DayState[]; base: string; carry: string; currentDayId?: string; now: Date }) {
  if (!days.length) return null;
  return (
    <nav aria-label="Episodes" className="pcf-eplist-nav">
      <ol className="pcf-eplist">
        {days.map((day, index) => {
          const state = states[index]!;
          if (funnel.hidePassedModules && state.kind === "locked" && state.reason === "passed") return null;
          const open = state.kind !== "locked" && state.kind !== "closed";
          const current = day.id === currentDayId;
          const thumb = dayThumb(day, base, state.kind === "video");
          const status = episodeStatus(state, now, current);
          return (
            <li key={day.id}>
              <a href={`${base}/day-${day.position}${carry}`} className="pcf-ep" aria-current={current ? "page" : undefined} data-locked={open ? undefined : "1"}>
                <span className={`pcf-ep-thumb${!open && funnel.navBlurLocked ? " is-blur" : ""}`}>
                  {thumb ? <img src={thumb} alt="" loading="lazy" /> : <span className="pcf-ph">{day.position}</span>}
                  {!open ? <LockBadge /> : null}
                  {current && open ? (
                    <span className="pcf-ep-play" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </span>
                  ) : null}
                </span>
                <span className="pcf-ep-body">
                  <span className="pcf-ep-label">{dayLabel(day)}</span>
                  {day.title ? <span className="pcf-ep-title">{day.title}</span> : null}
                  <span className={`pcf-ep-status${status.now ? " is-now" : ""}`}>{status.text}</span>
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
