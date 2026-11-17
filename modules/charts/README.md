# ChartBuilder (`charts`)

Route: `/charts` on the organization host. Simple, good-looking stock charts for promos, social and
publications (not a trading tool). Pick a ticker, period and timeframe, a Promo or Publication template and
a size; add a headline, text, callouts, arrows, dots and images and drag them into place; download PNG,
JPG, SVG or PDF.

## Rules
1. **One renderer.** `render.ts` turns `(ChartSpec, bars)` into SVG and is pure. The editor preview,
   saved-chart thumbnails and every export call it. Text is measured from `font-metrics.ts` (generated from
   the bundled Inter files in `fonts/`), so the browser and the server lay out text identically. The
   server rasterizes the same SVG with resvg using only those fonts.
2. **`spec.ts` is the contract.** `normalizeSpec()` is the only way untrusted JSON becomes a `ChartSpec`
   (clamped numbers, safe colors, escaped text). Templates store a `StyleSpec`; sizes are design units
   scaled to the canvas (`scaleFactor`), so one template works at every social size.
3. **Numbers come from data, never from the AI.** `tokens.ts` resolves `{gain}`, `{gainRounded}` (rounded
   DOWN to 2 significant figures), `{start}`, `{end}`, `{cagr}` (a year or more), `{span}`, `{ticker}`,
   `{name}` from the closes drawn. A person may type a figure over the headline; the editor keeps showing
   "Data says", the save marks `headline_overridden`, and the Brain note records both.
4. **The server re-fetches the data on save** and stores the exact bars drawn (`charts.bars`), so every
   figure is traceable and downloads are reproducible.
5. **Market data** comes from `@pubcommand/market` (Massive → Tiingo → FRED, A/B ratios, CSV; no Yahoo),
   cached in `market_cache`.
6. Starter templates are seeded **create-only** by slug on first visit; the team owns them afterwards.
   Deletes of charts and projects are soft.

## Permissions
`charts.read` (seeded for editors) makes, saves, exports and organizes charts. `charts.write` also deletes
locked starter templates and anyone's projects.

## Pages
- `/charts` editor (`?chart=<id>` reopens, `?template=<id>` starts from a template)
- `/charts/projects`, `/charts/projects/<id>` (ZIP of all charts)
- `/charts/bulk`, `/charts/bulk/<batchId>` (up to 100 rows, 4 at a time, ZIP, save to project)
- `/charts/templates`
- `/charts/c/<id>/export?format=png|jpg|svg|pdf`

## Env
`MASSIVE_API_KEY` (optional `MASSIVE_BASE_URL`), `TIINGO_API_KEY`. FRED needs no key. Without keys the
editor says so and works with FRED series and pasted CSV.
