/**
 * The URL guard for everything Intel fetches on a user's behalf (landing pages,
 * video pages). Pure: DNS resolution and the network are injected.
 *
 * Rules:
 * - http or https only, default ports only, no user:password@ part.
 * - No local or internal names (localhost, *.local, *.internal, *.localhost, single-label hosts).
 * - Every address the name resolves to must be public: no loopback, private,
 *   link-local (cloud metadata), carrier-grade NAT, multicast or reserved ranges,
 *   including IPv4 addresses wrapped in IPv6.
 * - Redirects are followed by hand, and every hop is checked again.
 */

export type GuardResult = { ok: true; url: URL } | { ok: false; reason: string };

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".lan", ".corp", ".intranet"];

function ipv4Parts(value: string): number[] | null {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return null;
  const parts = value.split(".").map(Number);
  return parts.every((part) => part >= 0 && part <= 255) ? parts : null;
}

function privateV4([a, b, c]: number[]): boolean {
  if (a === undefined || b === undefined || c === undefined) return true;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

/** Expand an IPv6 address to eight 16-bit groups, or null when it is not one. */
function ipv6Groups(value: string): number[] | null {
  let text = value.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0] ?? "";
  if (!text.includes(":")) return null;
  // A trailing dotted IPv4 part (::ffff:10.0.0.1) becomes two groups.
  const v4 = text.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4) {
    const parts = ipv4Parts(v4[1]!);
    if (!parts) return null;
    text = `${text.slice(0, -v4[1]!.length)}${((parts[0]! << 8) | parts[1]!).toString(16)}:${((parts[2]! << 8) | parts[3]!).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => parseInt(group, 16));
}

/** True for any address a server-side fetch must never reach. Unparseable input counts as private. */
export function isPrivateAddress(address: string): boolean {
  const v4 = ipv4Parts(address);
  if (v4) return privateV4(v4);
  const g = ipv6Groups(address);
  if (!g) return true;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number];
  const embeddedV4 = [g6 >> 8, g6 & 255, g7 >> 8, g7 & 255];
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0) {
    // ::, ::1, ::a.b.c.d (compatible) and ::ffff:a.b.c.d (mapped)
    if (g5 === 0 || g5 === 0xffff) return g5 === 0 && g6 === 0 && g7 <= 1 ? true : privateV4(embeddedV4);
    return true;
  }
  if (g0 === 0x64 && g1 === 0xff9b) return privateV4(embeddedV4); // NAT64
  if ((g0 & 0xfe00) === 0xfc00) return true; // unique local
  if ((g0 & 0xffc0) === 0xfe80) return true; // link-local
  if ((g0 & 0xff00) === 0xff00) return true; // multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentation
  if (g0 === 0x2002) return privateV4([g1 >> 8, g1 & 255, g2 >> 8, g2 & 255]); // 6to4
  if (g0 === 0x2001 && g1 === 0) return true; // Teredo
  return false;
}

/** Checks the shape of a URL (no DNS). */
export function checkUrlShape(input: string | URL): GuardResult {
  let url: URL;
  try {
    url = typeof input === "string" ? new URL(input.trim()) : new URL(input.toString());
  } catch {
    return { ok: false, reason: "That is not a valid URL." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: "Only http and https links can be fetched." };
  if (url.username || url.password) return { ok: false, reason: "Links with a user name or password are not fetched." };
  if (url.port && !((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80"))) {
    return { ok: false, reason: "Links on non-standard ports are not fetched." };
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return { ok: false, reason: "That link has no host." };
  if (host.startsWith("[") || ipv4Parts(host) || /^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) {
    const bare = host.replace(/^\[|\]$/g, "");
    if (/^\d+$/.test(bare) || /^0x/i.test(bare) || isPrivateAddress(bare)) return { ok: false, reason: "That link points at a private address." };
    return { ok: true, url };
  }
  if (host === "localhost" || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return { ok: false, reason: "That link points at a private host." };
  if (!host.includes(".")) return { ok: false, reason: "That link points at a private host." };
  if (!/^[a-z0-9.-]+$/.test(host)) return { ok: false, reason: "That host name is not valid." };
  return { ok: true, url };
}

export type ResolveHost = (hostname: string) => Promise<string[]>;

/** Shape check plus DNS: every resolved address must be public. */
export async function checkPublicUrl(input: string | URL, resolve: ResolveHost): Promise<GuardResult> {
  const shape = checkUrlShape(input);
  if (!shape.ok) return shape;
  const host = shape.url.hostname.replace(/^\[|\]$/g, "");
  if (ipv4Parts(host) || host.includes(":")) return shape;
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    return { ok: false, reason: `${host} could not be found.` };
  }
  if (!addresses.length) return { ok: false, reason: `${host} could not be found.` };
  if (addresses.some(isPrivateAddress)) return { ok: false, reason: "That link points at a private address." };
  return shape;
}

// ── Guarded fetch with manual redirects ─────────────────────────────────────

/** One HTTP request with no redirect following. `body` is read up to `maxBytes` and flagged when cut. */
export type FetchOnce = (
  url: URL,
  options: { maxBytes: number; timeoutMs: number },
) => Promise<{ status: number; headers: Record<string, string>; body: Uint8Array; truncated: boolean }>;

export type GuardedFetchResult =
  | { ok: true; finalUrl: string; status: number; contentType: string; body: Uint8Array; truncated: boolean; redirects: string[] }
  | { ok: false; reason: string; status?: number; finalUrl?: string };

export const MAX_REDIRECTS = 5;

export async function guardedFetch(
  start: string,
  deps: { fetchOnce: FetchOnce; resolve: ResolveHost },
  limits: { maxBytes: number; timeoutMs: number; maxRedirects?: number } = { maxBytes: 2 * 1024 * 1024, timeoutMs: 15_000 },
): Promise<GuardedFetchResult> {
  let current = start;
  const redirects: string[] = [];
  for (let hop = 0; hop <= (limits.maxRedirects ?? MAX_REDIRECTS); hop += 1) {
    const check = await checkPublicUrl(current, deps.resolve);
    if (!check.ok) return { ok: false, reason: check.reason, finalUrl: current };
    let response;
    try {
      response = await deps.fetchOnce(check.url, { maxBytes: limits.maxBytes, timeoutMs: limits.timeoutMs });
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "The page could not be fetched.", finalUrl: current };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers["location"];
      if (!location) return { ok: false, reason: `Redirect (${response.status}) with no destination.`, status: response.status, finalUrl: current };
      let next: string;
      try {
        next = new URL(location, check.url).toString();
      } catch {
        return { ok: false, reason: "The page redirected to an invalid URL.", status: response.status, finalUrl: current };
      }
      redirects.push(next);
      current = next;
      continue;
    }
    return {
      ok: true,
      finalUrl: check.url.toString(),
      status: response.status,
      contentType: (response.headers["content-type"] ?? "").toLowerCase(),
      body: response.body,
      truncated: response.truncated,
      redirects,
    };
  }
  return { ok: false, reason: "Too many redirects.", finalUrl: current };
}
