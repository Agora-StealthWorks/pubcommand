import { apiError, apiJson, withApi } from "@/features/charts/api";
import { searchSymbols } from "@/features/charts/market";

export const dynamic = "force-dynamic";

/** Symbol search (cached a day per query). */
export const GET = withApi("charts.search", async (_ctx, request) => {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (!q) return apiError(400, "Add ?q=, for example ?q=nvidia.", "q");
  if (q.length > 40) return apiError(400, "q is 40 characters at most.", "q");
  return apiJson(200, { query: q, results: await searchSymbols(q) });
});
