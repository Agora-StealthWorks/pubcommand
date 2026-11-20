import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { provisionOrganization } from "./provision";
import { tenantDb } from "./tenant";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/pubcommand";
process.env.DATABASE_URL = databaseUrl;

/**
 * Migration 20261120180000_calendar_own_promos: Calendar promos stop pointing at Promo Analyzer.
 * Seeds the old shape (analyzer promos + calendar_promo_tracks + promo_id links), runs the
 * backfill and checks what the Calendar gets; a second run must change nothing.
 */
describe("calendar promo backfill", () => {
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const suffix = randomBytes(4).toString("hex");
  const emails = [`cp-a-${suffix}@example.com`, `cp-staff-${suffix}@example.com`];
  let org = { id: "", brandId: "" };
  let planId = "";
  const ids = { tracked: "", eventOnly: "", issueOnly: "", cubOnly: "", unused: "", deleted: "" };
  const rows = { event: "", event2: "", issue: "", cub: "", lone: "" };

  const backfill = async () => (await db.$queryRaw<{ n: number }[]>`SELECT public.calendar_backfill_own_promos() AS n`)[0]!.n;
  const snapshot = async () => ({
    promos: await db.calendarPromo.findMany({ where: { organizationId: org.id }, orderBy: { name: "asc" } }),
    activity: await db.calendarPromoActivity.count({ where: { organizationId: org.id } }),
    events: await db.calendarEvent.findMany({ where: { organizationId: org.id }, select: { id: true, promoId: true, calendarPromoId: true }, orderBy: { id: "asc" } }),
    issues: await db.calendarIssue.findMany({ where: { organizationId: org.id }, select: { id: true, promoId: true, calendarPromoId: true }, orderBy: { id: "asc" } }),
    rounds: await db.calendarCubRound.findMany({ where: { organizationId: org.id }, select: { id: true, promoId: true, calendarPromoId: true }, orderBy: { id: "asc" } }),
  });

  beforeAll(async () => {
    execSync("pnpm exec prisma migrate deploy --schema prisma/schema", { cwd: new URL("..", import.meta.url).pathname, env: process.env, stdio: "inherit" });
    planId = (await db.plan.create({ data: { key: `cp-${suffix}`, name: "CP", seatLimit: 5, monthlyPriceCents: 0 } })).id;
    const staff = await db.user.create({ data: { email: emails[1]! } });
    const created = await provisionOrganization({ name: "CP", slug: `cp-${suffix}`, planId, adminEmail: emails[0]!, actorId: staff.id, actorEmail: emails[1]!, permissionKeys: ["editorial.read"] });
    const brand = await db.brand.findFirstOrThrow({ where: { organizationId: created.organizationId } });
    org = { id: created.organizationId, brandId: brand.id };
    const o = { organizationId: org.id, brandId: org.brandId };

    // Old shape: Promo Analyzer promos...
    const promo = async (title: string, extra: Record<string, unknown> = {}) => (await db.promo.create({ data: { ...o, title, ...extra } })).id;
    ids.tracked = await promo("Tracked promo", { product: "PSU", gurus: ["Nate Bear"], promoType: "Front-end" });
    ids.eventOnly = await promo("Event-only promo", { product: "SAT" });
    ids.issueOnly = await promo("Issue-only promo");
    ids.cubOnly = await promo("CUB-only promo");
    ids.unused = await promo("Never on the calendar");
    ids.deleted = await promo("Deleted in Promo Analyzer", { deletedAt: new Date("2026-11-01T00:00:00Z") });
    // ...a brand stage list, a pipeline track, and calendar rows pointing at them.
    await db.calendarFieldOption.create({ data: { ...o, field: "promo.stage", value: "Brainstorm", sortOrder: 0 } });
    await db.calendarPromoTrack.create({ data: { ...o, promoId: ids.tracked, stage: "Writing", launchDate: new Date("2026-12-03T00:00:00Z"), launchEstimated: true, writers: ["Ann Writer"], notes: "Holiday push" } });
    rows.event = (await db.calendarEvent.create({ data: { ...o, name: "Launch webinar", promoId: ids.tracked } })).id;
    rows.event2 = (await db.calendarEvent.create({ data: { ...o, name: "Follow-up", promoId: ids.eventOnly } })).id;
    rows.lone = (await db.calendarEvent.create({ data: { ...o, name: "No promo" } })).id;
    rows.issue = (await db.calendarIssue.create({ data: { ...o, publicationCode: "PSU", title: "Teaser issue", promoId: ids.issueOnly } })).id;
    await db.calendarIssue.create({ data: { ...o, publicationCode: "PSU", title: "Deleted promo issue", promoId: ids.deleted } });
    rows.cub = (
      await db.calendarCubRound.create({
        data: { ...o, promoName: "CUB-only promo", promoId: ids.cubOnly, draftFilename: "d.docx", draftMime: "application/octet-stream", draftSize: 1, draftData: new Uint8Array([1]), dueAt: new Date(), reviewToken: `r${suffix}`, ownerToken: `o${suffix}` },
      })
    ).id;
  });

  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: org.id } });
    await db.user.deleteMany({ where: { email: { in: emails } } });
    await db.plan.deleteMany({ where: { id: planId } });
    await db.$disconnect();
  });

  it("copies exactly the analyzer promos the calendar referenced, with what the calendar showed", async () => {
    await backfill();
    const { promos, activity } = await snapshot();
    expect(promos.map((p) => p.legacyPromoId).sort()).toEqual([ids.tracked, ids.eventOnly, ids.issueOnly, ids.cubOnly, ids.deleted].sort());
    expect(promos.some((p) => p.legacyPromoId === ids.unused)).toBe(false);
    const tracked = promos.find((p) => p.legacyPromoId === ids.tracked)!;
    expect(tracked).toMatchObject({ name: "Tracked promo", stage: "Writing", product: "PSU", gurus: ["Nate Bear"], promoType: "Front-end", writers: ["Ann Writer"], notes: "Holiday push", launchEstimated: true, brandId: org.brandId, deletedAt: null });
    expect(tracked.launchDate?.toISOString().slice(0, 10)).toBe("2026-12-03");
    // It already has an event, so it never gets an automatic launch event.
    expect(tracked.launchEventCreated).toBe(true);
    // No track: the brand's first stage, as the board showed it.
    const eventOnly = promos.find((p) => p.legacyPromoId === ids.eventOnly)!;
    expect(eventOnly).toMatchObject({ stage: "Brainstorm", product: "SAT", writers: [], launchDate: null });
    expect(promos.find((p) => p.legacyPromoId === ids.issueOnly)!.launchEventCreated).toBe(false);
    // A promo deleted in Promo Analyzer stays hidden, as it was.
    expect(promos.find((p) => p.legacyPromoId === ids.deleted)!.deletedAt).not.toBeNull();
    expect(activity).toBe(5);
  });

  it("points events, issues and CUB rounds at the new promos and leaves promo_id alone", async () => {
    const { promos, events, issues, rounds } = await snapshot();
    const byLegacy = new Map(promos.map((p) => [p.legacyPromoId, p.id]));
    const ev = new Map(events.map((e) => [e.id, e]));
    expect(ev.get(rows.event)).toMatchObject({ promoId: ids.tracked, calendarPromoId: byLegacy.get(ids.tracked) });
    expect(ev.get(rows.event2)).toMatchObject({ promoId: ids.eventOnly, calendarPromoId: byLegacy.get(ids.eventOnly) });
    expect(ev.get(rows.lone)).toMatchObject({ promoId: null, calendarPromoId: null });
    expect(issues.find((i) => i.id === rows.issue)).toMatchObject({ promoId: ids.issueOnly, calendarPromoId: byLegacy.get(ids.issueOnly) });
    expect(rounds).toEqual([{ id: rows.cub, promoId: ids.cubOnly, calendarPromoId: byLegacy.get(ids.cubOnly) }]);
    // Calendar code reads them through the tenant client like any calendar table.
    expect(await tenantDb(org.id).calendarPromo.count({ where: { brandId: org.brandId, deletedAt: null } })).toBe(4);
  });

  it("does nothing the second time, even after someone unlinks a row", async () => {
    await tenantDb(org.id).calendarEvent.updateMany({ where: { id: rows.event2 }, data: { calendarPromoId: null } });
    const before = await snapshot();
    await backfill();
    const after = await snapshot();
    expect(after).toEqual(before);
    expect(after.events.find((e) => e.id === rows.event2)?.calendarPromoId).toBeNull();
  });

  it("keeps calendar promos inside their organization", async () => {
    const other = await db.organization.findFirst({ where: { id: { not: org.id } }, select: { id: true } });
    if (other) expect(await tenantDb(other.id).calendarPromo.count({ where: { organizationId: org.id } })).toBe(0);
  });
});
