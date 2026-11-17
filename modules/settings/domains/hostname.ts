/**
 * Custom-domain hostname rules. Pure: shared by the Settings → Domains actions,
 * the middleware and the tests.
 */

export type HostnameCheck =
  | { ok: true; hostname: string; apex: string; isApex: boolean }
  | { ok: false; reason: string };

/**
 * Common two-level public suffixes, so `example.co.uk` counts as an apex. This is
 * only used to offer the www choice and to word DNS advice; it never decides
 * routing, so a missing suffix only costs a slightly worse hint.
 */
const TWO_LEVEL_SUFFIXES = new Set([
  "co.uk", "org.uk", "me.uk", "ltd.uk", "plc.uk", "ac.uk",
  "com.au", "net.au", "org.au",
  "co.nz", "org.nz",
  "co.za", "co.jp", "co.in", "co.kr",
  "com.br", "com.mx", "com.ar", "com.sg", "com.hk", "com.tr", "com.cn",
]);

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

function normalizeRoot(rootDomain: string): string {
  return rootDomain.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
}

/** The registrable part of a hostname (best effort, see TWO_LEVEL_SUFFIXES). */
export function apexOf(hostname: string): string {
  const labels = hostname.split(".");
  if (labels.length <= 2) return hostname;
  const lastTwo = labels.slice(-2).join(".");
  if (TWO_LEVEL_SUFFIXES.has(lastTwo)) return labels.slice(-3).join(".");
  return lastTwo;
}

/** True for hosts the platform serves itself; these are never custom domains. */
export function isPlatformHost(host: string, rootDomain: string): boolean {
  const root = normalizeRoot(rootDomain);
  const value = host.toLowerCase();
  if (value === "localhost" || value.endsWith(".localhost") || value === "127.0.0.1") return true;
  if (!root) return false;
  return value === root || value.endsWith(`.${root}`);
}

/**
 * Accepts what people paste ("https://Shop.Example.com/path", "example.com.")
 * and returns the lowercased ASCII (punycode) hostname, or why it cannot be used.
 */
export function normalizeHostname(input: string, rootDomain: string): HostnameCheck {
  let value = input.trim().toLowerCase();
  if (!value) return { ok: false, reason: "Enter a domain, like example.com." };
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.split(/[/?#]/)[0] ?? "";
  if (value.includes("@")) return { ok: false, reason: "Enter just the domain, like example.com." };
  value = value.replace(/:\d+$/, "").replace(/\.$/, "");
  if (value.startsWith("*.")) return { ok: false, reason: "Wildcard domains are not supported. Connect each hostname." };
  if (/[^a-z0-9.-]/.test(value)) {
    try {
      value = new URL(`http://${value}`).hostname;
    } catch {
      return { ok: false, reason: "That is not a valid domain name." };
    }
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value) || value.includes(":")) {
    return { ok: false, reason: "Use a domain name, not an IP address." };
  }
  if (value.length > 253) return { ok: false, reason: "That domain is too long." };
  const labels = value.split(".");
  if (labels.length < 2) return { ok: false, reason: "Include the ending, like example.com." };
  if (!labels.every((label) => LABEL.test(label))) return { ok: false, reason: "That is not a valid domain name." };
  if (!TLD.test(labels[labels.length - 1]!)) return { ok: false, reason: "That domain ending is not valid." };
  if (isPlatformHost(value, rootDomain)) {
    return { ok: false, reason: "That address already belongs to PubCommand. Use a domain you own." };
  }
  if (value.endsWith(".railway.app") || value.endsWith(".up.railway.app") || value.endsWith(".railway.internal")) {
    return { ok: false, reason: "Railway addresses cannot be connected as custom domains." };
  }
  const apex = apexOf(value);
  return { ok: true, hostname: value, apex, isApex: apex === value };
}

/** The www companion of an apex domain, e.g. example.com → www.example.com. */
export function wwwOf(apex: string): string {
  return `www.${apex}`;
}

/** The DNS name relative to its zone ("@" for the apex), as people type it into a DNS panel. */
export function relativeName(fqdn: string, zone: string): string {
  const name = fqdn.toLowerCase().replace(/\.$/, "");
  const z = zone.toLowerCase().replace(/\.$/, "");
  if (name === z) return "@";
  if (name.endsWith(`.${z}`)) return name.slice(0, -(z.length + 1));
  return name;
}
