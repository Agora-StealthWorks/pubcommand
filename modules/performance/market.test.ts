import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// The shared market package, wired with a fake fetch and its own fixtures (no network, no keys).
import { MarketError, createMarket, type FetchLike } from "../../packages/market/src/index";
import { bestClose, computeGain, inferSplitFactor } from "./gain";

const fixture = (name: string) => readFileSync(new URL(`../../packages/market/src/fixtures/${name}`, import.meta.url), "utf8");

function fakeFetch(routes: { match: RegExp; body: string }[]): FetchLike {
  return async (url) => {
    const route = routes.find((candidate) => candidate.match.test(url));
    if (!route) throw new TypeError("fetch failed");
    return { ok: true, status: 200, json: async () => JSON.parse(route.body), text: async () => route.body };
  };
}

const TODAY = () => "2026-11-14";

describe("gain engine on market data", () => {
  it("detects AAPL's 4-for-1 split from split-only bars and measures in the entry's basis", async () => {
    const market = createMarket({ tiingoKey: "t", fetch: fakeFetch([{ match: /api\.tiingo\.com\/tiingo\/daily\/AAPL\/prices/, body: fixture("tiingo-split.json") }]), today: TODAY });
    const series = await market.dailyBars("AAPL", "2020-08-27", "2020-09-01");
    // Recommended at $500 the week before the split (as published then).
    const entryPrice = 500;
    const factor = inferSplitFactor(entryPrice, series.bars[0]!.c);
    expect(factor).toBe(4);
    const peak = bestClose("LONG", series.bars);
    const last = series.bars.at(-1)!;
    const gain = computeGain({
      basis: "TODAY",
      direction: "LONG",
      entryPrice,
      splitFactor: factor,
      quote: { price: last.c, at: new Date(last.t) },
      marketPeak: peak,
    });
    expect(gain.current).toBeCloseTo(134.18 * 4, 6);
    expect(gain.pct).toBeCloseTo((134.18 * 4) / 500 * 100 - 100, 6);
    expect(gain.splitNote).toMatch(/4-for-1/);
    // Without the split factor the same data would read as a -73% loss.
    expect(computeGain({ basis: "TODAY", direction: "LONG", entryPrice, quote: { price: last.c, at: null } }).pct).toBeLessThan(-70);
  });

  it("falls back to the stored price, flagged, when no market key is set", async () => {
    const market = createMarket({ fetch: fakeFetch([]), today: TODAY });
    let quote: { price: number; at: Date } | null = null;
    try {
      const live = await market.quote("NVDA");
      quote = { price: live.price, at: new Date(live.at) };
    } catch (error) {
      expect(error).toBeInstanceOf(MarketError);
      expect((error as MarketError).code).toBe("unconfigured");
    }
    const gain = computeGain({ basis: "TODAY", direction: "LONG", entryPrice: 875, quote, recorded: { price: 910, at: new Date("2026-11-01T00:00:00Z") } });
    expect(gain.source).toBe("recorded");
    expect(gain.stale).toBe(true);
    expect(gain.pct).toBeCloseTo(4, 6);
  });
});
