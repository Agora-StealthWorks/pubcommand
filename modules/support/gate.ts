/**
 * The forbidden-content gate. Support Knowledge is what customer-facing agents may say,
 * so anything stored can eventually be read to a customer. Every save that would make a
 * record visible to an agent (published) runs through checkContent(); a hit blocks it.
 *
 * Conservative by design: a false positive costs an editor one edit, a false negative
 * leaks internal material to customers. Two rules can be confirmed by a person with
 * support.publish (a discount that is genuinely on the public website, a page that
 * names another company); the rest can never be overridden.
 */

export type GateRule = {
  id: string;
  label: string;
  /** A person with support.publish may confirm this is fine for customers. */
  overridable: boolean;
  test: RegExp;
};

export const GATE_RULES: readonly GateRule[] = [
  { id: "internal-marker", label: "Marked internal or confidential", overridable: false, test: /\b(internal[\s_-]*(only|use)|confidential|not\s+for\s+(distribution|customers|public)|do\s+not\s+(share|forward|distribute)|staff[\s-]+only|for\s+internal\s+eyes)\b/i },
  { id: "promo-analysis", label: "Promo or copy analysis", overridable: false, test: /\b(big[\s_-]*idea|lead\s+type|hook\s+analysis|copy\s+(analysis|critique|score)|headline\s+test|split[\s-]+test|a\/b\s+test|swipe\s+file)\b/i },
  { id: "performance-tier", label: "Promo performance tier", overridable: false, test: /\b((winning|losing|control|under-?performing|top-?performing|best-?performing)\s+(promo|promotion|campaign|package|control)|performance\s+tier|tier\s+[a-d1-4]\s+promo)\b/i },
  { id: "marketing-metrics", label: "Marketing metrics", overridable: false, test: /\b(conversion\s+rate|click[\s-]*through\s+rate|open\s+rate|ctr|epc|epm|roas|cpa|cac|ltv|aov|cost\s+per\s+(lead|acquisition|order)|revenue\s+per\s+(send|thousand|m))\b/i },
  { id: "marketing-tactics", label: "Marketing tactics", overridable: false, test: /\b(funnel|upsell|down-?sell|cross-?sell|back[\s-]?end\s+offer|front[\s-]?end\s+offer|list\s+(build|rental|swap)|lead\s+magnet|retargeting|segment(ation)?\s+strategy)\b/i },
  { id: "copywriter", label: "Names the copywriter", overridable: false, test: /\b(copywriter|copy\s+chief|written\s+by\s+our\s+copy)/i },
  { id: "competitor", label: "Competitor intelligence", overridable: true, test: /\bcompetitor(s|'s)?\b|\bcompetitive\s+(intel|analysis|landscape)\b/i },
  { id: "discount", label: "Discount or promo code (retail list prices only)", overridable: true, test: /\b(discount(ed)?|coupon|promo(tional)?\s+code|offer\s+code|\d{1,2}\s?%\s+off|percent\s+off|half\s+off|special\s+price|employee\s+price|vip\s+price)\b/i },
  { id: "sensitive-number", label: "Card or ID number", overridable: false, test: /\b(?:\d[ -]?){13,19}\b|\b\d{3}-\d{2}-\d{4}\b/ },
  { id: "secret", label: "Password or API key", overridable: false, test: /\b(password|passcode|api[\s_-]?key|secret[\s_-]?key)\s*[:=]\s*\S+|\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}|\bxi-api-key\b/i },
];

export type GateHit = { id: string; label: string; overridable: boolean; match: string };

export type GateResult = {
  /** True when nothing blocks publishing (after confirmed overrides). */
  ok: boolean;
  hits: GateHit[];
  /** Hits that still block (not overridable, or not confirmed). */
  blocking: GateHit[];
};

/** Run every rule over the text. `overrides` are rule ids a publisher confirmed for this record. */
export function checkContent(text: string, overrides: readonly string[] = []): GateResult {
  const hits: GateHit[] = [];
  for (const rule of GATE_RULES) {
    const found = rule.test.exec(text);
    if (found) hits.push({ id: rule.id, label: rule.label, overridable: rule.overridable, match: found[0].slice(0, 60) });
  }
  const confirmed = new Set(overrides);
  const blocking = hits.filter((hit) => !(hit.overridable && confirmed.has(hit.id)));
  return { ok: blocking.length === 0, hits, blocking };
}

/** Only overridable rule ids survive; anything else a form sends is dropped. */
export function cleanOverrides(input: readonly unknown[]): string[] {
  const allowed = new Set(GATE_RULES.filter((rule) => rule.overridable).map((rule) => rule.id));
  return [...new Set(input.filter((value): value is string => typeof value === "string" && allowed.has(value)))];
}

/** One sentence for the editor: why this cannot be published yet. */
export function gateMessage(result: GateResult): string {
  if (result.ok) return "";
  return `This cannot reach customers yet: ${result.blocking.map((hit) => `${hit.label} (“${hit.match}”)`).join("; ")}. Remove it or keep the record as a draft.`;
}
