import { describe, expect, it } from "vitest";
import { classifySymbol, createMarket, cryptoCoin, localSymbolHits, memoryCache, rankSymbolHits, searchKey, type FetchLike } from "./index";

type Route = { match: RegExp; status?: number; body: string };
function fakeFetch(routes: Route[]) {
  const calls: string[] = [];
  const fetcher: FetchLike = async (url) => {
    calls.push(url);
    const route = routes.find((candidate) => candidate.match.test(url));
    if (!route) throw new TypeError("fetch failed");
    const status = route.status ?? 200;
    return { ok: status < 300, status, json: async () => JSON.parse(route.body), text: async () => route.body };
  };
  return { fetcher, calls };
}
const TODAY = () => "2026-11-14";

describe("crypto symbols", () => {
  it("recognises BTC-USD, X:BTCUSD and known plain pairs, not ordinary tickers", () => {
    expect(cryptoCoin("btc-usd")).toBe("BTC");
    expect(cryptoCoin("X:ETHUSD")).toBe("ETH");
    expect(cryptoCoin("SOLUSD")).toBe("SOL");
    expect(cryptoCoin("ZZZUSD")).toBeNull();
    expect(cryptoCoin("AMD")).toBeNull();
    expect(classifySymbol("ETH-USD")).toEqual({ kind: "crypto", parts: ["ETH"] });
    expect(classifySymbol("ETH-USD/GLD").kind).toBe("ratio");
  });

  it("prices crypto from Tiingo, falling back to Massive X: pairs", async () => {
    const tiingo = JSON.stringify([{ ticker: "btcusd", priceData: [{ date: "2025-01-01T00:00:00Z", open: 1, high: 2, low: 1, close: 90000 }, { date: "2025-01-02T00:00:00Z", open: 1, high: 2, low: 1, close: 95000 }] }]);
    const { fetcher, calls } = fakeFetch([{ match: /tiingo\/crypto\/prices\?tickers=btcusd/, body: tiingo }]);
    const series = await createMarket({ tiingoKey: "t", fetch: fetcher, today: TODAY }).dailyBars("BTC-USD", "2025-01-01", "2025-01-02");
    expect(series).toMatchObject({ symbol: "BTC-USD", name: "Bitcoin", source: "Tiingo", unit: "$" });
    expect(series.bars.map((bar) => bar.c)).toEqual([90000, 95000]);
    expect(calls).toHaveLength(1);

    const massiveBody = JSON.stringify({ results: [{ t: 1735689600000, o: 1, h: 1, l: 1, c: 3300 }, { t: 1735776000000, o: 1, h: 1, l: 1, c: 3400 }] });
    const m = fakeFetch([
      { match: /tiingo/, status: 500, body: "down" },
      { match: /aggs\/ticker\/X:ETHUSD\/range\/1\/day/, body: massiveBody },
    ]);
    const eth = await createMarket({ tiingoKey: "t", massiveKey: "m", fetch: m.fetcher, today: TODAY }).dailyBars("X:ETHUSD", "2025-01-01", "2025-01-02");
    expect(eth).toMatchObject({ symbol: "ETH-USD", resolved: "X:ETHUSD", source: "Massive" });
  });

  it("keeps every intraday crypto bar (24/7), not just New York hours", async () => {
    // 03:00 UTC is 22:00 New York: outside even extended hours for a stock.
    const body = JSON.stringify({ results: [{ t: Date.parse("2025-01-02T03:00:00Z"), o: 1, h: 1, l: 1, c: 10 }, { t: Date.parse("2025-01-02T04:00:00Z"), o: 1, h: 1, l: 1, c: 11 }] });
    const { fetcher } = fakeFetch([{ match: /X:BTCUSD\/range\/1\/hour/, body }]);
    const series = await createMarket({ massiveKey: "m", fetch: fetcher, today: TODAY }).intradayBars("BTC-USD", "2025-01-01", "2025-01-03", { interval: "hour" });
    expect(series.bars).toHaveLength(2);
    expect(series.warnings.join(" ")).toMatch(/around the clock/);
  });
});

describe("symbol search", () => {
  const massiveHits = JSON.stringify({
    results: [
      { ticker: "NVDA", name: "NVIDIA Corp", market: "stocks", type: "CS", primary_exchange: "XNAS" },
      { ticker: "NVDL", name: "GraniteShares 2x Long NVDA", market: "stocks", type: "ETF", primary_exchange: "XNAS" },
    ],
  });
  const tiingoHits = JSON.stringify([
    { ticker: "NVDA", name: "NVIDIA Corp", assetType: "Stock", countryCode: "US", isActive: true },
    { ticker: "NVDS", name: "Tradr NVDA Short", assetType: "ETF", countryCode: "US", isActive: true },
  ]);

  it("merges providers, dedupes, ranks the exact symbol first and caches per query", async () => {
    const { fetcher, calls } = fakeFetch([
      { match: /reference\/tickers\?search=nvidia/, body: massiveHits },
      { match: /utilities\/search\?query=nvidia/, body: tiingoHits },
      { match: /reference\/tickers\?search=NVIDIA/, body: massiveHits },
    ]);
    const cache = memoryCache();
    const market = createMarket({ massiveKey: "m", tiingoKey: "t", fetch: fetcher, cache, today: TODAY });
    const hits = await market.searchSymbols("nvidia");
    expect(hits.map((hit) => hit.symbol)).toEqual(["NVDA", "NVDL", "NVDS"]);
    expect(hits.find((hit) => hit.symbol === "NVDL")?.kind).toBe("etf");
    expect(calls).toHaveLength(2);
    // Same query, different case and spacing: answered from the cache.
    await market.searchSymbols("  NVIDIA ");
    expect(calls).toHaveLength(2);
    expect(searchKey("  NVIDIA ")).toBe(searchKey("nvidia"));
  });

  it("does not cache an outage and still returns built-in matches", async () => {
    const { fetcher, calls } = fakeFetch([{ match: /./, status: 500, body: "down" }]);
    const cache = memoryCache();
    const market = createMarket({ massiveKey: "m", fetch: fetcher, cache, today: TODAY });
    const hits = await market.searchSymbols("bitcoin");
    expect(hits[0]).toMatchObject({ symbol: "BTC-USD", kind: "crypto" });
    expect(cache.size()).toBe(0);
    await market.searchSymbols("bitcoin");
    expect(calls).toHaveLength(2);
  });

  it("answers index and crypto names without a provider", async () => {
    expect(localSymbolHits("s&p").map((hit) => hit.symbol)).toContain("SPY");
    expect(localSymbolHits("eth")[0]?.symbol).toBe("ETH-USD");
    const market = createMarket({ fetch: fakeFetch([]).fetcher, today: TODAY });
    expect((await market.searchSymbols("nasdaq")).map((hit) => hit.symbol)).toEqual(["QQQ"]);
    expect(rankSymbolHits("amd", [[{ symbol: "AMDL", name: "x", kind: "etf", exchange: "", source: "" }, { symbol: "AMD", name: "Advanced Micro", kind: "stock", exchange: "", source: "" }]])[0]?.symbol).toBe("AMD");
  });
});
