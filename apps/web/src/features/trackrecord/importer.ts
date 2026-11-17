import { randomBytes } from "node:crypto";
import { tenantDb } from "@pubcommand/db";
import { planImportTable, type ImportPlan } from "../../../../../modules/performance/positions";
import { getEditors } from "@/features/pubsetup/read";
import { closeWithFill } from "./fills";
import { auditTrack, listPortfolios, type TrackWorkScope } from "./server";

/** The dry run for rows already split into cells. Writes nothing. */
export async function planTable(scope: TrackWorkScope, table: string[][], defaultPortfolio: string): Promise<ImportPlan> {
  const portfolios = await listPortfolios(scope);
  const names = new Map(portfolios.map((p) => [p.id, p.name]));
  const existing = await tenantDb(scope.organizationId).trackPosition.findMany({
    where: { brandId: scope.brandId, deletedAt: null },
    select: { id: true, portfolioId: true, symbol: true, direction: true, entryDate: true, status: true },
  });
  const editors = (await getEditors(scope.organizationId, scope.brandId)).map((e) => ({ id: e.id, name: e.name, slug: e.slug }));
  return planImportTable({
    editors,
    table,
    defaultPortfolio,
    portfolios: portfolios.map((p) => p.name),
    existing: existing.map((row) => ({
      id: row.id,
      portfolioName: names.get(row.portfolioId) ?? "",
      symbol: row.symbol,
      direction: row.direction === "SHORT" ? "SHORT" : "LONG",
      entryDate: row.entryDate,
      status: row.status === "CLOSED" ? "CLOSED" : "OPEN",
    })),
    today: new Date(),
  });
}

export type ApplyResult = { batch: string; created: number; closed: number; portfolioIds: string[]; positionIds: string[]; problems: string[] };

/**
 * Write what the plan says: create new recommendations and close open ones. Never deletes and never rewrites a
 * recorded trade, so running it again over the same rows does nothing.
 */
export async function applyImportPlan(scope: TrackWorkScope, plan: ImportPlan, via: string): Promise<ApplyResult> {
  const db = tenantDb(scope.organizationId);
  const portfolios = new Map((await listPortfolios(scope)).map((p) => [p.name.toLowerCase(), p.id]));
  for (const name of plan.newPortfolios) {
    if (portfolios.has(name.toLowerCase())) continue;
    const created = await db.trackPortfolio.create({ data: { organizationId: scope.organizationId, brandId: scope.brandId, name, createdById: scope.actorId } });
    portfolios.set(name.toLowerCase(), created.id);
    await auditTrack(scope, "trackrecord.portfolio.created", "track_portfolio", created.id, { via });
  }
  const batch = randomBytes(8).toString("hex");
  const touchedPortfolios = new Set<string>();
  const touchedPositions: string[] = [];
  const problems: string[] = [];
  let created = 0;
  let closed = 0;
  for (const row of plan.rows) {
    if ((row.action !== "create" && row.action !== "close") || !row.draft) continue;
    const draft = row.draft;
    const portfolioId = portfolios.get(row.portfolio.toLowerCase());
    if (!portfolioId) continue;
    touchedPortfolios.add(portfolioId);
    if (row.action === "close" && row.existingId) {
      const existing = await db.trackPosition.findFirst({ where: { id: row.existingId, status: "OPEN", deletedAt: null } });
      if (!existing) continue;
      if (existing.fillCount > 0) {
        const problem = await closeWithFill({ organizationId: scope.organizationId, position: existing, exitPrice: draft.exitPrice as number, exitDate: draft.exitDate as Date, actorId: scope.actorId });
        if (problem) {
          problems.push(`Line ${row.line} (${draft.symbol}): ${problem}`);
          continue;
        }
      } else {
        await db.trackPosition.updateMany({ where: { id: existing.id, status: "OPEN" }, data: { status: "CLOSED", exitDate: draft.exitDate, exitPrice: draft.exitPrice, peakCheckedAt: null } });
      }
      touchedPositions.push(existing.id);
      closed += 1;
      continue;
    }
    const position = await db.trackPosition.create({
      data: {
        organizationId: scope.organizationId,
        brandId: scope.brandId,
        portfolioId,
        symbol: draft.symbol,
        name: draft.name,
        assetType: draft.assetType,
        direction: draft.direction,
        optionRight: draft.optionRight,
        strike: draft.strike,
        expiry: draft.expiry,
        priceSymbol: draft.priceSymbol,
        entryDate: draft.entryDate,
        entryPrice: draft.entryPrice,
        stopPrice: draft.stopPrice,
        targetPrice: draft.targetPrice,
        exitDate: draft.exitDate,
        exitPrice: draft.exitPrice,
        status: draft.exitPrice != null ? "CLOSED" : "OPEN",
        weight: draft.weight,
        notes: draft.notes,
        importBatch: batch,
        editorId: row.editorId ?? null,
        createdById: scope.actorId,
        ...(draft.splitFactor != null ? { splitFactor: draft.splitFactor, splitSource: "manual" } : {}),
      },
    });
    touchedPositions.push(position.id);
    created += 1;
  }
  await auditTrack(scope, "trackrecord.import.committed", "track_import", batch, { via, created, closed, skipped: plan.counts.skip, errors: plan.counts.error });
  return { batch, created, closed, portfolioIds: [...touchedPortfolios], positionIds: touchedPositions, problems };
}
