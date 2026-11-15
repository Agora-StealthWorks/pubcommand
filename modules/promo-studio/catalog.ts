/**
 * Example promo catalog. Records are derived from the organization id and are
 * not stored.
 *
 * TODO(analyzer): Replace `scorePromo` with the real analyzer models. The stub
 * only reads the name and status so each point is explainable.
 * TODO(assembly): Assemble package files (copy, art, exports). A package here
 * only groups promo ids.
 */

export const PROMO_STATUSES = ["draft", "in_review", "approved", "archived"] as const;

export type PromoStatus = (typeof PROMO_STATUSES)[number];

export type ScoreFactor = {
  code: string;
  label: string;
  points: number;
  reason: string;
};

export type PromoScore = {
  /** Integer from 0 through 100. Factor points can sum higher and are capped. */
  value: number;
  factors: readonly ScoreFactor[];
};

export type Promo = {
  id: string;
  organizationId: string;
  name: string;
  status: PromoStatus;
  score: PromoScore;
};

export type PromoPackage = {
  id: string;
  organizationId: string;
  name: string;
  promoIds: readonly string[];
};

export type PromoCatalog = {
  organizationId: string;
  promos: readonly Promo[];
  packages: readonly PromoPackage[];
};

const SCORE_CAP = 100;

const STATUS_LABELS: Record<PromoStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  archived: "Archived",
};

type ExamplePromo = {
  key: string;
  name: string;
  status: PromoStatus;
};

const EXAMPLE_PROMOS: readonly ExamplePromo[] = [
  { key: "spring-rate-lock", name: "Spring rate lock 0.5% off", status: "approved" },
  { key: "referral-bonus", name: "Refer a household and earn $150", status: "in_review" },
  { key: "welcome", name: "Welcome", status: "draft" },
];

const EXAMPLE_PACKAGE = {
  key: "q2-acquisition",
  name: "Q2 acquisition bundle",
  promoKeys: ["spring-rate-lock", "referral-bonus", "welcome"],
} as const;

export function clampScore(points: number): number {
  if (!Number.isFinite(points)) return 0;
  return Math.max(0, Math.min(SCORE_CAP, Math.round(points)));
}

export function statusLabel(status: PromoStatus): string {
  return STATUS_LABELS[status];
}

function words(name: string): string[] {
  return name.trim().split(/\s+/).filter((word) => word.length > 0);
}

function factor(code: string, label: string, points: number, reason: string): ScoreFactor {
  return { code, label, points, reason };
}

/**
 * Stub score from 0 to 100. Each factor says why it fired. Points are added,
 * then capped. This is not an analyzer model.
 */
export function scorePromo(input: { name: string; status: PromoStatus }): PromoScore {
  const factors: ScoreFactor[] = [];
  const name = input.name.trim();
  const count = words(name).length;

  if (count >= 4) {
    factors.push(factor("specific-name", "Specific name", 30, "Four or more words read as a concrete offer."));
  } else if (count >= 2) {
    factors.push(factor("named", "Named", 15, "The name has two or three words and is still broad."));
  } else if (count === 1) {
    factors.push(factor("vague-name", "Vague name", 5, "A single word does not say what is being promoted."));
  } else {
    factors.push(factor("unnamed", "Missing name", 0, "A promo needs a name before it can score."));
  }

  if (/\d|[$%]/.test(name)) {
    factors.push(
      factor(
        "quantified-offer",
        "Quantified offer",
        40,
        "A number, dollar sign, or percent makes the offer measurable.",
      ),
    );
  }

  if (/\b(spring|summer|fall|autumn|winter|q[1-4])\b/i.test(name)) {
    factors.push(factor("season", "Season or quarter", 20, "A season or quarter gives the promo a window."));
  }

  const readiness: Record<PromoStatus, ScoreFactor> = {
    approved: factor("approved", "Approved", 20, "Approved promos can ship in a package."),
    in_review: factor("in-review", "In review", 8, "Review is underway. Approval is still open."),
    draft: factor("draft", "Draft", 0, "Drafts do not add readiness points."),
    archived: factor("archived", "Archived", 0, "Archived promos are out of the active catalog."),
  };
  factors.push(readiness[input.status]);

  const raw = factors.reduce((sum, item) => sum + item.points, 0);
  return { value: clampScore(raw), factors };
}

function organizationIdOf(organizationId: string): string {
  const id = organizationId.trim();
  if (id.length === 0) throw new Error("Promo catalog requires an organization id");
  return id;
}

function scopedId(organizationId: string, key: string): string {
  return `${organizationId}:${key}`;
}

/** Example promos and one package, scoped to a single organization. */
export function exampleCatalog(organizationId: string): PromoCatalog {
  const orgId = organizationIdOf(organizationId);
  const promos: Promo[] = EXAMPLE_PROMOS.map((example) => {
    const name = example.name;
    const status = example.status;
    return {
      id: scopedId(orgId, example.key),
      organizationId: orgId,
      name,
      status,
      score: scorePromo({ name, status }),
    };
  });

  return {
    organizationId: orgId,
    promos,
    packages: [
      {
        id: scopedId(orgId, EXAMPLE_PACKAGE.key),
        organizationId: orgId,
        name: EXAMPLE_PACKAGE.name,
        promoIds: EXAMPLE_PACKAGE.promoKeys.map((key) => scopedId(orgId, key)),
      },
    ],
  };
}

export function findPromo(organizationId: string, promoId: string): Promo | null {
  const catalog = exampleCatalog(organizationId);
  return (
    catalog.promos.find((promo) => promo.id === promoId && promo.organizationId === catalog.organizationId) ?? null
  );
}

/** Promos in a package. Ids from another organization are left out. */
export function promosInPackage(catalog: PromoCatalog, packageId: string): readonly Promo[] {
  const bundle = catalog.packages.find(
    (item) => item.id === packageId && item.organizationId === catalog.organizationId,
  );
  if (!bundle) return [];
  const byId = new Map(catalog.promos.map((promo) => [promo.id, promo]));
  return bundle.promoIds.flatMap((id) => {
    const promo = byId.get(id);
    if (!promo || promo.organizationId !== catalog.organizationId) return [];
    return [promo];
  });
}
