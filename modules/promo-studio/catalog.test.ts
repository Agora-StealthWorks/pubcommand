import { describe, expect, it } from "vitest";
import { manifest } from "./manifest";
import {
  clampScore,
  exampleCatalog,
  findPromo,
  promosInPackage,
  scorePromo,
  type PromoStatus,
} from "./catalog";

describe("promo studio contract", () => {
  it("keeps the registered id, route, permissions, and plan entitlement", () => {
    expect(manifest.id).toBe("promo-studio");
    expect(manifest.slug).toBe("promo-studio");
    expect(manifest.planEntitlement).toBe("promo-studio");
    expect(manifest.nav).toEqual([{ label: "Promo Studio", href: "/promo-studio", permission: "promo.read" }]);
    expect(manifest.routes).toEqual([{ path: "/promo-studio", title: "Promo Studio" }]);
    expect(manifest.permissions.map((permission) => permission.key)).toEqual([
      "promo.read",
      "promo.write",
      "promo.approve",
    ]);
  });
});

describe("stub scorer", () => {
  const samples: readonly { name: string; status: PromoStatus }[] = [
    { name: "", status: "draft" },
    { name: "Welcome", status: "draft" },
    { name: "Spring rate lock 0.5% off", status: "approved" },
    { name: "Refer a household and earn $150", status: "in_review" },
    { name: "Q4 teaser", status: "archived" },
    { name: "A".repeat(400), status: "approved" },
  ];

  it("returns an integer from 0 to 100 and explains every point", () => {
    for (const sample of samples) {
      const score = scorePromo(sample);
      const raw = score.factors.reduce((sum, factor) => sum + factor.points, 0);
      expect(score.value).toBe(clampScore(raw));
      expect(score.value).toBeGreaterThanOrEqual(0);
      expect(score.value).toBeLessThanOrEqual(100);
      expect(Number.isInteger(score.value)).toBe(true);
      for (const factor of score.factors) {
        expect(factor.reason.trim().length).toBeGreaterThan(0);
        expect(factor.points).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("caps a specific, quantified, seasonal, approved offer at 100", () => {
    const score = scorePromo({ name: "Spring rate lock 0.5% off", status: "approved" });
    expect(score.factors.map((factor) => factor.code)).toEqual([
      "specific-name",
      "quantified-offer",
      "season",
      "approved",
    ]);
    expect(score.factors.reduce((sum, factor) => sum + factor.points, 0)).toBe(110);
    expect(score.value).toBe(100);
  });

  it("scores a short draft below a quantified review", () => {
    expect(scorePromo({ name: "Welcome", status: "draft" }).value).toBe(5);
    expect(scorePromo({ name: "Refer a household and earn $150", status: "in_review" }).value).toBe(78);
    expect(scorePromo({ name: "   ", status: "archived" }).value).toBe(0);
  });

  it("clamps non-finite and out-of-range totals", () => {
    expect(clampScore(Number.NaN)).toBe(0);
    expect(clampScore(-20)).toBe(0);
    expect(clampScore(40.2)).toBe(40);
    expect(clampScore(140)).toBe(100);
  });
});

describe("example catalog", () => {
  it("groups a few promos into one package for that organization only", () => {
    const gazette = exampleCatalog("org-gazette");
    const harbor = exampleCatalog("org-harbor");
    const bundle = gazette.packages[0];
    if (!bundle) throw new Error("expected an example package");

    expect(gazette.organizationId).toBe("org-gazette");
    expect(gazette.promos).toHaveLength(3);
    expect(gazette.packages).toHaveLength(1);
    expect(bundle.name).toBe("Q2 acquisition bundle");
    expect(promosInPackage(gazette, bundle.id).map((promo) => promo.name)).toEqual([
      "Spring rate lock 0.5% off",
      "Refer a household and earn $150",
      "Welcome",
    ]);

    for (const promo of gazette.promos) {
      expect(promo.organizationId).toBe("org-gazette");
      expect(promo.id.startsWith("org-gazette:")).toBe(true);
      expect(promo.score).toEqual(scorePromo({ name: promo.name, status: promo.status }));
    }

    expect(harbor.promos.map((promo) => promo.id)).not.toEqual(gazette.promos.map((promo) => promo.id));
    expect(findPromo("org-gazette", harbor.promos[0]?.id ?? "")).toBeNull();
    expect(findPromo("org-gazette", gazette.promos[0]?.id ?? "")?.organizationId).toBe("org-gazette");
    expect(promosInPackage(harbor, bundle.id)).toEqual([]);
  });

  it("drops a package member that belongs to another organization", () => {
    const gazette = exampleCatalog("org-gazette");
    const harbor = exampleCatalog("org-harbor");
    const bundle = gazette.packages[0];
    const foreign = harbor.promos[0];
    if (!bundle || !foreign) throw new Error("expected example records");

    const members = promosInPackage(
      {
        ...gazette,
        packages: [{ ...bundle, promoIds: [...bundle.promoIds, foreign.id] }],
      },
      bundle.id,
    );
    expect(members.map((promo) => promo.id)).not.toContain(foreign.id);
    expect(members).toHaveLength(gazette.promos.length);
  });

  it("trims the organization id and rejects a blank one", () => {
    expect(exampleCatalog("  org-gazette  ").organizationId).toBe("org-gazette");
    expect(() => exampleCatalog("   ")).toThrow(/organization id/);
  });
});
