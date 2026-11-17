"use server";

import { tenantDb } from "@pubcommand/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { occSymbol } from "../../../../../modules/performance/gain";
import { validateFill } from "../../../../../modules/performance/legs";
import { parseDate, parseMoney } from "../../../../../modules/performance/positions";
import { trackAccess, type TrackScope } from "./context";
import { checkHistory, fillRecord, loadLegs, syncPositionFromFills } from "./fills";
import { afterPositionsChanged, auditTrack, getPortfolio, type PositionRow } from "./server";

const UUID = /^[0-9a-f-]{36}$/i;

function text(formData: FormData, key: string, max = 300): string {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

function go(path: string, message?: { error?: string; notice?: string }): never {
  const query = message?.error ? `?error=${encodeURIComponent(message.error)}` : message?.notice ? `?notice=${encodeURIComponent(message.notice)}` : "";
  redirect(`${path}${query}`);
}

/** The writer's scope and the position named in the form, or a redirect with the reason. */
async function positionFrom(formData: FormData): Promise<{ scope: TrackScope; position: PositionRow; back: string }> {
  const access = await trackAccess("performance.write");
  if (!access.ok) go("/performance", { error: access.error });
  const portfolio = await getPortfolio(access.scope, text(formData, "portfolioId", 40));
  if (!portfolio) go("/performance", { error: "That portfolio no longer exists." });
  const positionId = text(formData, "positionId", 40);
  const position = UUID.test(positionId)
    ? await tenantDb(access.scope.organizationId).trackPosition.findFirst({ where: { id: positionId, portfolioId: portfolio.id, deletedAt: null } })
    : null;
  if (!position) go(`/performance/${portfolio.id}`, { error: "That recommendation no longer exists." });
  return { scope: access.scope, position, back: `/performance/${portfolio.id}/positions/${position.id}` };
}

function done(scope: TrackScope, position: PositionRow) {
  after(() => afterPositionsChanged(scope, [position.portfolioId], [position.id]));
}

/** Turn a simple recommendation into one tracked by fills: leg 0 from its instrument, fills from its entry and exit. */
export async function startFills(formData: FormData) {
  const { scope, position, back } = await positionFrom(formData);
  const db = tenantDb(scope.organizationId);
  if (position.fillCount > 0 || (await db.trackLeg.count({ where: { positionId: position.id } }))) go(back, { error: "This position already tracks fills." });
  const quantity = Number(text(formData, "quantity", 20).replace(/[,\s]/g, ""));
  if (!(quantity > 0) || !Number.isFinite(quantity)) go(back, { error: "Enter the starting quantity (shares or contracts)." });
  const option = position.assetType === "OPTION";
  const multiplier = option ? 100 : 1;
  const leg = await db.trackLeg.create({
    data: {
      organizationId: scope.organizationId,
      positionId: position.id,
      legIndex: 0,
      kind: option ? "OPTION" : "STOCK",
      symbol: position.symbol,
      priceSymbol: position.priceSymbol,
      optionRight: position.optionRight,
      strike: position.strike,
      expiry: position.expiry,
      side: position.direction === "SHORT" ? "SELL" : "BUY",
      multiplier,
    },
  });
  await db.trackFill.create({
    data: { organizationId: scope.organizationId, positionId: position.id, legId: leg.id, intent: "OPEN", quantity, price: position.entryPrice, multiplier, executedAt: position.entryDate, createdById: scope.actorId },
  });
  if (position.status === "CLOSED" && position.exitPrice && position.exitDate) {
    await db.trackFill.create({
      data: { organizationId: scope.organizationId, positionId: position.id, legId: leg.id, intent: "CLOSE", quantity, price: position.exitPrice, multiplier, executedAt: position.exitDate, createdById: scope.actorId },
    });
  }
  await syncPositionFromFills(scope.organizationId, position.id);
  await auditTrack(scope, "trackrecord.position.fills.started", "track_position", position.id, { quantity });
  done(scope, position);
  go(back, { notice: "This position now tracks fills. Add buys and sells to scale in and out." });
}

/** Add a leg (e.g. the other side of a spread) with its opening fill. */
export async function addLeg(formData: FormData) {
  const { scope, position, back } = await positionFrom(formData);
  const db = tenantDb(scope.organizationId);
  const { legs } = await loadLegs(db, position.id);
  if (legs.length >= 8) go(back, { error: "A position can have up to 8 legs." });
  const kind = text(formData, "kind", 10) === "OPTION" ? "OPTION" : "STOCK";
  const side = text(formData, "side", 10) === "SELL" ? "SELL" : "BUY";
  const symbol = (text(formData, "symbol", 24) || position.symbol).toUpperCase().replace(/^\$/, "");
  if (!/^[A-Z0-9.\-^:/=&]{1,24}$/.test(symbol)) go(back, { error: "Enter a valid symbol." });
  const ratio = Math.round(Number(text(formData, "ratio", 4) || "1"));
  if (!(ratio >= 1 && ratio <= 20)) go(back, { error: "Ratio must be a whole number from 1 to 20." });
  let optionRight: "CALL" | "PUT" | null = null;
  let strike: number | null = null;
  let expiry: Date | null = null;
  if (kind === "OPTION") {
    optionRight = text(formData, "optionRight", 4) === "PUT" ? "PUT" : "CALL";
    strike = parseMoney(text(formData, "strike", 20));
    const parsed = parseDate(text(formData, "expiry", 20));
    expiry = parsed instanceof Date ? parsed : null;
    if (strike == null || Number.isNaN(strike) || strike <= 0 || !expiry) go(back, { error: "An option leg needs a strike and an expiry." });
  }
  const multiplier = kind === "OPTION" ? 100 : 1;
  const fill = validateFill({ intent: "OPEN", quantity: text(formData, "quantity", 20), price: text(formData, "price", 20), executedAt: text(formData, "executedAt", 10), note: text(formData, "note", 1000) }, new Date());
  if (!fill.ok) go(back, { error: fill.error });
  const priceSymbol = kind === "OPTION" ? occSymbol({ underlying: symbol, expiry: expiry as Date, right: optionRight as "CALL" | "PUT", strike: strike as number }) : symbol;
  const legIndex = legs.length ? Math.max(...legs.map((l) => l.legIndex)) + 1 : 0;
  const leg = await db.trackLeg.create({
    data: { organizationId: scope.organizationId, positionId: position.id, legIndex, kind, symbol, priceSymbol, optionRight, strike, expiry, side, ratio, multiplier },
  });
  await db.trackFill.create({
    data: { organizationId: scope.organizationId, positionId: position.id, legId: leg.id, intent: "OPEN", quantity: fill.draft.quantity, price: fill.draft.price, multiplier, executedAt: fill.draft.executedAt, note: fill.draft.note, createdById: scope.actorId },
  });
  await syncPositionFromFills(scope.organizationId, position.id);
  await auditTrack(scope, "trackrecord.position.leg.added", "track_leg", leg.id, { positionId: position.id });
  done(scope, position);
  go(back, { notice: `Leg ${legIndex + 1} added.` });
}

/** Scale in (OPEN) or out (CLOSE) on one leg. Refused when it would over-close or reopen a flat leg. */
export async function addFill(formData: FormData) {
  const { scope, position, back } = await positionFrom(formData);
  const db = tenantDb(scope.organizationId);
  const { legs, fills } = await loadLegs(db, position.id);
  const leg = legs.find((l) => l.id === text(formData, "legId", 40));
  if (!leg) go(back, { error: "Pick the leg this fill is on." });
  const result = validateFill({ intent: text(formData, "intent", 10), quantity: text(formData, "quantity", 20), price: text(formData, "price", 20), executedAt: text(formData, "executedAt", 10), note: text(formData, "note", 1000) }, new Date());
  if (!result.ok) go(back, { error: result.error });
  const draft = result.draft;
  const problem = checkHistory(legs, [...fills.map(fillRecord), { id: "new", legId: leg.id, intent: draft.intent, quantity: draft.quantity, price: draft.price, multiplier: leg.multiplier, executedAt: draft.executedAt, createdAt: new Date() }]);
  if (problem) go(back, { error: problem });
  const created = await db.trackFill.create({
    data: { organizationId: scope.organizationId, positionId: position.id, legId: leg.id, intent: draft.intent, quantity: draft.quantity, price: draft.price, multiplier: leg.multiplier, executedAt: draft.executedAt, note: draft.note, createdById: scope.actorId },
  });
  await syncPositionFromFills(scope.organizationId, position.id);
  await auditTrack(scope, "trackrecord.position.fill.added", "track_fill", created.id, { positionId: position.id, intent: draft.intent });
  done(scope, position);
  go(back, { notice: draft.intent === "OPEN" ? "Buy recorded." : "Exit recorded." });
}

export async function deleteFill(formData: FormData) {
  const { scope, position, back } = await positionFrom(formData);
  const db = tenantDb(scope.organizationId);
  const fillId = text(formData, "fillId", 40);
  const { legs, fills } = await loadLegs(db, position.id);
  if (!fills.some((f) => f.id === fillId)) go(back, { error: "That fill no longer exists." });
  const problem = checkHistory(legs, fills.filter((f) => f.id !== fillId).map(fillRecord));
  if (problem) go(back, { error: `Removing that fill would leave an impossible history: ${problem}` });
  await db.trackFill.updateMany({ where: { id: fillId, positionId: position.id }, data: { deletedAt: new Date() } });
  // A leg left without fills goes too, so the position can return to a simple recommendation.
  const remaining = fills.filter((f) => f.id !== fillId);
  const empty = legs.filter((l) => !remaining.some((f) => f.legId === l.id)).map((l) => l.id);
  if (empty.length) await db.trackLeg.deleteMany({ where: { id: { in: empty }, positionId: position.id } });
  await syncPositionFromFills(scope.organizationId, position.id);
  await auditTrack(scope, "trackrecord.position.fill.deleted", "track_fill", fillId, { positionId: position.id });
  done(scope, position);
  go(back, { notice: "Fill removed." });
}
