import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawPrisma, tenantDb } from "@pubcommand/db";
import { defaultEmails } from "../../../../../modules/funnels/emails";
import { miniblogCalendarStatus } from "@/jobs/miniblog-calendar-status";
import { runRemindersForOrg, unsubscribeOptin } from "./emails";

/**
 * The reminders job and the Mini-Blog calendar job against the local database:
 * due reminders are recorded once (email is "logged" without RESEND_API_KEY),
 * never twice, never to someone who unsubscribed; a scheduled post's calendar
 * issue flips to Sent once it is live.
 */
describe("scheduled jobs (database)", () => {
  const db = rawPrisma();
  const suffix = randomBytes(4).toString("hex");
  const ids = { org: "", plan: "" };
  const start = new Date(Date.now() + 60 * 60_000 + 2 * 60_000); // a session 1h02m from now

  beforeAll(async () => {
    delete process.env.RESEND_API_KEY;
    execSync("pnpm exec prisma migrate deploy --schema prisma/schema", {
      cwd: new URL("../../../../../packages/db", import.meta.url).pathname,
      env: process.env,
      stdio: "ignore",
    });
    const plan = await db.plan.create({ data: { key: `funnels-${suffix}`, name: "Funnels test", seatLimit: 5, monthlyPriceCents: 0 } });
    const org = await db.organization.create({ data: { name: `Funnels ${suffix}`, slug: `funnels-${suffix}`, planId: plan.id, seatLimit: 5 } });
    Object.assign(ids, { org: org.id, plan: plan.id });
  });

  afterAll(async () => {
    if (ids.org) await db.organization.deleteMany({ where: { id: ids.org } });
    if (ids.plan) await db.plan.deleteMany({ where: { id: ids.plan } });
  });

  it("sends each due reminder once, and skips the unsubscribed and late sign-ups", async () => {
    const t = tenantDb(ids.org);
    const brand = await t.brand.create({ data: { organizationId: ids.org, name: "Brand", slug: `b-${suffix}` } });
    const funnel = await t.funnel.create({ data: { organizationId: ids.org, brandId: brand.id, name: "Live launch", slug: `launch-${suffix}`, mode: "live", status: "published" } });
    await t.funnelDay.create({ data: { organizationId: ids.org, funnelId: funnel.id, position: 1, title: "Kickoff", unlockKey: "k1", isLive: true, liveStartAt: start } });
    for (const email of defaultEmails(true)) await t.funnelEmail.create({ data: { organizationId: ids.org, funnelId: funnel.id, ...email } });
    const old = new Date(Date.now() - 3 * 86_400_000);
    const keep = await t.funnelOptin.create({ data: { organizationId: ids.org, funnelId: funnel.id, email: "keep@example.test", consentText: "ok", createdAt: old } });
    const gone = await t.funnelOptin.create({ data: { organizationId: ids.org, funnelId: funnel.id, email: "gone@example.test", consentText: "ok", createdAt: old } });
    await unsubscribeOptin(ids.org, funnel.id, gone.id);

    // Five minutes from now the 1-hour reminder is due (sent at start - 60 min).
    const now = new Date(start.getTime() - 59 * 60_000);
    const late = await t.funnelOptin.create({ data: { organizationId: ids.org, funnelId: funnel.id, email: "late@example.test", consentText: "ok", createdAt: new Date(now.getTime() - 30_000) } });
    const first = await runRemindersForOrg(ids.org, `funnels-${suffix}`, now, 100);
    expect(first).toMatchObject({ funnels: 1, due: 1, logged: 1, sent: 0 });
    const sends = await t.funnelEmailSend.findMany({ where: { funnelId: funnel.id } });
    expect(sends.map((row) => [row.optinId, row.status, row.sessionKey !== ""])).toEqual([[keep.id, "logged", true]]);
    expect(sends.some((row) => row.optinId === late.id || row.optinId === gone.id)).toBe(false);

    const again = await runRemindersForOrg(ids.org, `funnels-${suffix}`, now, 100);
    expect(again).toMatchObject({ due: 0, logged: 0 });
  });

  it("marks a scheduled Mini-Blog post's calendar issue Sent once it is live", async () => {
    const t = tenantDb(ids.org);
    const brand = (await t.brand.findFirst({ where: { slug: `b-${suffix}` } }))!;
    const site = await t.textSite.create({ data: { organizationId: ids.org, brandId: brand.id, name: "Alerts", slug: `alerts-${suffix}` } });
    const liveIssue = await t.calendarIssue.create({ data: { organizationId: ids.org, brandId: brand.id, publicationCode: "TL", title: "Live", status: "Scheduled" } });
    const futureIssue = await t.calendarIssue.create({ data: { organizationId: ids.org, brandId: brand.id, publicationCode: "TL", title: "Later", status: "Scheduled" } });
    const handIssue = await t.calendarIssue.create({ data: { organizationId: ids.org, brandId: brand.id, publicationCode: "TL", title: "Hand", status: "Cancelled" } });
    const past = new Date(Date.now() - 60_000);
    await t.textPost.create({ data: { organizationId: ids.org, siteId: site.id, title: "Live", slug: "live", status: "published", publishAt: past, calendarIssueId: liveIssue.id } });
    await t.textPost.create({ data: { organizationId: ids.org, siteId: site.id, title: "Later", slug: "later", status: "published", publishAt: new Date(Date.now() + 86_400_000), calendarIssueId: futureIssue.id } });
    await t.textPost.create({ data: { organizationId: ids.org, siteId: site.id, title: "Hand", slug: "hand", status: "published", publishAt: past, calendarIssueId: handIssue.id } });
    await miniblogCalendarStatus.run({ scheduledFor: new Date(), trigger: "manual", log: () => undefined });
    const statuses = Object.fromEntries((await t.calendarIssue.findMany({ where: { id: { in: [liveIssue.id, futureIssue.id, handIssue.id] } } })).map((row) => [row.title, row.status]));
    expect(statuses).toEqual({ Live: "Sent", Later: "Scheduled", Hand: "Cancelled" });
  });
});
