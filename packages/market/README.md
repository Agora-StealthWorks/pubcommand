# @pubcommand/market

Market data for any PubCommand app (ChartBuilder today, Track Record next). No DB, no Next.js: callers
inject `fetch` (optional) and a cache.

```ts
import { createMarket } from "@pubcommand/market";

const market = createMarket({ massiveKey: process.env.MASSIVE_API_KEY, tiingoKey: process.env.TIINGO_API_KEY, cache });
const series = await market.dailyBars("AMD", "2020-01-01", "2026-11-14");          // split-only by default
const ratio = await market.dailyBars("CPER/GLD", from, to);                         // A/B ratio
const macro = await market.dailyBars("FRED:PCOPPUSDM", from, to);                   // FRED, no key
const hourly = await market.intradayBars("NVDA", from, to, { interval: "hour" });
const last = await market.quote("MSFT");
const btc = await market.dailyBars("BTC-USD", from, to);                          // crypto (Tiingo, then Massive X:BTCUSD)
const hits = await market.searchSymbols("nvidia");                                // symbol search, cached a day per query
```

## Routing
- `FRED:<id>`: FRED's public `fredgraph.csv` (no key).
- `A/B`: two series, divided on common dates.
- Index symbols (`SPX`, `NDX`, `DJI`, `RUT`, ...) chart their ETF (`SPY`, `QQQ`, `DIA`, `IWM`) with a warning.
- Tickers: **Massive** first when the range fits its ~10-year window; **Tiingo** when the range is older, when
  dividends are requested (`adjust: "total"`), or when Massive fails.
- Crypto (`BTC-USD`, `X:BTCUSD`, `BTCUSD` for known coins): Tiingo crypto first, Massive `X:` pairs second.
  Intraday crypto keeps every bar (24/7).
- `intradayBars(..., { extended: true })` adds pre-market and after-hours (4:00-20:00 New York).
- No Yahoo.
- CSV paste/upload: `parseBarsCsv(text)`.

## Adjustment
Tiingo prices are rebuilt **split-only** from `close` and `splitFactor` (`splitOnly()`), so old prices match what
the quote was after splits but without dividends. `adjust: "total"` uses `adjClose` and adds a warning.

## Errors
Everything throws `MarketError` with `code`: `unconfigured` (no key), `unavailable` (host down/blocked, 5xx),
`not_entitled`, `not_found`, `bad_request`. Show `error.message` to people; it is written for them.
