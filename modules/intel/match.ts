/** Competitor records and sender matching. Pure. */

export type CompetitorMatchInput = {
  id: string;
  senderAddresses: readonly string[];
  senderDomains: readonly string[];
  websites: readonly string[];
};

export type CompetitorMatch = { competitorId: string; matchedBy: "address" | "domain" | "website" };

/** Split a text area or comma list into clean, unique entries. */
export function parseList(value: string, max = 50): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of value.split(/[\n,;]+/)) {
    const item = piece.trim().replace(/\s+/g, " ");
    const key = item.toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    out.push(item.slice(0, 200));
    if (out.length >= max) break;
  }
  return out;
}

/** "https://www.Example.com/path", "@example.com", "example.com." → "example.com". Empty when not a domain. */
export function normalizeDomain(value: string): string {
  let text = value.trim().toLowerCase();
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^.*@/, "");
  text = text.split(/[/?#:\s]/)[0] ?? "";
  text = text.replace(/^www\./, "").replace(/\.+$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(text) ? text : "";
}

export function normalizeAddress(value: string): string {
  const text = value.trim().toLowerCase().replace(/^mailto:/, "").replace(/^<|>$/g, "");
  return /^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(text) ? text : "";
}

export function senderDomain(address: string): string {
  return normalizeDomain(address.split("@")[1] ?? "");
}

function domainMatches(domain: string, candidate: string): boolean {
  return Boolean(candidate) && (domain === candidate || domain.endsWith(`.${candidate}`));
}

/**
 * Which competitor sent this? An exact sender address wins, then the most specific
 * sender domain (a subdomain counts), then a website's domain. Null when unknown.
 */
export function matchCompetitor(fromAddress: string, competitors: readonly CompetitorMatchInput[]): CompetitorMatch | null {
  const address = normalizeAddress(fromAddress);
  if (!address) return null;
  for (const competitor of competitors) {
    if (competitor.senderAddresses.some((entry) => normalizeAddress(entry) === address)) {
      return { competitorId: competitor.id, matchedBy: "address" };
    }
  }
  const domain = senderDomain(address);
  if (!domain) return null;
  let best = null as { match: CompetitorMatch; length: number } | null;
  for (const kind of ["domain", "website"] as const) {
    for (const competitor of competitors) {
      const list = kind === "domain" ? competitor.senderDomains : competitor.websites;
      for (const entry of list) {
        const candidate = normalizeDomain(entry);
        if (domainMatches(domain, candidate) && (!best || candidate.length > best.length)) {
          best = { match: { competitorId: competitor.id, matchedBy: kind }, length: candidate.length };
        }
      }
    }
    if (best) return best.match;
  }
  return null;
}

/** Clean competitor form input. */
export function normalizeCompetitorInput(input: {
  name: string;
  products: string;
  websites: string;
  senders: string;
  notes: string;
  tags: string;
}): {
  name: string;
  products: string[];
  websites: string[];
  senderAddresses: string[];
  senderDomains: string[];
  notes: string | null;
  tags: string[];
} {
  const senderAddresses: string[] = [];
  const senderDomains: string[] = [];
  for (const entry of parseList(input.senders, 100)) {
    const address = normalizeAddress(entry);
    if (address) {
      if (!senderAddresses.includes(address)) senderAddresses.push(address);
      continue;
    }
    const domain = normalizeDomain(entry);
    if (domain && !senderDomains.includes(domain)) senderDomains.push(domain);
  }
  const websites = parseList(input.websites, 20)
    .map((site) => {
      const domain = normalizeDomain(site);
      if (!domain) return "";
      return /^https?:\/\//i.test(site.trim()) ? site.trim() : `https://${domain}`;
    })
    .filter(Boolean);
  return {
    name: input.name.trim().slice(0, 160),
    products: parseList(input.products, 40),
    websites,
    senderAddresses,
    senderDomains,
    notes: input.notes.trim().slice(0, 4000) || null,
    tags: parseList(input.tags, 20).map((tag) => tag.toLowerCase()),
  };
}
