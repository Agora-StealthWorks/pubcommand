/**
 * Pure ingest helpers for Research Extractor: URL safety checks, HTML and
 * caption parsing, and text normalization. No network or database here; the
 * server code in apps/web/src/features/research/ does the fetching.
 */

/** Text longer than this is cut before it goes to the AI. */
export const MAX_SOURCE_CHARS = 300_000;
/** Pasted text shorter than this is too thin to extract cards from. */
export const MIN_SOURCE_CHARS = 80;

export type SourceKind = "text" | "url" | "file" | "youtube";

// ---------------------------------------------------------------------------
// SSRF guard
// ---------------------------------------------------------------------------

function ipv4Parts(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  return nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? nums : null;
}

function blockedIpv4([a, b, c]: number[]): boolean {
  return (
    a === 0 || // "this" network
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, including cloud metadata 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 0 && c === 0) || // IETF protocol assignments
    (a === 192 && b === 0 && c === 2) || // documentation
    (a === 192 && b === 168) || // private
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // documentation
    (a === 203 && b === 0 && c === 113) || // documentation
    a >= 224 // multicast, reserved and broadcast
  );
}

/** Expand an IPv6 address to eight 16-bit groups, or null if it is not one. */
function ipv6Groups(ip: string): number[] | null {
  let address = ip.toLowerCase().replace(/^\[|\]$/g, "");
  const zone = address.indexOf("%");
  if (zone >= 0) address = address.slice(0, zone);
  if (!address.includes(":")) return null;
  // A trailing dotted IPv4 (::ffff:10.0.0.1) becomes two groups.
  const dotted = address.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const v4 = ipv4Parts(dotted[2]!);
    if (!v4) return null;
    address = `${dotted[1]}${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (halves.length === 2 && missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8 || !groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => parseInt(group, 16));
}

/**
 * True when an IP address must never be fetched: loopback, private, link-local,
 * carrier-grade NAT, multicast, reserved, and IPv6 forms of the same (including
 * IPv4-mapped addresses). Anything that does not parse as an IP is blocked too.
 */
export function isBlockedAddress(ip: string): boolean {
  const v4 = ipv4Parts(ip);
  if (v4) return blockedIpv4(v4);
  const g = ipv6Groups(ip);
  if (!g) return true;
  const allZeroTo = (n: number) => g.slice(0, n).every((value) => value === 0);
  if (allZeroTo(8)) return true; // ::
  if (allZeroTo(7) && g[7] === 1) return true; // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) addresses.
  if (allZeroTo(5) && (g[5] === 0xffff || g[5] === 0)) {
    return blockedIpv4([g[6]! >> 8, g[6]! & 0xff, g[7]! >> 8, g[7]! & 0xff]);
  }
  // NAT64 (64:ff9b::/96) wraps an IPv4 address.
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((value) => value === 0)) {
    return blockedIpv4([g[6]! >> 8, g[6]! & 0xff, g[7]! >> 8, g[7]! & 0xff]);
  }
  const first = g[0]!;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((first & 0xff00) === 0xff00) return true; // multicast
  if (first === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (first === 0x0100 && allZeroTo(4)) return true; // discard prefix 100::/64
  return false;
}

export function isIpLiteral(host: string): boolean {
  return ipv4Parts(host) !== null || ipv6Groups(host) !== null;
}

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".corp", ".intranet", ".railway.internal"];

/**
 * Check a user-supplied URL before anything is fetched. Returns the parsed URL,
 * or a reason it is refused. DNS answers are checked separately at connect time.
 */
export function checkFetchUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "That is not a valid web address." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "Only http and https links can be read." };
  }
  if (url.username || url.password) return { ok: false, reason: "Links with a user name or password are not allowed." };
  if (url.port && !["80", "443", "8080", "8443"].includes(url.port)) {
    return { ok: false, reason: "That port is not allowed." };
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return { ok: false, reason: "That link has no host." };
  if (host === "localhost" || BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix)) || (!host.includes(".") && !isIpLiteral(host))) {
    return { ok: false, reason: "That address points inside a private network, so it cannot be read." };
  }
  // Numeric shorthand such as http://2130706433/ or http://0x7f.1/ is refused outright.
  if (/^[0-9.]+$/.test(host) && !ipv4Parts(host)) return { ok: false, reason: "That address is not allowed." };
  if (/^0x/i.test(host) || /(^|\.)0x[0-9a-f]+/i.test(host)) return { ok: false, reason: "That address is not allowed." };
  if (isIpLiteral(host) && isBlockedAddress(host)) {
    return { ok: false, reason: "That address points inside a private network, so it cannot be read." };
  }
  return { ok: true, url };
}

// ---------------------------------------------------------------------------
// HTML to text
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  copy: "©",
  reg: "®",
  trade: "™",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Collapse runs of spaces, keep paragraph breaks, trim, and cap the length. */
export function normalizeText(text: string, max = MAX_SOURCE_CHARS): string {
  const clean = text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[\t  ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return clean.length > max ? clean.slice(0, max) : clean;
}

function largestBlock(html: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  let best: string | null = null;
  for (const match of html.matchAll(re)) {
    const inner = match[1] ?? "";
    if (!best || inner.length > best.length) best = inner;
  }
  return best && best.replace(/<[^>]+>/g, "").trim().length > 600 ? best : null;
}

export function htmlTitle(html: string): string | null {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
  const title = og?.[1] ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const clean = title ? normalizeText(decodeEntities(title.replace(/<[^>]+>/g, ""))).replace(/\n/g, " ") : "";
  return clean ? clean.slice(0, 200) : null;
}

/**
 * Readable text from a web page. Prefers the article or main body so menus and
 * footers do not crowd out the story, keeps paragraph breaks, and drops scripts.
 */
export function htmlToText(html: string): string {
  const withoutJunk = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|form)\b[\s\S]*?<\/\1>/gi, " ");
  const body = largestBlock(withoutJunk, "article") ?? largestBlock(withoutJunk, "main") ?? withoutJunk;
  const trimmed = body.replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, " ");
  const text = trimmed
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|h[1-6]|li|blockquote|tr|figcaption|pre)>/gi, "\n\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ");
  return normalizeText(decodeEntities(text));
}

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------

/** The 11-character video id from any common YouTube link, or null. */
export function youtubeVideoId(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.split("/")[1] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else {
      const match = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/);
      id = match?.[1] ?? null;
    }
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

export type CaptionTrack = { baseUrl: string; languageCode: string; kind: string | null; name: string };

/** Caption tracks listed in a YouTube watch page, or [] when there are none. */
export function parseCaptionTracks(html: string): CaptionTrack[] {
  const start = html.indexOf('"captionTracks":');
  if (start < 0) return [];
  const open = html.indexOf("[", start);
  if (open < 0) return [];
  let depth = 0;
  let end = -1;
  let inString = false;
  for (let i = open; i < html.length; i += 1) {
    const ch = html[i];
    if (inString) {
      if (ch === "\\") i += 1;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return [];
  try {
    const raw = JSON.parse(html.slice(open, end + 1)) as {
      baseUrl?: string;
      languageCode?: string;
      kind?: string;
      name?: { simpleText?: string; runs?: { text?: string }[] };
    }[];
    return raw
      .filter((track) => typeof track.baseUrl === "string")
      .map((track) => ({
        baseUrl: track.baseUrl!,
        languageCode: track.languageCode ?? "",
        kind: track.kind ?? null,
        name: track.name?.simpleText ?? track.name?.runs?.map((run) => run.text ?? "").join("") ?? "",
      }));
  } catch {
    return [];
  }
}

/** Prefer human English captions, then auto English, then whatever is first. */
export function pickCaptionTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  const english = (track: CaptionTrack) => track.languageCode === "en" || track.languageCode.startsWith("en-");
  return tracks.find((t) => english(t) && t.kind !== "asr") ?? tracks.find(english) ?? tracks[0] ?? null;
}

export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/**
 * Turn YouTube timed-text XML into a transcript with a [m:ss] stamp at the
 * start of each paragraph (about every 30 seconds), so cards can cite a time.
 */
export function timedTextToTranscript(xml: string, everySeconds = 30): string {
  const lines: { start: number; text: string }[] = [];
  for (const match of xml.matchAll(/<(text|p)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const attrs = match[2] ?? "";
    const startAttr = attrs.match(/\bstart="([\d.]+)"/)?.[1];
    const tAttr = attrs.match(/\bt="(\d+)"/)?.[1];
    const start = startAttr ? Number(startAttr) : tAttr ? Number(tAttr) / 1000 : 0;
    const text = decodeEntities(decodeEntities((match[3] ?? "").replace(/<[^>]+>/g, ""))).replace(/\s+/g, " ").trim();
    if (text) lines.push({ start, text });
  }
  const paragraphs: string[] = [];
  let current: string[] = [];
  let mark = -Infinity;
  for (const line of lines) {
    if (line.start - mark >= everySeconds) {
      if (current.length) paragraphs.push(current.join(" "));
      current = [`[${formatTimestamp(line.start)}]`];
      mark = line.start;
    }
    current.push(line.text);
  }
  if (current.length) paragraphs.push(current.join(" "));
  return normalizeText(paragraphs.join("\n\n"));
}

// ---------------------------------------------------------------------------
// Titles
// ---------------------------------------------------------------------------

/** A short label for a source: the typed title, else the host, else the first line. */
export function deriveTitle(input: { title?: string | null; url?: string | null; text?: string | null; fallback: string }): string {
  const typed = input.title?.trim();
  if (typed) return typed.slice(0, 200);
  if (input.url) {
    try {
      return new URL(input.url).hostname.replace(/^www\./, "");
    } catch {
      // fall through
    }
  }
  const first = input.text?.split("\n").map((line) => line.trim()).find((line) => line.length > 0);
  if (first) return first.length > 80 ? `${first.slice(0, 77).trimEnd()}…` : first;
  return input.fallback;
}
