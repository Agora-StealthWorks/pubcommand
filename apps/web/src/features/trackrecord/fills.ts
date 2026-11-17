import { tenantDb } from "@pubcommand/db";
import { LegError, positionPnl, type FillRecord, type LegSpec } from "../../../../../modules/performance/legs";
import type { FillRow, LegRow, PositionRow } from "./server";

type Db = ReturnType<typeof tenantDb>;

export function legSpec(leg: LegRow): LegSpec {
  return { id: leg.id, legIndex: leg.legIndex, side: leg.side === "SELL" ? "SELL" : "BUY", ratio: leg.ratio, multiplier: leg.multiplier };
}

export function fillRecord(fill: Pick<FillRow, "id" | "legId" | "intent" | "quantity" | "price" | "multiplier" | "executedAt" | "createdAt">): FillRecord {
  return { id: fill.id, legId: fill.legId, intent: fill.intent === "CLOSE" ? "CLOSE" : "OPEN", quantity: fill.quantity, price: fill.price, multiplier: fill.multiplier, executedAt: fill.executedAt, createdAt: fill.createdAt };
}

export async function loadLegs(db: Db, positionId: string): Promise<{ legs: LegRow[]; fills: FillRow[] }> {
  const [legs, fills] = await Promise.all([
    db.trackLeg.findMany({ where: { positionId }, orderBy: { legIndex: "asc" } }),
    db.trackFill.findMany({ where: { positionId, deletedAt: null }, orderBy: [{ executedAt: "asc" }, { createdAt: "asc" }] }),
  ]);
  return { legs, fills };
}

/** Would this history be valid? Returns the reason when not. */
export function checkHistory(legs: readonly LegRow[], fills: readonly FillRecord[]): string | null {
  try {
    positionPnl(legs.map(legSpec), fills);
    return null;
  } catch (error) {
    return error instanceof LegError ? error.message : "That fill history is not valid.";
  }
}

/**
 * Copy what the fills say onto the position row (entry, exit, status, realized P&L), so lists, imports, exports
 * and the public view read the same numbers. The gain itself is always recomputed from the fills.
 */
export async function syncPositionFromFills(organizationId: string, positionId: string): Promise<void> {
  const db = tenantDb(organizationId);
  const { legs, fills } = await loadLegs(db, positionId);
  if (!fills.length) {
    await db.trackPosition.updateMany({ where: { id: positionId }, data: { fillCount: 0, realizedPnl: null } });
    return;
  }
  let pnl;
  try {
    pnl = positionPnl(legs.map(legSpec), fills.map(fillRecord));
  } catch {
    await db.trackPosition.updateMany({ where: { id: positionId }, data: { fillCount: fills.length } });
    return;
  }
  const closed = pnl.status === "CLOSED";
  await db.trackPosition.updateMany({
    where: { id: positionId },
    data: {
      fillCount: fills.length,
      realizedPnl: pnl.realized,
      ...(pnl.entryPerUnit && pnl.entryPerUnit > 0 ? { entryPrice: pnl.entryPerUnit } : {}),
      ...(pnl.firstAt ? { entryDate: pnl.firstAt } : {}),
      status: closed ? "CLOSED" : "OPEN",
      exitPrice: closed && pnl.exitPerUnit && pnl.exitPerUnit > 0 ? pnl.exitPerUnit : null,
      exitDate: closed ? pnl.lastAt : null,
      peakCheckedAt: null,
    },
  });
}

/**
 * Close a position tracked by fills at one price: a closing fill for whatever is still open. Only a single-leg
 * position can be closed this way; a spread is closed leg by leg.
 */
export async function closeWithFill(input: { organizationId: string; position: PositionRow; exitPrice: number; exitDate: Date; actorId: string | null }): Promise<string | null> {
  const db = tenantDb(input.organizationId);
  const { legs, fills } = await loadLegs(db, input.position.id);
  if (legs.length !== 1) return "This position has several legs. Close each leg with its own fill.";
  const leg = legs[0] as LegRow;
  const pnl = positionPnl([legSpec(leg)], fills.map(fillRecord));
  const open = pnl.legs[0]?.openQty ?? 0;
  if (open <= 0) return "Nothing is open on this position.";
  const candidate = { id: "new", legId: leg.id, intent: "CLOSE" as const, quantity: open, price: input.exitPrice, multiplier: leg.multiplier, executedAt: input.exitDate, createdAt: new Date() };
  const problem = checkHistory(legs, [...fills.map(fillRecord), candidate]);
  if (problem) return problem;
  await db.trackFill.create({
    data: { organizationId: input.organizationId, positionId: input.position.id, legId: leg.id, intent: "CLOSE", quantity: open, price: input.exitPrice, multiplier: leg.multiplier, executedAt: input.exitDate, createdById: input.actorId },
  });
  await syncPositionFromFills(input.organizationId, input.position.id);
  return null;
}
