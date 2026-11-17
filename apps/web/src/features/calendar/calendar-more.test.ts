import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawPrisma, tenantDb } from "@pubcommand/db";
import { sealToken } from "../../../../../modules/editorial/airtable";
import { zonedToUtc } from "../../../../../modules/editorial/cub";
import { addDays, todayIn } from "../../../../../modules/editorial/dates";
import { labelKey } from "../../../../../modules/editorial/stats";
import { pushRecord, syncConnection } from "./airtable-sync";
import { runCubTickForOrg } from "./cub-emails";
import { createEvent, extendOpenSeries, type EventInput } from "./events";
import { importStats, saveListMapping } from "./stats";
import { purgeFromTrash, restoreFromTrash, trashSeries } from "./trash";

/**
 * Marketing Calendar additions against the local database: CUB email job
 * idempotency, trash/restore of a series, series extension, saved list
 * mappings on import, and the Airtable pull/push with a fake Airtable.
 */
describe("marketing calendar (database)", () => {
  const db = rawPrisma();
  const suffix = randomBytes(4).toString("hex");
  const ids = { org: "", plan: "", brand: "" };
  const ET = "America/New_York";

  beforeAll(async () => {
    delete process.env.RESEND_API_KEY;
    process.env.AUTH_SECRET ||= "calendar-test-secret-0123456789";
    execSync("pnpm exec prisma migrate deploy --schema prisma/schema", {
      cwd: new URL("../../../../../packages/db", import.meta.url).pathname,
      env: process.env,
      stdio: "ignore",
    });
    const plan = await db.plan.create({ data: { key: `cal-${suffix}`, name: "Calendar test", seatLimit: 5, monthlyPriceCents: 0 } });
    const org = await db.organization.create({ data: { name: `Calendar ${suffix}`, slug: `cal-${suffix}`, planId: plan.id, seatLimit: 5 } });
    const brand = await tenantDb(org.id).brand.create({ data: { organizationId: org.id, name: "Brand", slug: `b-${suffix}`, niche: "finance" } });
    Object.assign(ids, { org: org.id, plan: plan.id, brand: brand.id });
  });

  afterAll(async () => {
    if (ids.org) await db.organization.deleteMany({ where: { id: ids.org } });
    if (ids.plan) await db.plan.deleteMany({ where: { id: ids.plan } });
  });

  const blankEvent = (name: string, eventDate: string): EventInput => ({
    name,
    eventType: null,
    format: null,
    stage: "Planned",
    marketingStart: null,
    eventDate,
    eventEnd: null,
    marketingEnd: null,
    startTime: null,
    endTime: null,
    channels: [],
    hosts: [],
    offer: null,
    promoCode: null,
    ctaLink: null,
    registrationLink: null,
    replayLink: null,
    notes: null,
    peakAttendance: null,
    avgAttendance: null,
    registrations: null,
    newSubscribers: null,
    leads: null,
    orders: null,
    revenue: null,
    messages: null,
  });

  it("sends each CUB email once: reminder after 9:05 ET the business day before, then 'revisions ready'", async () => {
    const t = tenantDb(ids.org);
    const dueAt = zonedToUtc("2026-11-19", "15:30", ET);
    const round = await t.calendarCubRound.create({
      data: {
        organizationId: ids.org,
        brandId: ids.brand,
        promoName: "Gold promo",
        draftFilename: "draft.docx",
        draftMime: "application/octet-stream",
        draftSize: 4,
        draftData: new Uint8Array([1, 2, 3, 4]),
        dueAt,
        reviewToken: randomBytes(16).toString("hex"),
        ownerToken: randomBytes(16).toString("hex"),
        initiatorEmail: "writer@example.test",
        reviewerEmails: ["r1@example.test", "r2@example.test"],
        publicBase: "http://example.localhost:3000",
        requestSentAt: zonedToUtc("2026-11-17", "10:00", ET),
        createdAt: zonedToUtc("2026-11-17", "10:00", ET),
      },
    });
    expect(await runCubTickForOrg(ids.org, zonedToUtc("2026-11-18", "09:00", ET))).toMatchObject({ reminders: 0, completions: 0 });
    expect(await runCubTickForOrg(ids.org, zonedToUtc("2026-11-18", "09:15", ET))).toMatchObject({ reminders: 1, completions: 0 });
    expect(await runCubTickForOrg(ids.org, zonedToUtc("2026-11-18", "09:30", ET))).toMatchObject({ reminders: 0, completions: 0 });
    expect(await runCubTickForOrg(ids.org, zonedToUtc("2026-11-19", "15:45", ET))).toMatchObject({ reminders: 0, completions: 1 });
    expect(await runCubTickForOrg(ids.org, zonedToUtc("2026-11-19", "16:00", ET))).toMatchObject({ reminders: 0, completions: 0 });
    const logs = await t.calendarEmailLog.findMany({ where: { roundId: round.id }, orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => [l.kind, l.status, l.recipients])).toEqual([
      ["cub-reminder", "logged", 2],
      ["cub-complete", "logged", 1],
    ]);
  });

  it("trashes a series with its occurrences and restores exactly those", async () => {
    const start = addDays(todayIn(), 7);
    const { id } = await createEvent({ organizationId: ids.org, brandId: ids.brand, actorId: null, data: blankEvent("Weekly call", start), repeat: "weekly", until: addDays(start, 21) });
    const t = tenantDb(ids.org);
    const anchor = await t.calendarEvent.findFirst({ where: { id } });
    const seriesId = anchor!.seriesId!;
    // One occurrence was deleted on its own earlier; it must stay in the trash.
    const lone = await t.calendarEvent.findFirst({ where: { seriesId, id: { not: id } }, orderBy: { eventDate: "desc" } });
    await t.calendarEvent.updateMany({ where: { id: lone!.id }, data: { deletedAt: new Date(Date.now() - 60_000) } });
    expect(await trashSeries(ids.org, ids.brand, seriesId)).toBe(3);
    expect(await t.calendarEvent.count({ where: { seriesId, deletedAt: null } })).toBe(0);
    expect(await restoreFromTrash(ids.org, ids.brand, "event", id)).toMatchObject({ error: expect.stringMatching(/series/) });
    const restored = await restoreFromTrash(ids.org, ids.brand, "series", seriesId);
    expect("events" in restored && restored.events.length).toBe(3);
    expect(await t.calendarEvent.count({ where: { seriesId, deletedAt: null } })).toBe(3);
    expect((await t.calendarEvent.findFirst({ where: { id: lone!.id } }))?.deletedAt).not.toBeNull();
    // Deleting for good leaves a tombstone for rows that came from Airtable.
    await t.calendarEvent.updateMany({ where: { id: lone!.id }, data: { airtableId: "recAAAAAAAAAAAAAA1" } });
    expect(await purgeFromTrash(ids.org, ids.brand, "event", lone!.id)).toBe(1);
    expect(await t.calendarSyncLog.count({ where: { brandId: ids.brand, status: "tombstone", airtableId: "recAAAAAAAAAAAAAA1" } })).toBe(1);
  });

  it("extends open-ended series ahead and is idempotent", async () => {
    const today = todayIn();
    const { id } = await createEvent({ organizationId: ids.org, brandId: ids.brand, actorId: null, data: blankEvent("Open-ended", today), repeat: "weekly", until: null });
    const t = tenantDb(ids.org);
    const seriesId = (await t.calendarEvent.findFirst({ where: { id } }))!.seriesId!;
    const before = await t.calendarEvent.count({ where: { seriesId } });
    // Two months later the horizon has moved, so new weeks are planned.
    const later = addDays(today, 61);
    const first = await extendOpenSeries(ids.org, later);
    expect(first.created).toBeGreaterThanOrEqual(8);
    expect(await t.calendarEvent.count({ where: { seriesId } })).toBe(before + first.created);
    expect((await extendOpenSeries(ids.org, later)).created).toBe(0);
  });

  it("uses a saved list mapping when importing send stats", async () => {
    const t = tenantDb(ids.org);
    await t.calendarPublication.create({ data: { organizationId: ids.org, brandId: ids.brand, code: "WAR", name: "War Room" } });
    const issue = await t.calendarIssue.create({ data: { organizationId: ids.org, brandId: ids.brand, publicationCode: "WAR", title: "Issue", mailDate: new Date("2026-11-02T00:00:00Z") } });
    const csv = "Mail date,List,Mailed\n2026-11-02,Daily Market Wrap,1000\n2026-11-02,Dedicated blast,500\n";
    const mapping = { mailDate: 0, list: 1, delivered: 2 };
    const before = await importStats({ organizationId: ids.org, brandId: ids.brand, actorId: null, filename: "a.csv", csv, mapping, rateFormat: "percent" });
    expect(before.matched).toBe(0);
    await saveListMapping({ organizationId: ids.org, brandId: ids.brand, label: "Daily Market Wrap", pubCode: "WAR", actorId: null });
    await saveListMapping({ organizationId: ids.org, brandId: ids.brand, label: "dedicated  BLAST", pubCode: "", actorId: null });
    // Saving the same label again replaces it instead of duplicating.
    await saveListMapping({ organizationId: ids.org, brandId: ids.brand, label: "Daily market wrap", pubCode: "WAR", actorId: null });
    expect(await t.calendarListMapping.count({ where: { brandId: ids.brand, labelKey: labelKey("Daily Market Wrap") } })).toBe(1);
    const after = await importStats({ organizationId: ids.org, brandId: ids.brand, actorId: null, filename: "a.csv", csv, mapping, rateFormat: "percent" });
    expect(after).toMatchObject({ matched: 1, unmatched: 1, matchedIssueIds: [issue.id] });
  });

  it("pulls from Airtable by record id, respects the conflict rule, and writes back editable fields only", async () => {
    const t = tenantDb(ids.org);
    const remote: Record<string, { id: string; fields: Record<string, unknown> }> = {
      recEVENT000000001: { id: "recEVENT000000001", fields: { Name: "Webinar", "Event Date": "2026-12-01", Modified: "2026-11-17T10:00:00.000Z", Formula: "x" } },
    };
    const calls: { method: string; url: string; body?: unknown }[] = [];
    const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url: String(url), body });
      if (method === "GET") return new Response(JSON.stringify({ records: Object.values(remote) }), { status: 200 });
      return new Response(JSON.stringify({ id: "recEVENT000000002", fields: body?.fields ?? {} }), { status: 200 });
    }) as typeof fetch;
    const conn = await t.calendarAirtableConnection.create({
      data: {
        organizationId: ids.org,
        brandId: ids.brand,
        baseId: "appBASE0000000001",
        tokenEnc: sealToken("patTEST", process.env.AUTH_SECRET!),
        eventsTable: "Events",
        eventFields: { fields: { name: "Name", eventDate: "Event Date", notes: "Formula" }, modifiedField: "Modified", types: { Formula: "formula", Modified: "lastModifiedTime" } },
      },
    });

    const first = await syncConnection(conn, fakeFetch);
    expect(first).toMatchObject({ events: { created: 1 } });
    const pulled = await t.calendarEvent.findFirst({ where: { brandId: ids.brand, airtableId: "recEVENT000000001" } });
    expect(pulled).toMatchObject({ name: "Webinar" });

    // A local edit after the Airtable change wins: an older remote record is skipped.
    await t.calendarEvent.updateMany({ where: { id: pulled!.id }, data: { name: "Webinar (renamed here)" } });
    remote.recEVENT000000001!.fields.Name = "Old remote name";
    const second = await syncConnection(conn, fakeFetch);
    expect(second).toMatchObject({ events: { updated: 0 } });
    expect((await t.calendarEvent.findFirst({ where: { id: pulled!.id } }))?.name).toBe("Webinar (renamed here)");
    // The local edit went back to Airtable, without the computed field.
    const patch = calls.find((c) => c.method === "PATCH" && c.url.endsWith("/recEVENT000000001"));
    expect(patch?.body).toEqual({ fields: { Name: "Webinar (renamed here)", "Event Date": "2026-12-01" }, typecast: true });

    // A newer Airtable record wins.
    remote.recEVENT000000001!.fields = { ...remote.recEVENT000000001!.fields, Name: "Newer in Airtable", Modified: new Date(Date.now() + 60_000).toISOString() };
    const third = await syncConnection(conn, fakeFetch);
    expect(third).toMatchObject({ events: { updated: 1 } });
    expect((await t.calendarEvent.findFirst({ where: { id: pulled!.id } }))?.name).toBe("Newer in Airtable");

    // A new local event is created in Airtable and remembers the record id.
    const { id } = await createEvent({ organizationId: ids.org, brandId: ids.brand, actorId: null, data: blankEvent("Made here", "2026-12-05"), repeat: null, until: null });
    expect(await pushRecord({ organizationId: ids.org, brandId: ids.brand, entity: "event", id, fetcher: fakeFetch })).toBe("ok");
    expect((await t.calendarEvent.findFirst({ where: { id } }))?.airtableId).toBe("recEVENT000000002");
  });
});
