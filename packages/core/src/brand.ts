/** Brand niches. A brand is one publisher; its niche shapes AI prompts and which apps show. */
export const NICHES = ["finance", "health", "general"] as const;
export type Niche = (typeof NICHES)[number];

export const NICHE_LABELS: Record<Niche, string> = {
  finance: "Finance and investing",
  health: "Health and wellness",
  general: "General / other",
};

const DEFAULT_AUDIENCE: Record<Niche, string> = {
  finance:
    "Self-directed investors, mostly aged 50 to 75, financially literate but not professional traders, skeptical of hype.",
  health:
    "Health-conscious adults, mostly aged 45 to 75, looking for natural ways to feel better, skeptical of miracle claims.",
  general: "Engaged newsletter readers who are skeptical of hype and short on time.",
};

const COMPLIANCE_RULES: Record<Niche, string[]> = {
  finance: [
    "No guaranteed returns or risk-free claims.",
    "No invented prices, gains or performance figures; numbers must come from data.",
    "No lists of losing recommendations in public track records, and no cherry-picked results presented as typical.",
    "Past performance must not be presented as a promise of future results.",
  ],
  health: [
    "No claims that a product diagnoses, treats, cures or prevents any disease.",
    "No guaranteed results; testimonials need a results-not-typical disclosure.",
    "Every health claim must be substantiated; no invented studies, doctors or statistics.",
    "No telling readers to stop prescribed medication or replace medical care.",
  ],
  general: [
    "No guaranteed results.",
    "Every factual claim must be substantiated; no invented statistics, studies or testimonials.",
  ],
};

export function isNiche(value: unknown): value is Niche {
  return typeof value === "string" && (NICHES as readonly string[]).includes(value);
}

export type BrandProfile = {
  name: string;
  niche: Niche;
  audience: string;
  complianceRules: string[];
};

/** The brand facts every AI prompt and claims check uses. */
export function brandProfile(brand: {
  name: string;
  niche?: string | null;
  audience?: string | null;
  complianceNotes?: string | null;
}): BrandProfile {
  const niche = isNiche(brand.niche) ? brand.niche : "general";
  const extra = (brand.complianceNotes ?? "")
    .split("\n")
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean);
  return {
    name: brand.name,
    niche,
    audience: brand.audience?.trim() || DEFAULT_AUDIENCE[niche],
    complianceRules: [...COMPLIANCE_RULES[niche], ...extra],
  };
}

/** A short block to put in a prompt's user message. */
export function brandPromptContext(profile: BrandProfile): string {
  return [
    `Brand: ${profile.name} (${NICHE_LABELS[profile.niche]})`,
    `Reader: ${profile.audience}`,
    "Compliance rules:",
    ...profile.complianceRules.map((rule) => `- ${rule}`),
  ].join("\n");
}
