/** Which ISpy feeds an organization sees: by brand niche, with a staff override. */
import { FEEDS, type Feed } from "./types";

/** finance → FinPub, health → Health, general → FinPub. */
export function feedForNiche(niche: string | null | undefined): Feed {
  return (niche ?? "").toLowerCase() === "health" ? "HEALTH" : "FINPUB";
}

export type FeedOverride = { feed: string; mode: string };

/** The feeds an org may read: its brands' niches, plus ALLOWED overrides, minus BLOCKED ones. */
export function feedsForOrg(brandNiches: readonly (string | null | undefined)[], overrides: readonly FeedOverride[]): Feed[] {
  const set = new Set<Feed>(brandNiches.length ? brandNiches.map(feedForNiche) : ["FINPUB"]);
  for (const o of overrides) {
    if (!(FEEDS as readonly string[]).includes(o.feed)) continue;
    if (o.mode === "ALLOWED") set.add(o.feed as Feed);
    if (o.mode === "BLOCKED") set.delete(o.feed as Feed);
  }
  return FEEDS.filter((f) => set.has(f));
}

/** How a feed reaches an org, for the console's Access page. */
export function feedAccessState(feed: Feed, brandNiches: readonly (string | null | undefined)[], overrides: readonly FeedOverride[]): "niche" | "granted" | "blocked" | "off" {
  const o = overrides.find((x) => x.feed === feed);
  if (o?.mode === "BLOCKED") return "blocked";
  if (o?.mode === "ALLOWED") return "granted";
  const byNiche = (brandNiches.length ? brandNiches.map(feedForNiche) : ["FINPUB"]).includes(feed);
  return byNiche ? "niche" : "off";
}

/**
 * For one org, an email is Internal when it came from a publication or publisher linked
 * to that org, Affiliate when the mailer is an affiliate file, else External.
 * A publisher hidden from other orgs is invisible to everyone but its own org.
 */
export function kindForViewer(
  email: { sendKind: string; publisherLinkedOrgId: string | null; publicationLinkedOrgId: string | null },
  viewerOrgId: string,
): "INTERNAL" | "EXTERNAL" | "AFFILIATE" {
  if (email.sendKind === "AFFILIATE") return "AFFILIATE";
  if (email.publicationLinkedOrgId === viewerOrgId || email.publisherLinkedOrgId === viewerOrgId) return "INTERNAL";
  return "EXTERNAL";
}
