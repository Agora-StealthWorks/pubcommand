import { trackAccess } from "@/features/trackrecord/context";
import { getPortfolio, positionViews, toStat } from "@/features/trackrecord/server";
import { formatPrice } from "../../../../../../../../../../modules/performance/gain";
import { csvCell } from "../../../../../../../../../../modules/performance/positions";
import { publicTrackRecord } from "../../../../../../../../../../modules/performance/stats";

const iso = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : "");
const pct = (value: number | null) => (value == null ? "" : value.toFixed(2));
const price = (value: number | null) => (value == null ? "" : String(value));

export async function GET(request: Request, { params }: { params: Promise<{ slug: string; portfolioId: string }> }) {
  const { slug, portfolioId } = await params;
  const access = await trackAccess("performance.read", slug);
  if (!access.ok) return new Response("Not found", { status: 404 });
  const portfolio = await getPortfolio(access.scope, portfolioId);
  if (!portfolio) return new Response("Not found", { status: 404 });
  const view = new URL(request.url).searchParams.get("view") === "public" ? "public" : "internal";
  const views = await positionViews(access.scope.organizationId, { portfolioId: portfolio.id, brandId: access.scope.brandId }, { refresh: false });
  let lines: string[];
  if (view === "public") {
    const record = publicTrackRecord(views.map(toStat), { includeOpen: portfolio.publicIncludeOpen });
    lines = [
      ["Symbol", "Name", "Direction", "Status", "Entry date", "Entry price", "Exit date", "Exit price", "Gain %", "Days held"].join(","),
      ...record.trades.map((t) =>
        [t.symbol, t.name, t.direction, t.status, t.entryDate, price(t.entryPrice), t.exitDate ?? "", price(t.exitPrice), pct(t.gainPct), t.holdDays ?? ""].map(csvCell).join(","),
      ),
    ];
  } else {
    lines = [
      ["Symbol", "Name", "Asset type", "Direction", "Status", "Entry date", "Entry price", "Stop", "Target", "Exit date", "Exit price", "Current price", "Price source", "Gain %", "Peak price", "Peak gain %", "Days held", "Split factor", "Weight", "Notes"].join(","),
      ...views.map((v) =>
        [
          v.symbol,
          v.name,
          v.assetType,
          v.direction,
          v.status,
          iso(v.entryDate),
          price(v.entryPrice),
          price(v.stopPrice),
          price(v.targetPrice),
          iso(v.exitDate),
          price(v.exitPrice),
          v.gain.current == null ? "" : formatPrice(v.gain.current).replace(/[$,]/g, ""),
          v.gain.source,
          pct(v.gain.pct),
          v.gain.peak ? v.gain.peak.price.toFixed(4) : "",
          v.gain.peak ? pct(v.gain.peak.pct) : "",
          v.days,
          v.splitFactor,
          v.weight,
          v.notes,
        ]
          .map(csvCell)
          .join(","),
      ),
    ];
  }
  const name = `${portfolio.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "portfolio"}-${view}-${iso(new Date())}.csv`;
  return new Response(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "private, no-store",
    },
  });
}
