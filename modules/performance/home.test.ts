import { describe, expect, it } from "vitest";
import { manifest } from "./manifest";
import {
  EXAMPLE_ORGANIZATION_ID,
  EXAMPLE_OTHER_ORGANIZATION_ID,
  formatPnl,
  formatUsd,
  importBrokerRecommendations,
  listLaunchFunnel,
  listRecommendations,
  performanceHome,
  simplePnl,
} from "./home";

const UNKNOWN_ORGANIZATION_ID = "33333333-3333-4333-8333-333333333333";

describe("performance manifest", () => {
  it("matches the module contract", () => {
    expect(manifest.id).toBe("performance");
    expect(manifest.slug).toBe("performance");
    expect(manifest.planEntitlement).toBe("performance");
    expect(manifest.routes.map((route) => route.path)).toEqual(["/performance"]);
    expect(manifest.nav.map((item) => item.href)).toEqual(["/performance"]);
    expect(manifest.permissions.map((permission) => permission.key)).toEqual([
      "performance.read",
      "performance.write",
    ]);
  });
});

describe("simplePnl", () => {
  it("computes long, short, and open recommendations", () => {
    expect(simplePnl({ direction: "long", entryPrice: 180.25, exitPrice: 198.65, quantity: 100 })).toBe(1840);
    expect(simplePnl({ direction: "short", entryPrice: 420, exitPrice: 401.5, quantity: 40 })).toBe(740);
    expect(simplePnl({ direction: "long", entryPrice: 108.4, exitPrice: 99.15, quantity: 25 })).toBe(-231.25);
    expect(simplePnl({ direction: "long", entryPrice: 875, exitPrice: null, quantity: 10 })).toBeNull();
  });
});

describe("listRecommendations", () => {
  it("returns only the requested organization", () => {
    const primary = listRecommendations(EXAMPLE_ORGANIZATION_ID);
    const other = listRecommendations(EXAMPLE_OTHER_ORGANIZATION_ID);

    expect(primary.map((row) => row.symbol)).toEqual(["AAPL", "MSFT", "NVDA"]);
    expect(other.map((row) => row.symbol)).toEqual(["XOM"]);
    expect(primary.every((row) => row.organizationId === EXAMPLE_ORGANIZATION_ID)).toBe(true);
    expect(other.every((row) => row.organizationId === EXAMPLE_OTHER_ORGANIZATION_ID)).toBe(true);
    expect(listRecommendations(UNKNOWN_ORGANIZATION_ID)).toEqual([]);
    expect(listRecommendations("")).toEqual([]);
  });

  it("uses the example seed pnl figures", () => {
    const [aapl, msft, nvda] = listRecommendations(EXAMPLE_ORGANIZATION_ID);
    expect(aapl).toMatchObject({
      direction: "long",
      openedOn: "2026-01-06",
      closedOn: "2026-02-12",
      pnl: 1840,
    });
    expect(msft).toMatchObject({ direction: "short", openedOn: "2026-03-02", closedOn: "2026-03-20", pnl: 740 });
    expect(nvda).toMatchObject({ openedOn: "2026-04-01", closedOn: null, pnl: null });
    expect(formatPnl(aapl?.pnl ?? null)).toBe("+$1,840.00");
    expect(formatPnl(listRecommendations(EXAMPLE_OTHER_ORGANIZATION_ID)[0]?.pnl ?? null)).toBe("-$231.25");
    expect(formatUsd(18420.5)).toBe("$18,420.50");
  });
});

describe("listLaunchFunnel", () => {
  it("keeps placeholder visits, opt-ins, and revenue inside the organization", () => {
    const primary = listLaunchFunnel(EXAMPLE_ORGANIZATION_ID);
    const other = listLaunchFunnel(EXAMPLE_OTHER_ORGANIZATION_ID);

    expect(primary).toMatchObject({ visits: 12840, optIns: 960, revenue: 18420.5, placeholder: true });
    expect(other).toMatchObject({ visits: 860, optIns: 40, revenue: 1260, placeholder: true });
    expect(listLaunchFunnel(UNKNOWN_ORGANIZATION_ID)).toBeNull();
    expect(primary?.organizationId).not.toBe(other?.organizationId);
  });
});

describe("performanceHome", () => {
  it("shows the stored book for that organization only", () => {
    const home = performanceHome(EXAMPLE_OTHER_ORGANIZATION_ID);
    expect(home.example).toBe(false);
    expect(home.source).toBe("example");
    expect(home.brokerImport).toBe("not_implemented");
    expect(home.recommendations.map((row) => row.symbol)).toEqual(["XOM"]);
    expect(home.recommendations[0]).toMatchObject({
      direction: "Long",
      openedOn: "2026-02-01",
      closedOn: "2026-02-28",
      pnl: "-$231.25",
    });
    expect(home.funnel).toEqual({
      visits: "860",
      optIns: "40",
      revenue: "$1,260.00",
      placeholder: true,
    });
  });

  it("projects the example book onto an organization that has no rows", () => {
    const home = performanceHome(UNKNOWN_ORGANIZATION_ID);
    expect(home.organizationId).toBe(UNKNOWN_ORGANIZATION_ID);
    expect(home.example).toBe(true);
    expect(home.recommendations.map((row) => row.symbol)).toEqual(["AAPL", "MSFT", "NVDA"]);
    expect(home.recommendations.map((row) => row.direction)).toEqual(["Long", "Short", "Long"]);
    expect(home.recommendations[2]?.closedOn).toBe("Open");
    expect(home.closedPnl).toBe("+$2,580.00");
    expect(home.funnel.visits).toBe("12,840");
    expect(listRecommendations(UNKNOWN_ORGANIZATION_ID)).toEqual([]);
  });
});

describe("importBrokerRecommendations", () => {
  it("is still a TODO", () => {
    expect(importBrokerRecommendations(EXAMPLE_ORGANIZATION_ID)).toEqual({
      status: "not_implemented",
      organizationId: EXAMPLE_ORGANIZATION_ID,
    });
  });
});
