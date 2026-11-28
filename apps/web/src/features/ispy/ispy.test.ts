import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawPrisma, tenantDb, TenantIsolationError } from "@pubcommand/db";
import { approveCandidate, previewRuleOnRecent } from "./admin";
import { ispyDb } from "./db";
import { ingestAndProcess } from "./pipeline";
import { feedCounts, feedFacets, getCopy, listFeed } from "./read";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/pubcommand";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.MACHINEMAIL_API_KEY;
process.env.ISPY_INBOX_DOMAIN = "spy.test";

const db = rawPrisma();
const suffix = randomBytes(4).toString("hex");
const ids = { plan: "", org: "", brand: "", mta: "", totd: "", free: "", stans: "", mb: "", mbList: "", legacy: "", seed: "", listInbox: "" };

const BODY = Array.from({ length: 50 }, (_, i) => `Line ${i}: the bull run bonanza is the setup of the quarter for options traders who want income ${suffix}`).join("\n");

function eml(input: { from: string; to: string; subject: string; body: string; id: string; date?: string; html?: string }): Uint8Array {
  const html = input.html ?? `<html><head><title>Trade of the Day</title></head><body><p>${input.body.replace(/\n/g, "<br>")}</p></body></html>`;
  return new TextEncoder().encode(
    [
      `From: Sender <${input.from}>`,
      `To: ${input.to}`,
      `Subject: ${input.subject}`,
      `Message-ID: <${input.id}-${suffix}@test>`,
      `Date: ${input.date ?? "Mon, 23 Nov 2026 10:00:00 +0000"}`,
      "MIME-Version: 1.0",
      'Content-Type: multipart/alternative; boundary="b"',
      "",
      "--b",
      "Content-Type: text/plain; charset=utf-8",
      "",
      input.body,
      "--b",
      "Content-Type: text/html; charset=utf-8",
      "",
      html,
      "--b--",
      "",
    ].join("\r\n"),
  );
}

beforeAll(async () => {
  execSync("pnpm exec prisma migrate deploy --schema prisma/schema", { cwd: new URL("../../../../../packages/db", import.meta.url).pathname, env: process.env, stdio: "ignore" });
  const plan = await db.plan.create({ data: { key: `ispy-${suffix}`, name: "ISpy test", seatLimit: 5, monthlyPriceCents: 0 } });
  const org = await db.organization.create({ data: { name: `ISpy ${suffix}`, slug: `ispy-${suffix}`, planId: plan.id, seatLimit: 5 } });
  const brand = await tenantDb(org.id).brand.create({ data: { organizationId: org.id, name: "MTA", slug: `mta-${suffix}`, niche: "finance" } });
  await ispyDb(async (tx) => {
    const mta = await tx.ispyPublisher.create({ data: { name: `MTA ${suffix}`, type: "INTERNAL", domains: [`tradeoftheday-${suffix}.com`], linkedOrganizationId: org.id, linkedBrandId: brand.id } });
    const totd = await tx.ispyPublication.create({ data: { publisherId: mta.id, name: `Trade of the Day ${suffix}`, linkedBrandId: brand.id, linkedOrganizationId: org.id } });
    const free = await tx.ispyList.create({ data: { publisherId: mta.id, publicationId: totd.id, name: `TOTD Free ${suffix}` } });
    const stans = await tx.ispyPublisher.create({ data: { name: `Stansberry ${suffix}`, type: "COMPETITOR", domains: [`stansberry-${suffix}.com`] } });
    const mb = await tx.ispyPublisher.create({ data: { name: `MarketBeat ${suffix}`, type: "AFFILIATE", excludeBrands: ["marketbeat"] } });
    const mbList = await tx.ispyList.create({ data: { publisherId: mb.id, name: `MarketBeat ${suffix}`, category: "MARKETING_FILE" } });
    const legacy = await tx.ispyInbox.create({ data: { provider: "GMAIL_LEGACY", level: "LEGACY", address: `legacy-${suffix}@gmail.com` } });
    const seed = await tx.ispyInbox.create({ data: { provider: "GMAIL_LEGACY", level: "LEGACY", address: `seed-${suffix}@gmail.com`, affiliateSeed: true, publisherId: mb.id, listId: mbList.id } });
    const listInbox = await tx.ispyInbox.create({ data: { provider: "MANUAL", level: "LIST", address: `totd-free-${suffix}@spy.test`, listId: free.id, publisherId: mta.id, publicationId: totd.id } });
    await tx.ispyRoutingRule.create({ data: { publisherId: mta.id, priority: 10, conditions: [{ field: "fromAddress", op: "equals", value: `editor@tradeoftheday-${suffix}.com` }], listId: free.id } });
    Object.assign(ids, { mta: mta.id, totd: totd.id, free: free.id, stans: stans.id, mb: mb.id, mbList: mbList.id, legacy: legacy.id, seed: seed.id, listInbox: listInbox.id });
  });
  Object.assign(ids, { plan: plan.id, org: org.id, brand: brand.id });
});

afterAll(async () => {
  await ispyDb(async (tx) => {
    const emailIds = (await tx.ispyEmail.findMany({ where: { receivedInboxId: { in: [ids.legacy, ids.seed, ids.listInbox] } }, select: { id: true, copyId: true } }));
    await tx.ispyEmail.deleteMany({ where: { id: { in: emailIds.map((e) => e.id) } } });
    await tx.ispyCopy.deleteMany({ where: { id: { in: emailIds.map((e) => e.copyId).filter((x): x is string => !!x) } } });
    await tx.ispyListCandidate.deleteMany({ where: { publisherId: { in: [ids.mta, ids.stans, ids.mb] } } });
    await tx.ispyInbox.deleteMany({ where: { OR: [{ id: { in: [ids.legacy, ids.seed, ids.listInbox] } }, { publisherId: { in: [ids.mta, ids.mb] } }] } });
    await tx.ispyPublisher.deleteMany({ where: { id: { in: [ids.mta, ids.stans, ids.mb] } } });
  });
  await db.organization.deleteMany({ where: { id: ids.org } });
  await db.plan.deleteMany({ where: { id: ids.plan } });
});

describe("ISpy shared data", () => {
  it("tenant clients cannot reach ISpy tables", async () => {
    await expect((tenantDb(ids.org) as unknown as { ispyEmail: { findMany: () => Promise<unknown> } }).ispyEmail.findMany()).rejects.toThrow(TenantIsolationError);
  });

  it("routes by rule, moves mail to the list inbox, and recognises the same copy on an affiliate", async () => {
    const first = await ingestAndProcess([{ raw: eml({ from: `editor@tradeoftheday-${suffix}.com`, to: `legacy-${suffix}@gmail.com`, subject: "Last chance: Bull Run Bonanza", body: BODY, id: "a" }), inboxId: ids.legacy }]);
    expect(first.added).toBe(1);
    const second = await ingestAndProcess([{ raw: eml({ from: `offers@marketbeat-${suffix}.com`, to: `seed-${suffix}@gmail.com`, subject: "Did you see this?", body: `Hi Jane,\n${BODY}`, id: "b", date: "Fri, 27 Nov 2026 10:00:00 +0000" }), inboxId: ids.seed }]);
    expect(second.added).toBe(1);
    const dup = await ingestAndProcess([{ raw: eml({ from: `editor@tradeoftheday-${suffix}.com`, to: `legacy-${suffix}@gmail.com`, subject: "Last chance: Bull Run Bonanza", body: BODY, id: "a" }), inboxId: ids.legacy }]);
    expect(dup.duplicates).toBe(1);

    const emails = await ispyDb((tx) => tx.ispyEmail.findMany({ where: { receivedInboxId: { in: [ids.legacy, ids.seed] } }, orderBy: { receivedAt: "asc" } }));
    expect(emails).toHaveLength(2);
    expect(emails[0]!.listId).toBe(ids.free);
    expect(emails[0]!.inboxId).toBe(ids.listInbox);
    expect(emails[0]!.sendKind).toBe("INTERNAL");
    expect(emails[1]!.sendKind).toBe("AFFILIATE");
    expect(emails[1]!.listId).toBe(ids.mbList);
    expect(emails[0]!.copyId).toBe(emails[1]!.copyId);
    const copy = await ispyDb((tx) => tx.ispyCopy.findUnique({ where: { id: emails[0]!.copyId! } }));
    expect(copy).toMatchObject({ sendCount: 2, subjectCount: 2, firstSeenKind: "INTERNAL", affiliateCount: 1 });
  });

  it("an internal copy teaches the linked brand's Brain", async () => {
    const email = await ispyDb((tx) => tx.ispyEmail.findFirst({ where: { receivedInboxId: ids.legacy } }));
    const note = await tenantDb(ids.org).knowledgePage.findFirst({ where: { sourceRef: `ispy-copy:${email!.copyId}` } });
    expect(note?.body).toContain("## Sends");
    expect(note?.body).toContain("affiliate");
  });

  it("the feed is relative to the viewer, sortable and filterable by linked dropdowns", async () => {
    const viewer = { orgId: ids.org, feeds: ["FINPUB" as const] };
    const counts = await feedCounts(viewer, { publisherId: undefined });
    expect(counts.INTERNAL).toBeGreaterThanOrEqual(1);
    const internal = await listFeed(viewer, { kind: "INTERNAL", publisherId: ids.mta });
    expect(internal.rows.map((r) => r.subject)).toEqual(["Last chance: Bull Run Bonanza"]);
    expect(internal.rows[0]!.seen).toBe(2);
    const affiliate = await listFeed(viewer, { kind: "AFFILIATE", listId: ids.mbList, sort: "seen" });
    expect(affiliate.rows[0]!.reuse).toContain("first sent internal");
    const other = await listFeed({ orgId: null, feeds: ["FINPUB"] }, { kind: "INTERNAL", publisherId: ids.mta });
    expect(other.total).toBe(1);
    const facets = await feedFacets(viewer, { publicationId: ids.totd });
    expect(facets.lists.map((l) => l.id)).toEqual([ids.free]);
    const copy = await getCopy(viewer, internal.rows[0]!.copyId!);
    expect(copy?.sends.map((s) => s.newSubject)).toEqual([false, true]);
  });

  it("an unknown list waits for approval; approving creates the list, its rule and inbox, and moves the mail", async () => {
    const html = `<html><head><title>Inner Circle Alerts</title></head><body><p>${BODY.replace(/\n/g, "<br>")} vip</p></body></html>`;
    await ingestAndProcess([{ raw: eml({ from: `vip@tradeoftheday-${suffix}.com`, to: `legacy-${suffix}@gmail.com`, subject: "Monday trade", body: `${BODY} vip`, id: "c", html }), inboxId: ids.legacy }]);
    const candidate = await ispyDb((tx) => tx.ispyListCandidate.findFirst({ where: { publisherId: ids.mta, status: "PENDING" } }));
    expect(candidate?.proposedName).toBe("Inner Circle Alerts");
    const preview = await previewRuleOnRecent({ conditions: [{ field: "fromAddress", op: "equals", value: `vip@tradeoftheday-${suffix}.com` }], action: "ROUTE", listId: null, publisherId: ids.mta, publicationId: null });
    expect(preview.matched).toBe(1);
    const approved = await approveCandidate({ candidateId: candidate!.id, name: "Inner Circle", category: "PAID_EDITORIAL", conditions: [{ field: "fromAddress", op: "equals", value: `vip@tradeoftheday-${suffix}.com` }], actorId: ids.org, createListInbox: true });
    expect("error" in approved).toBe(false);
    if ("error" in approved) return;
    expect(approved.moved).toBe(1);
    expect(approved.inbox).toMatch(/^inner-circle(-\d+)?@spy\.test$/);
    const email = await ispyDb((tx) => tx.ispyEmail.findFirst({ where: { subject: "Monday trade", receivedInboxId: ids.legacy } }));
    expect(email?.listId).toBe(approved.listId);
    expect(email?.routeStatus).toBe("ROUTED");
  });
});
