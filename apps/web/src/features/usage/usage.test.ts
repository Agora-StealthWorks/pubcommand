import { execSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendOrgAudit, platformTx, rawPrisma, tenantDb } from "@pubcommand/db";
import { captureActivities, snapshotTarget } from "./capture";
import { addDays, nyDay, nyMidnight, writeDailyInsight } from "./insights";
import { saveOpsNote, searchOpsNotes, upsertGeneratedOpsNote } from "./ops-brain";
import { recordHeartbeat } from "./record";
import { docNote, referenceDocs, repoRoot, syncReference } from "./reference";
import { appUsage, recentActivities, topUsers, usageOverview, userUsage } from "./stats";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/pubcommand";
delete process.env.ANTHROPIC_API_KEY;

const db = rawPrisma();
const suffix = randomBytes(4).toString("hex");
const ids = { plan: "", org: "", brand: "", user: "", form: "" };

beforeAll(async () => {
  execSync("pnpm exec prisma migrate deploy --schema prisma/schema", {
    cwd: new URL("../../../../../packages/db", import.meta.url).pathname,
    env: process.env,
    stdio: "ignore",
  });
  const plan = await db.plan.create({ data: { key: `usage-${suffix}`, name: "Usage test", seatLimit: 5, monthlyPriceCents: 0 } });
  const org = await db.organization.create({ data: { name: `Usage Gazette ${suffix}`, slug: `usage-${suffix}`, planId: plan.id, seatLimit: 5 } });
  const brand = await db.brand.create({ data: { organizationId: org.id, name: "Brand", slug: `b-${suffix}` } });
  const user = await db.user.create({ data: { email: `usage-${suffix}@example.com`, name: "Pat Writer" } });
  const formId = randomUUID();
  await tenantDb(org.id).form.create({
    data: {
      id: formId,
      organizationId: org.id,
      brandId: brand.id,
      title: `Free Retirement Guide ${suffix}`,
      slug: `guide-${suffix}`,
      description: "<p>The <b>3 moves</b> to make before 2027.</p>",
    } as never,
  });
  await tenantDb(org.id).formField.create({
    data: { id: randomUUID(), organizationId: org.id, formId, position: 0, type: "short_text", label: "Your first name", placeholder: "Jane" } as never,
  });
  await tenantDb(org.id).formField.create({
    data: { id: randomUUID(), organizationId: org.id, formId, position: 1, type: "email", label: "Where should we send the guide?" } as never,
  });
  Object.assign(ids, { plan: plan.id, org: org.id, brand: brand.id, user: user.id, form: formId });
});

afterAll(async () => {
  await platformTx(async (tx) => {
    await tx.usageActivity.deleteMany({ where: { orgId: ids.org } });
    await tx.usageDaily.deleteMany({ where: { userId: ids.user } });
    await tx.usageLogin.deleteMany({ where: { userId: ids.user } });
    await tx.opsBrainNote.deleteMany({ where: { OR: [{ title: { contains: suffix } }, { body: { contains: suffix } }] } });
  });
  await db.organization.deleteMany({ where: { id: ids.org } });
  await db.user.deleteMany({ where: { id: ids.user } });
  await db.plan.deleteMany({ where: { id: ids.plan } });
});

describe("what people made", () => {
  it("snapshots a form with its field labels", async () => {
    const snap = await snapshotTarget("form", ids.form);
    expect(snap.title).toBe(`Free Retirement Guide ${suffix}`);
    expect(snap.content).toContain("The 3 moves to make before 2027.");
    expect(snap.content).toContain("Your first name");
    expect(snap.content).toContain("Where should we send the guide?");
  });

  it("never reads private targets", async () => {
    expect(await snapshotTarget("user", ids.user)).toEqual({ title: null, content: null });
    expect(await snapshotTarget("form", "not-an-id")).toEqual({ title: null, content: null });
  });

  it("captures audit entries once, with the copy", async () => {
    await appendOrgAudit(ids.org, { actorId: ids.user, action: "forms.form.created", targetType: "form", targetId: ids.form });
    await captureActivities();
    await captureActivities();
    const rows = await platformTx((tx) => tx.usageActivity.findMany({ where: { orgId: ids.org } }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ app: "forms", verb: "created", actorKind: "member", title: `Free Retirement Guide ${suffix}` });
    expect(rows[0]!.summary).toBe(`created form "Free Retirement Guide ${suffix}"`);
    expect(rows[0]!.content).toContain("Your first name");
    const feed = await recentActivities({ orgId: ids.org, query: "retirement" });
    expect(feed[0]?.who).toContain("Pat Writer");
  });
});

describe("time and sign-ins", () => {
  it("adds heartbeats into one daily row per page area", async () => {
    await recordHeartbeat({ userId: ids.user, site: ids.org, orgId: ids.org, beat: { path: `/forms/${ids.form}/edit`, view: true, activeSeconds: 60, bytes: 1000 } });
    await recordHeartbeat({ userId: ids.user, site: ids.org, orgId: ids.org, beat: { path: `/forms/${ids.form}/edit`, view: false, activeSeconds: 45, bytes: 500 } });
    await recordHeartbeat({ userId: ids.user, site: ids.org, orgId: ids.org, beat: { path: "/mini-blog", view: true, activeSeconds: 15, bytes: 0 } });
    const rows = await platformTx((tx) => tx.usageDaily.findMany({ where: { userId: ids.user }, orderBy: { area: "asc" } }));
    expect(rows.map((row) => [row.app, row.area, row.views, row.activeSeconds, Number(row.bytes)])).toEqual([
      ["forms", "/forms/:id/edit", 1, 105, 1500],
      ["mini-blog", "/mini-blog", 1, 15, 0],
    ]);
    await platformTx((tx) => tx.usageLogin.create({ data: { userId: ids.user, method: "password", site: "org", orgId: ids.org } }));

    const apps = await appUsage(7, { orgId: ids.org });
    expect(apps.find((app) => app.id === "forms")).toMatchObject({ users: 1, views: 1, activeSeconds: 105, actions: 1 });
    const people = await topUsers(7, { orgId: ids.org });
    expect(people[0]).toMatchObject({ userId: ids.user, logins: 1, activeDays: 1, activeSeconds: 120, actions: 1 });
    const overview = await usageOverview(7);
    expect(overview.activeUsers).toBeGreaterThanOrEqual(1);
    expect(overview.series).toHaveLength(7);
    const person = await userUsage(ids.user, 30);
    expect(person).toMatchObject({ loginsAllTime: 1, activeSeconds: 120, idleTimeoutMinutes: null });
  });
});

describe("Operations Brain", () => {
  it("writes a factual daily read without an AI key, and keeps staff edits", async () => {
    // Backdate the activity into yesterday so the daily read sees it.
    const yesterday = addDays(nyDay(new Date()), -1);
    await platformTx((tx) => tx.usageActivity.updateMany({ where: { orgId: ids.org }, data: { createdAt: new Date(nyMidnight(yesterday).getTime() + 3_600_000) } }));
    const result = await writeDailyInsight(yesterday);
    expect(result.ai).toBe("unavailable");
    const note = await platformTx((tx) => tx.opsBrainNote.findUnique({ where: { key: `daily:${yesterday}` } }));
    expect(note?.body).toContain(`Free Retirement Guide ${suffix}`);
    expect(note?.body).toContain("## The numbers");

    const edited = await saveOpsNote({ id: note!.id, title: `${note!.title} ${suffix}`, body: note!.body, actorId: ids.user, source: "staff" });
    expect(edited.source).toBe("staff");
    const again = await upsertGeneratedOpsNote({ key: `daily:${yesterday}`, kind: "daily", title: "x", body: "y", periodStart: new Date(), periodEnd: new Date(), stats: {}, model: null });
    expect(again).toBe("kept");
    const hits = await searchOpsNotes(`retirement ${suffix}`);
    expect(hits.map((hit) => hit.id)).toContain(note!.id);
    await platformTx((tx) => tx.opsBrainNote.delete({ where: { id: note!.id } }));
  });
});

describe("How PubCommand works (reference notes)", () => {
  it("files every doc in a folder, with a start-here index", async () => {
    const root = repoRoot(new URL(".", import.meta.url).pathname)!;
    const docs = referenceDocs(root);
    expect(docs.find((doc) => doc.file === "README.md")?.folder).toBe("Start here");
    expect(docs.find((doc) => doc.file === "docs/USAGE.md")?.folder).toBe("Usage & insights");
    expect(docs.find((doc) => doc.file === "modules/forms/README.md")?.folder).toBe("Apps");
    expect(docs.some((doc) => doc.file.includes("example"))).toBe(false);
    expect(docNote("# Forms\n\nRoute /forms.", { file: "modules/forms/README.md", folder: "Apps" }).title).toBe("Forms");

    await syncReference(root);
    const second = await syncReference(root);
    expect(second.synced + second.updated).toBe(0);
    const notes = await platformTx((tx) => tx.opsBrainNote.findMany({ where: { kind: "reference", deletedAt: null } }));
    const index = notes.find((note) => note.key === "doc:index")!;
    expect(index.folder).toBe("Start here");
    expect(index.body).toContain("[[What PubCommand is]]");
    expect(index.body).toContain("[[Forms]]");
    expect(notes.find((note) => note.key === "doc:docs/USAGE.md")?.title).toBe("Usage");
  });
});
