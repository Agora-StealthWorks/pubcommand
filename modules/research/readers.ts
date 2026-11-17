/**
 * Fallback readers for pages that block a direct fetch: a reader service
 * (Jina Reader) that renders the page from its own servers, and the Wayback
 * Machine's archived copy. Both are off unless RESEARCH_FALLBACK_READERS
 * turns them on. Pure decisions only; the fetching is in the web app.
 */

export const READERS = ["jina", "wayback"] as const;
export type Reader = (typeof READERS)[number];
export type ReadVia = "direct" | Reader;

export const READER_LABEL: Record<ReadVia, string> = { direct: "the page itself", jina: "a reader service (Jina)", wayback: "the Wayback Machine archive" };

/**
 * Which fallbacks may run, in order. RESEARCH_FALLBACK_READERS is a comma list
 * ("jina,wayback"), "all", or empty/"off" (the default: no third party sees the URL).
 */
export function fallbackReaders(env: Record<string, string | undefined>): Reader[] {
  const raw = (env.RESEARCH_FALLBACK_READERS ?? "").trim().toLowerCase();
  if (!raw || raw === "off" || raw === "none" || raw === "0" || raw === "false") return [];
  if (raw === "all" || raw === "on" || raw === "1" || raw === "true") return [...READERS];
  const wanted = raw.split(/[\s,]+/);
  return READERS.filter((reader) => wanted.includes(reader));
}

/** The reader-service address for a page (the page URL goes on the end, unencoded, as the service expects). */
export function jinaUrl(target: string): string {
  return `https://r.jina.ai/${target}`;
}

export function waybackLookupUrl(target: string): string {
  return `https://archive.org/wayback/available?url=${encodeURIComponent(target)}`;
}

/** The archived snapshot's address from the availability answer, forced to https on archive.org only. */
export function waybackSnapshot(answer: unknown): string | null {
  const closest = (answer as { archived_snapshots?: { closest?: { available?: boolean; url?: string } } } | null)?.archived_snapshots?.closest;
  if (!closest?.available || typeof closest.url !== "string") return null;
  try {
    const url = new URL(closest.url.replace(/^http:/, "https:"));
    return url.hostname === "web.archive.org" || url.hostname === "archive.org" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The title line a reader service puts at the top of its answer. */
export function readerTitle(text: string): string | null {
  return /^Title:\s*(.+)$/m.exec(text)?.[1]?.trim().slice(0, 200) ?? null;
}

const SHELL_MARKERS = ["enable javascript", "access denied", "are you a robot", "verify you are human", "unusual traffic", "please turn on javascript", "something went wrong", "subscribe to continue", "403 forbidden"];

/** A bot wall or empty app shell, not an article. */
export function looksLikeShell(text: string): boolean {
  const head = text.slice(0, 1000).toLowerCase();
  return SHELL_MARKERS.some((marker) => head.includes(marker));
}

/**
 * How much real prose a text has: characters in sentences of 12+ words.
 * Menus and ticker strips are fragments, so a blocked page scores near zero
 * even when it is long.
 */
export function proseScore(text: string): number {
  if (looksLikeShell(text)) return 0;
  // Link markup goes; pipes and bullets separate menu items, so they end a "sentence".
  const cleaned = text.replace(/\[[^\]]*\]\([^)]*\)/g, " ").replace(/\s*[|•·»]\s*/g, ". ").replace(/\s+/g, " ");
  let total = 0;
  for (const sentence of cleaned.split(/(?<=[.!?])\s+/)) if (sentence.trim().split(/\s+/).length >= 12) total += sentence.length;
  return total;
}

/** Enough prose to stop trying slower readers. */
export const GOOD_PROSE = 700;
/** Below this, nothing counts as the article. */
export const MIN_PROSE = 250;

export type ReadAttempt = { via: ReadVia; text: string; title: string | null };

/** The best attempt by prose, or null when none reached the minimum. Earlier readers win ties. */
export function pickBest(attempts: readonly ReadAttempt[]): (ReadAttempt & { score: number }) | null {
  let best: (ReadAttempt & { score: number }) | null = null;
  for (const attempt of attempts) {
    const score = proseScore(attempt.text);
    if (score >= MIN_PROSE && (!best || score > best.score)) best = { ...attempt, score };
  }
  return best;
}
