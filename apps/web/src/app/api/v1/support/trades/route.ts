import { agentJson, withAgent } from "@/features/support/agent-api";
import { lookupTrades } from "@/features/support/trades";
import { tradesAllowed } from "../../../../../../../../modules/support/scope";

export const dynamic = "force-dynamic";

/** lookup_trades: closed trades from Track Record. Finance brands, member agents with the trades category only. */
const handler = withAgent("lookup_trades", async (ctx, params) => {
  ctx.query = [params.ticker, params.publication, params.from, params.to].filter(Boolean).join(" | ");
  if (!tradesAllowed(ctx.scope, ctx.brand.niche)) return agentJson(403, { error: "This agent cannot read the track record." });
  if (!ctx.entitled.includes("performance")) return agentJson(404, { error: "Track Record is not turned on for this organization." });
  const result = await lookupTrades(ctx.organizationId, ctx.brandId, { ticker: params.ticker, publication: params.publication, from: params.from, to: params.to, q: params.q });
  if (!result.ok) return agentJson(400, { found: false, message: result.message });
  ctx.hits = result.trades.length;
  return agentJson(200, {
    found: result.trades.length > 0,
    trades: result.trades,
    note: "Closed trades from the official track record. Past results do not guarantee future results. This is not advice.",
  });
});

export const GET = handler;
export const POST = handler;
