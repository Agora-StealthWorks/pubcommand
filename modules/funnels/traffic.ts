/**
 * Bot and data-center traffic, for stats. PURE (no DB, no network).
 *
 * Email security scanners (link "safe" checkers at Microsoft, Proofpoint,
 * Mimecast and others) open every link in every email from cloud servers,
 * often in a real headless browser that runs our page script. A single send
 * can produce hundreds of "visitors" that are not people. So stats FLAG traffic
 * rather than trust it:
 *   1. a user agent that names a bot, crawler, link previewer or HTTP library;
 *   2. an IP address inside a known cloud / hosting range (people browse from
 *      home and mobile networks, which are never on this list);
 *   3. `navigator.webdriver` reported by the page (automation).
 * Flagged events are still stored, with the reason, so nothing is lost; the
 * stats page leaves them out by default.
 */
import { DATACENTER_IPV4, DATACENTER_IPV6 } from "./datacenter-ranges";

export const BOT_REASONS = ["user_agent", "datacenter", "webdriver"] as const;
export type BotReason = (typeof BOT_REASONS)[number];

export const BOT_REASON_LABELS: Record<BotReason, string> = {
  user_agent: "Bot or link-preview user agent",
  datacenter: "Cloud / data-center network",
  webdriver: "Automated browser",
};

const BOT_UA =
  /bot\b|bot[/;)]|crawl|spider|slurp|scrap|mediapartners|facebookexternalhit|facebookcatalog|embedly|quora link|outbrain|pinterest|vkshare|w3c_validator|whatsapp|telegram|discord|slack|skypeuripreview|linkedin|twitter|applebot|bingpreview|preview|headless|phantomjs|puppeteer|playwright|selenium|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|curl\/|wget\/|python|aiohttp|httpx|axios\/|node-fetch|undici|go-http-client|java\/|okhttp|libwww|httpclient|postman|insomnia|barracuda|proofpoint|mimecast|safelinks|urldefense|forcepoint|symantec|trendmicro|msoffice|microsoft office|outlook-ios-linkpreview/i;

/**
 * True for a user agent that is not a person's browser: empty or very short
 * (every real browser sends a long one), or naming a bot, a link previewer,
 * a mail scanner, a headless browser or an HTTP library.
 */
export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  const value = (userAgent ?? "").trim();
  if (value.length < 20) return true;
  return BOT_UA.test(value);
}

/** "203.0.113.9" → 32-bit unsigned integer; null when not dotted-quad IPv4. */
export function ipv4ToInt(ip: string): number | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return null;
  return ((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!;
}

/** Full IPv6 (including "::" shorthand and an embedded IPv4 tail) → BigInt; null when not IPv6. */
export function ipv6ToBigInt(ip: string): bigint | null {
  let value = ip.trim().toLowerCase();
  if (!value.includes(":")) return null;
  value = value.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const v4 = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(value);
  if (v4) {
    const n = ipv4ToInt(v4[1]!);
    if (n === null) return null;
    value = `${value.slice(0, -v4[1]!.length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  let result = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    result = (result << 16n) + BigInt(parseInt(group, 16));
  }
  return result;
}

type Range4 = { start: number; end: number };
type Range6 = { start: bigint; end: bigint };

/** "10.0.0.0/8" → inclusive integer range; null when malformed. */
export function parseCidr4(cidr: string): Range4 | null {
  const [ip, bitsRaw] = cidr.trim().split("/");
  const base = ip ? ipv4ToInt(ip) : null;
  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
  if (base === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  const size = 2 ** (32 - bits);
  const start = base - (base % size);
  return { start, end: start + size - 1 };
}

export function parseCidr6(cidr: string): Range6 | null {
  const [ip, bitsRaw] = cidr.trim().split("/");
  const base = ip ? ipv6ToBigInt(ip) : null;
  const bits = bitsRaw === undefined ? 128 : Number(bitsRaw);
  if (base === null || !Number.isInteger(bits) || bits < 0 || bits > 128) return null;
  const size = 1n << BigInt(128 - bits);
  const start = base - (base % size);
  return { start, end: start + size - 1n };
}

function sorted4(list: readonly string[]): Range4[] {
  return list
    .map(parseCidr4)
    .filter((range): range is Range4 => range !== null)
    .sort((a, b) => a.start - b.start);
}

let cache4: Range4[] | null = null;
let cache6: Range6[] | null = null;

/**
 * Is this IP inside a known cloud / hosting range? `extra` adds ranges (CIDR,
 * IPv4 or IPv6) on top of the built-in list. Private and invalid addresses are
 * never data-center traffic.
 */
export function isDatacenterIp(ip: string | null | undefined, extra: readonly string[] = []): boolean {
  if (!ip) return false;
  const v4 = ipv4ToInt(ip);
  if (v4 !== null) {
    cache4 ??= sorted4(DATACENTER_IPV4);
    const ranges = extra.length ? sorted4([...DATACENTER_IPV4, ...extra.filter((item) => !item.includes(":"))]) : cache4;
    // Binary search for the last range starting at or before the address, then
    // look back a few entries because ranges can nest.
    let lo = 0;
    let hi = ranges.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ranges[mid]!.start <= v4) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    for (let index = found; index >= 0 && index > found - 16; index -= 1) if (v4 <= ranges[index]!.end) return true;
    return false;
  }
  const v6 = ipv6ToBigInt(ip);
  if (v6 === null) return false;
  // An IPv4-mapped IPv6 address (::ffff:a.b.c.d) is checked as IPv4.
  if (v6 >> 32n === 0xffffn) {
    const n = Number(v6 & 0xffffffffn);
    return isDatacenterIp(`${n >>> 24}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`, extra);
  }
  cache6 ??= DATACENTER_IPV6.map(parseCidr6).filter((range): range is Range6 => range !== null);
  const ranges = extra.length ? [...cache6, ...extra.filter((item) => item.includes(":")).map(parseCidr6).filter((range): range is Range6 => range !== null)] : cache6;
  return ranges.some((range) => v6 >= range.start && v6 <= range.end);
}

/** The visitor's address: the first X-Forwarded-For hop (set by the edge proxy), else X-Real-IP. */
export function clientIpOf(headers: { get(name: string): string | null }): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || null;
}

/** Why this request looks automated, or null for a person. User agent first (cheapest), then network, then webdriver. */
export function classifyTraffic(input: { userAgent: string | null | undefined; ip: string | null | undefined; webdriver?: boolean; extraRanges?: readonly string[] }): BotReason | null {
  if (isBotUserAgent(input.userAgent)) return "user_agent";
  if (isDatacenterIp(input.ip, input.extraRanges ?? [])) return "datacenter";
  if (input.webdriver) return "webdriver";
  return null;
}

export function isBotReason(value: unknown): value is BotReason {
  return typeof value === "string" && (BOT_REASONS as readonly string[]).includes(value);
}

export type FlaggableRow = { botReason: string | null; visitorId: string };

/**
 * Split stats rows into people and automated traffic. People only by default;
 * `includeBots` keeps everything. The summary counts flagged rows and distinct
 * flagged visitors per reason, for the "filtered out" line on the stats page.
 */
export function filterTraffic<T extends FlaggableRow>(rows: readonly T[], includeBots = false): { kept: T[]; flagged: number; flaggedVisitors: number; byReason: Partial<Record<BotReason, number>> } {
  const kept: T[] = [];
  const byReason: Partial<Record<BotReason, number>> = {};
  const visitors = new Set<string>();
  let flagged = 0;
  for (const row of rows) {
    if (row.botReason) {
      flagged += 1;
      visitors.add(row.visitorId);
      if (isBotReason(row.botReason)) byReason[row.botReason] = (byReason[row.botReason] ?? 0) + 1;
      if (includeBots) kept.push(row);
    } else kept.push(row);
  }
  return { kept, flagged, flaggedVisitors: visitors.size, byReason };
}

/** Click kinds a public page may record (anything else is refused). */
export const CLICK_KINDS = [
  "cta",
  "resource",
  "next",
  "prev",
  "calendar",
  "live_join",
  "live_redirect",
  "early_join",
  "today_training",
  "nav_link",
  "agenda_link",
  "home_button",
  "deadline_bar",
  "close_button",
] as const;
export type ClickKind = (typeof CLICK_KINDS)[number];
export function isClickKind(value: unknown): value is ClickKind {
  return typeof value === "string" && (CLICK_KINDS as readonly string[]).includes(value);
}

/** Labels for the stats page. */
export const CLICK_LABELS: Record<ClickKind, string> = {
  cta: "Call-to-action button",
  resource: "Resource / homework link",
  next: "Next-day button",
  prev: "Previous-day button (locked day)",
  calendar: "Add to calendar",
  live_join: "Join the livestream (click)",
  live_redirect: "Livestream auto-redirect",
  early_join: "Join the room early",
  today_training: "Join today's session",
  nav_link: "Navigation link",
  agenda_link: "Agenda link",
  home_button: "Home page button",
  deadline_bar: "Deadline bar button",
  close_button: "Close page button",
};

export const PAGE_KINDS = ["waitlist", "home", "day", "close", "custom"] as const;
export type PageKind = (typeof PAGE_KINDS)[number];
export function isPageKind(value: unknown): value is PageKind {
  return typeof value === "string" && (PAGE_KINDS as readonly string[]).includes(value);
}

/** mobile | tablet | desktop from the user agent (and the client hint when sent). */
export function deviceOf(userAgent: string | null | undefined, mobileHint?: string | null): "mobile" | "tablet" | "desktop" {
  const ua = userAgent ?? "";
  if (/ipad|tablet|kindle|silk|playbook|(android(?!.*mobile))/i.test(ua)) return "tablet";
  if (mobileHint === "?1" || /mobi|iphone|ipod|android.*mobile|windows phone|blackberry|opera mini/i.test(ua)) return "mobile";
  return "desktop";
}
