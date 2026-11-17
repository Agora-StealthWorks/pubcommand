import { brandProfile } from "@pubcommand/core";
import { appendOrgAudit, resolveOrgBySlug, tenantDb, type Prisma } from "@pubcommand/db";
import { teachBrain } from "@/features/brain/teach";
import { computeGain, holdDays, positionBasis, type Direction, type Gain, type GainBasis } from "../../../../../modules/performance/gain";
import { computeStats, publicTrackRecord, weeklySummary, type PortfolioStats, type StatPosition } from "../../../../../modules/performance/stats";
import { widgetPayload } from "../../../../../modules/performance/widget";
import { historyDue, loadHistory, loadQuotes, type StoredQuote } from "./prices";
import type { TrackScope } from "./context";

type Db = ReturnType<typeof tenantDb>;
export type PositionRow = Awaited<ReturnType<Db["trackPosition"]["findMany"]>>[number];
export type PortfolioRow = Awaited<ReturnType<Db["trackPortfolio"]["findMany"]>>[number];
export type CallRow = Awaited<ReturnType<Db["trackCall"]["findMany"]>>[number];

export type LegRow = Awaited<ReturnType<Db["trackLeg"]["findMany"]>>[number];
export type FillRow = Awaited<ReturnType<Db["trackFill"]["findMany"]>>[number];

export type PositionView = PositionRow & { gain: Gain; days: number; quote: StoredQuote | null; legs: LegRow[]; fills: FillRow[] };

/** Scope for server work: a job has no signed-in actor. */
export type TrackWorkScope = { organizationId: string; brandId: string; actorId: string | null };

const dir = (value: string): Direction => (value === "SHORT" ? "SHORT" : "LONG");

/** The gain for one stored position. The single call site that feeds computeGain() for positions. */
export function positionGain(position: PositionRow, quote: StoredQuote | null, legs: readonly LegRow[] = [], fills: readonly FillRow[] = [], quotes: ReadonlyMap<string, StoredQuote> = new Map()): Gain {
  const status = position.status === "CLOSED" ? "CLOSED" : "OPEN";
  const legInput = fills.length
    ? {
        specs: legs.map((leg) => ({
          id: leg.id,
          legIndex: leg.legIndex,
          side: (leg.side === "SELL" ? "SELL" : "BUY") as "BUY" | "SELL",
          ratio: leg.ratio,
          multiplier: leg.multiplier,
          kind: (leg.kind === "OPTION" ? "OPTION" : "STOCK") as "STOCK" | "OPTION",
        })),
        fills: fills.map((f) => ({ id: f.id, legId: f.legId, intent: (f.intent === "CLOSE" ? "CLOSE" : "OPEN") as "OPEN" | "CLOSE", quantity: f.quantity, price: f.price, multiplier: f.multiplier, executedAt: f.executedAt, createdAt: f.createdAt })),
        marks: new Map(
          legs.map((leg) => {
            const q = leg.priceSymbol ? quotes.get(leg.priceSymbol) : undefined;
            return [leg.id, q ? { price: q.price, at: q.at, stale: q.stale } : null] as const;
          }),
        ),
      }
    : null;
  return computeGain({
    legs: legInput,
    basis: positionBasis(status),
    direction: dir(position.direction),
    entryPrice: position.entryPrice,
    exitPrice: status === "CLOSED" ? position.exitPrice : null,
    exitDate: position.exitDate,
    splitFactor: position.splitFactor,
    quote: quote ? { price: quote.price, at: quote.at, stale: quote.stale } : null,
    recorded: position.recordedPrice ? { price: position.recordedPrice, at: position.recordedAt } : null,
    marketPeak: position.peakPrice ? { price: position.peakPrice, at: position.peakDate } : null,
  });
}

export function toStat(view: PositionView): StatPosition {
  return {
    id: view.id,
    symbol: view.symbol,
    name: view.name,
    direction: dir(view.direction),
    status: view.status === "CLOSED" ? "CLOSED" : "OPEN",
    entryDate: view.entryDate,
    exitDate: view.exitDate,
    entryPrice: view.entryPrice,
    exitPrice: view.exitPrice,
    gainPct: view.gain.pct,
    holdDays: view.days,
    weight: view.weight,
    stale: view.gain.stale,
  };
}

export async function listPortfolios(scope: Pick<TrackScope, "organizationId" | "brandId">): Promise<PortfolioRow[]> {
  return tenantDb(scope.organizationId).trackPortfolio.findMany({
    where: { brandId: scope.brandId, deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function getPortfolio(scope: Pick<TrackScope, "organizationId" | "brandId">, portfolioId: string): Promise<PortfolioRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(portfolioId)) return null;
  return tenantDb(scope.organizationId).trackPortfolio.findFirst({ where: { id: portfolioId, brandId: scope.brandId, deletedAt: null } });
}

/** Legs and active fills for positions tracked by fills, grouped by position id. */
export async function legsFor(organizationId: string, positionIds: readonly string[]): Promise<{ legs: Map<string, LegRow[]>; fills: Map<string, FillRow[]> }> {
  const legs = new Map<string, LegRow[]>();
  const fills = new Map<string, FillRow[]>();
  if (!positionIds.length) return { legs, fills };
  const db = tenantDb(organizationId);
  const [legRows, fillRows] = await Promise.all([
    db.trackLeg.findMany({ where: { positionId: { in: [...positionIds] } }, orderBy: { legIndex: "asc" } }),
    db.trackFill.findMany({ where: { positionId: { in: [...positionIds] }, deletedAt: null }, orderBy: [{ executedAt: "asc" }, { createdAt: "asc" }] }),
  ]);
  for (const leg of legRows) legs.set(leg.positionId, [...(legs.get(leg.positionId) ?? []), leg]);
  for (const fill of fillRows) fills.set(fill.positionId, [...(fills.get(fill.positionId) ?? []), fill]);
  return { legs, fills };
}

/** Positions with their gains. `refresh` fetches quotes older than 10 minutes (open positions only). */
export async function positionViews(organizationId: string, where: { portfolioId?: string; brandId: string; id?: string }, options: { refresh?: boolean } = {}): Promise<PositionView[]> {
  const rows = await tenantDb(organizationId).trackPosition.findMany({
    where: { ...where, deletedAt: null },
    orderBy: [{ entryDate: "desc" }, { symbol: "asc" }],
  });
  const { legs, fills } = await legsFor(organizationId, rows.filter((row) => row.fillCount > 0).map((row) => row.id));
  const openRows = rows.filter((row) => row.status !== "CLOSED");
  const openSymbols = [
    ...openRows.filter((row) => row.priceSymbol).map((row) => row.priceSymbol as string),
    ...openRows.flatMap((row) => (legs.get(row.id) ?? []).map((leg) => leg.priceSymbol).filter((symbol): symbol is string => !!symbol)),
  ];
  const quotes = await loadQuotes(organizationId, openSymbols, { refresh: options.refresh });
  const today = new Date();
  return rows.map((row) => {
    const quote = row.status !== "CLOSED" && row.priceSymbol ? (quotes.get(row.priceSymbol) ?? null) : null;
    const myLegs = legs.get(row.id) ?? [];
    const myFills = fills.get(row.id) ?? [];
    return { ...row, quote, legs: myLegs, fills: myFills, gain: positionGain(row, quote, myLegs, myFills, quotes), days: holdDays(row.entryDate, row.exitDate ?? today) };
  });
}

export type PortfolioSummary = { portfolio: PortfolioRow; stats: PortfolioStats; staleCount: number };

export async function portfolioSummaries(scope: Pick<TrackScope, "organizationId" | "brandId">): Promise<PortfolioSummary[]> {
  const portfolios = await listPortfolios(scope);
  const views = await positionViews(scope.organizationId, { brandId: scope.brandId }, { refresh: true });
  return portfolios.map((portfolio) => {
    const mine = views.filter((view) => view.portfolioId === portfolio.id);
    return { portfolio, stats: computeStats(mine.map(toStat)), staleCount: mine.filter((view) => view.status !== "CLOSED" && view.gain.stale).length };
  });
}

/** Refresh peak and split data for positions that are due (or `force`). Writes to each position. */
export async function refreshPositionHistory(organizationId: string, positions: readonly PositionRow[], options: { force?: boolean } = {}): Promise<{ updated: number; errors: string[] }> {
  const db = tenantDb(organizationId);
  const errors: string[] = [];
  let updated = 0;
  for (const position of positions) {
    const closed = position.status === "CLOSED";
    if (!position.priceSymbol || (!options.force && !historyDue(position.peakCheckedAt, closed))) continue;
    const result = await loadHistory({
      priceSymbol: position.priceSymbol,
      direction: dir(position.direction),
      entryDate: position.entryDate,
      entryPrice: position.entryPrice,
      endDate: closed ? position.exitDate : null,
      splitSource: position.splitSource,
      detectSplits: position.assetType !== "OPTION",
    });
    if (!result.ok) {
      errors.push(`${position.symbol}: ${result.error}`);
      continue;
    }
    await db.trackPosition.updateMany({
      where: { id: position.id },
      data: {
        peakPrice: result.peakPrice,
        peakDate: result.peakDate,
        peakCheckedAt: new Date(),
        ...(result.split ? { splitFactor: result.split.factor, splitSource: result.split.source } : {}),
      },
    });
    updated += 1;
  }
  return { updated, errors };
}

/** Teach the brand Brain this week's aggregate note for one portfolio. sourceRef trackrecord:<portfolioId>:<week>. */
export async function teachWeeklySummary(scope: TrackWorkScope, portfolioId: string): Promise<string | null> {
  const portfolio = await getPortfolio(scope, portfolioId);
  if (!portfolio) return null;
  const views = await positionViews(scope.organizationId, { portfolioId, brandId: scope.brandId }, { refresh: false });
  const note = weeklySummary({ portfolioName: portfolio.name, publication: portfolio.publication, positions: views.map(toStat), today: new Date() });
  await teachBrain({
    organizationId: scope.organizationId,
    brandId: scope.brandId,
    sourceRef: `trackrecord:${portfolio.id}:${note.week}`,
    title: note.title,
    body: note.body,
    folder: "Track Record",
    source: "trackrecord",
    actorId: scope.actorId,
  });
  return note.week;
}

/** After a change: refresh history for the touched positions, then re-teach the weekly note. Soft-fails. */
export async function afterPositionsChanged(scope: TrackWorkScope, portfolioIds: readonly string[], positionIds: readonly string[]) {
  try {
    if (positionIds.length) {
      const rows = await tenantDb(scope.organizationId).trackPosition.findMany({ where: { id: { in: [...positionIds] }, deletedAt: null } });
      await refreshPositionHistory(scope.organizationId, rows, { force: true });
    }
    for (const portfolioId of new Set(portfolioIds)) await teachWeeklySummary(scope, portfolioId);
  } catch (error) {
    console.error("[trackrecord] after change failed", error);
  }
}

// ----------------------------------------------------------------------------- call archive

export type CallView = CallRow & { gain: Gain; expertName: string };

export function callGain(call: CallRow, quote: StoredQuote | null): Gain {
  return computeGain({
    basis: (["TODAY", "PEAK", "EXIT", "NONE"].includes(call.gainBasis) ? call.gainBasis : "TODAY") as GainBasis,
    direction: dir(call.direction),
    entryPrice: call.entryPrice,
    exitPrice: call.exitPrice,
    exitDate: call.exitDate,
    splitFactor: call.splitFactor,
    quote: quote ? { price: quote.price, at: quote.at, stale: quote.stale } : null,
    recorded: call.recordedPrice ? { price: call.recordedPrice, at: call.recordedAt } : null,
    marketPeak: call.marketPeak ? { price: call.marketPeak, at: call.marketPeakAt } : null,
    recordedPeak: call.recordedPeak ? { price: call.recordedPeak, at: call.recordedPeakAt } : null,
  });
}

export async function callViews(organizationId: string, rows: readonly (CallRow & { expert?: { name: string } })[], options: { refresh?: boolean } = {}): Promise<CallView[]> {
  const symbols = rows.filter((row) => row.priceSymbol && row.gainBasis !== "EXIT" && row.gainBasis !== "NONE").map((row) => row.priceSymbol as string);
  const quotes = await loadQuotes(organizationId, symbols, { refresh: options.refresh });
  return rows.map((row) => {
    const quote = row.priceSymbol ? (quotes.get(row.priceSymbol) ?? null) : null;
    return { ...row, expertName: row.expert?.name ?? "", gain: callGain(row, row.gainBasis === "EXIT" ? null : quote) };
  });
}

export async function refreshCallHistory(organizationId: string, calls: readonly CallRow[], options: { force?: boolean } = {}): Promise<string[]> {
  const db = tenantDb(organizationId);
  const errors: string[] = [];
  for (const call of calls) {
    if (!call.priceSymbol || !call.callDate || !call.entryPrice || call.gainBasis === "NONE") continue;
    if (!options.force && !historyDue(call.peakCheckedAt, call.gainBasis === "EXIT")) continue;
    const result = await loadHistory({
      priceSymbol: call.priceSymbol,
      direction: dir(call.direction),
      entryDate: call.callDate,
      entryPrice: call.entryPrice,
      endDate: call.gainBasis === "EXIT" ? call.exitDate : null,
      splitSource: call.splitSource,
      detectSplits: !call.priceSymbol.startsWith("O:"),
    });
    if (!result.ok) {
      errors.push(`${call.ticker ?? call.title}: ${result.error}`);
      continue;
    }
    await db.trackCall.updateMany({
      where: { id: call.id },
      data: {
        marketPeak: result.peakPrice,
        marketPeakAt: result.peakDate,
        peakCheckedAt: new Date(),
        ...(result.split ? { splitFactor: result.split.factor, splitSource: result.split.source } : {}),
      },
    });
  }
  return errors;
}

export async function auditTrack(scope: Pick<TrackWorkScope, "organizationId" | "actorId">, action: string, targetType: string, targetId: string, metadata?: Prisma.InputJsonValue) {
  await appendOrgAudit(scope.organizationId, { actorId: scope.actorId, action, targetType, targetId, ...(metadata ? { metadata } : {}) });
}

// ----------------------------------------------------------------------------- public link

/**
 * The portfolio behind a public link. The organization comes from the host the link was opened on, so a token
 * only works on its own organization. Returns null for anything turned off, deleted or not a finance brand.
 */
export async function publicPortfolio(slug: string, token: string) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  const org = await resolveOrgBySlug(slug);
  if (!org || org.suspendedAt || org.redirected) return null;
  const db = tenantDb(org.id);
  const portfolio = await db.trackPortfolio.findFirst({ where: { publicToken: token, publicEnabled: true, deletedAt: null } });
  if (!portfolio) return null;
  const brand = await db.brand.findFirst({ where: { id: portfolio.brandId } });
  if (!brand || brandProfile(brand).niche !== "finance") return null;
  const views = await positionViews(org.id, { portfolioId: portfolio.id, brandId: portfolio.brandId }, { refresh: portfolio.publicIncludeOpen });
  return { portfolio, brandName: brand.name, record: publicTrackRecord(views.map(toStat), { includeOpen: portfolio.publicIncludeOpen }) };
}

/**
 * The portfolio behind an embeddable widget token, as a public-safe payload. Same org-from-host rule as the
 * public link. Null for anything turned off, deleted or not a finance brand.
 */
export async function widgetData(slug: string, token: string, limit: number) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  const org = await resolveOrgBySlug(slug);
  if (!org || org.suspendedAt || org.redirected) return null;
  const db = tenantDb(org.id);
  const portfolio = await db.trackPortfolio.findFirst({ where: { widgetToken: token, widgetEnabled: true, deletedAt: null } });
  if (!portfolio) return null;
  const brand = await db.brand.findFirst({ where: { id: portfolio.brandId } });
  if (!brand || brandProfile(brand).niche !== "finance") return null;
  const views = await positionViews(org.id, { portfolioId: portfolio.id, brandId: portfolio.brandId }, { refresh: portfolio.widgetIncludeOpen });
  const record = publicTrackRecord(views.map(toStat), { includeOpen: portfolio.widgetIncludeOpen });
  return widgetPayload(record, { portfolio: portfolio.name, publication: portfolio.publication, brand: brand.name, asOf: new Date(), limit });
}
