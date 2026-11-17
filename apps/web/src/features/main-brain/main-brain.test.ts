import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawPrisma, tenantDb } from "@pubcommand/db";
import { learnedKey } from "../../../../../modules/knowledge/main-brain";
import { brandScope, BEST_PRACTICE_FOLDER, BEST_PRACTICE_SOURCE, scopeWhere } from "../../../../../modules/knowledge/visibility";
import { writeVaultZip } from "../../../../../modules/knowledge/zip";
import { runAsk } from "../brain/ask";
import { searchNotes } from "../brain/search";
import { teachBrain } from "../brain/teach";
import { planFromZip, runVaultImport } from "../brain/vault-import";
import { mainBrain } from "./db";
import { planMainFromZip, runMainVaultImport } from "./import";
import { learnUpBackfill } from "./learn";
import { listMainBrainNotesByEntity, searchMainNotes } from "./notes";
import { syncPushDown } from "./push";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/pubcommand";

const db = rawPrisma();
const suffix = randomBytes(4).toString("hex");
const word = `quokkaword${suffix}`;
const ids = { org: "", other: "", a: "", b: "", c: "" };

beforeAll(async () => {
  execSync("pnpm exec prisma migrate deploy --schema prisma/schema", {
    cwd: new URL("../../../../../packages/db", import.meta.url).pathname,
    env: process.env,
    stdio: "ignore",
  });
  const plan = await db.plan.create({ data: { key: `mb-${suffix}`, name: "Main Brain test", seatLimit: 5, monthlyPriceCents: 0 } });
  const org = await db.organization.create({ data: { name: `MB ${suffix}`, slug: `mb-${suffix}`, planId: plan.id, seatLimit: 5 } });
  const other = await db.organization.create({ data: { name: `MB other ${suffix}`, slug: `mb-other-${suffix}`, planId: plan.id, seatLimit: 5 } });
  const a = await db.brand.create({ data: { organizationId: org.id, name: "Brand A", slug: `a-${suffix}` } });
  const b = await db.brand.create({ data: { organizationId: org.id, name: "Brand B", slug: `b-${suffix}` } });
  const c = await db.brand.create({ data: { organizationId: other.id, name: "Brand C", slug: `c-${suffix}` } });
  Object.assign(ids, { org: org.id, other: other.id, a: a.id, b: b.id, c: c.id });
});

afterAll(async () => {
  await mainBrain(async (tx) => {
    await tx.mainBrainNote.deleteMany({ where: { OR: [{ originOrganizationId: { in: [ids.org, ids.other] } }, { key: { contains: suffix } }, { title: { contains: suffix } }] } });
    await tx.mainBrainImport.deleteMany({ where: { filename: { contains: suffix } } });
  });
  await db.organization.deleteMany({ where: { id: { in: [ids.org, ids.other].filter(Boolean) } } });
  await db.plan.deleteMany({ where: { key: `mb-${suffix}` } });
});

const mainByKey = (key: string) => mainBrain((tx) => tx.mainBrainNote.findUnique({ where: { key } }));

describe("learning up (teach → brand Brain + main Brain)", () => {
  it("a promo taught to a brand reaches its Brain and the main Brain with provenance", async () => {
    await teachBrain({
      organizationId: ids.org,
      brandId: ids.a,
      sourceRef: `promo:${suffix}`,
      title: `Promo analysis ${suffix}`,
      body: `The ${word} lead worked.`,
      folder: "Promo Analyzer",
      source: "promo-analyzer",
      actorId: null,
    });
    const mini = await tenantDb(ids.org).knowledgePage.findFirst({ where: { sourceRef: `promo:${suffix}` } });
    expect(mini).toMatchObject({ brandId: ids.a, source: "promo-analyzer", folder: "Promo Analyzer" });
    const main = await mainByKey(learnedKey(ids.org, `promo:${suffix}`));
    expect(main).toMatchObject({
      origin: "LEARNED",
      source: "promo-analyzer",
      originOrganizationId: ids.org,
      originBrandId: ids.a,
      originSourceRef: `promo:${suffix}`,
      originNoteId: mini!.id,
      body: `The ${word} lead worked.`,
    });
  });

  it("a calendar issue re-saved updates both copies, never duplicates", async () => {
    const teach = (body: string) =>
      teachBrain({ organizationId: ids.org, brandId: ids.b, sourceRef: `calendar-issue:${suffix}`, title: `Issue ${suffix}`, body, folder: "Marketing Calendar/Issues", source: "marketing-calendar", actorId: null });
    await teach("first");
    await teach("second");
    expect(await tenantDb(ids.org).knowledgePage.count({ where: { sourceRef: `calendar-issue:${suffix}` } })).toBe(1);
    const main = await mainBrain((tx) => tx.mainBrainNote.findMany({ where: { key: learnedKey(ids.org, `calendar-issue:${suffix}`) } }));
    expect(main).toHaveLength(1);
    expect(main[0]).toMatchObject({ body: "second", originBrandId: ids.b, source: "marketing-calendar" });
  });

  it("a staff edit wins over later app writes", async () => {
    const key = learnedKey(ids.org, `calendar-issue:${suffix}`);
    await mainBrain((tx) => tx.mainBrainNote.update({ where: { key }, data: { body: "staff version", editedAt: new Date() } }));
    await teachBrain({ organizationId: ids.org, brandId: ids.b, sourceRef: `calendar-issue:${suffix}`, title: `Issue ${suffix}`, body: "third", source: "marketing-calendar", actorId: null });
    expect((await mainByKey(key))?.body).toBe("staff version");
    expect((await tenantDb(ids.org).knowledgePage.findFirst({ where: { sourceRef: `calendar-issue:${suffix}` } }))?.body).toBe("third");
  });

  it("brandId null teaches only the main Brain (nothing lands in the organization)", async () => {
    await teachBrain({ organizationId: ids.org, brandId: null, visibility: "SHARED", sourceRef: `promo-lesson:${suffix}`, title: `Lesson ${suffix}`, body: `${word} lesson`, source: "promo-analyzer", actorId: null });
    expect(await tenantDb(ids.org).knowledgePage.count({ where: { sourceRef: `promo-lesson:${suffix}` } })).toBe(0);
    expect(await mainByKey(learnedKey(ids.org, `promo-lesson:${suffix}`))).toMatchObject({ originBrandId: null, origin: "LEARNED" });
  });

  it("the backfill job learns notes taught before learning-up existed, once", async () => {
    await tenantDb(ids.org).knowledgePage.create({
      data: { organizationId: ids.org, brandId: ids.a, title: `Old chart ${suffix}`, slug: `old-chart-${suffix}`, body: "old", source: "charts", sourceRef: `chart:${suffix}` },
    });
    const first = await learnUpBackfill({ organizationIds: [ids.org] });
    expect(first.created).toBeGreaterThanOrEqual(1);
    expect(await mainByKey(learnedKey(ids.org, `chart:${suffix}`))).toMatchObject({ originBrandId: ids.a, source: "charts" });
    const second = await learnUpBackfill({ organizationIds: [ids.org] });
    expect(second.created).toBe(0);
    expect(second.refreshed).toBe(0);
  });
});

describe("an organization can never read the main Brain", () => {
  it("the tenant client has no main-Brain models", async () => {
    const tenant = tenantDb(ids.org) as unknown as Record<string, { findMany?: (args?: unknown) => Promise<unknown> }>;
    await expect(tenant.mainBrainNote!.findMany!()).rejects.toThrow(/not available on the tenant client/);
    await expect(tenant.mainBrainAttachment!.findMany!()).rejects.toThrow(/not available on the tenant client/);
    await expect(tenant.mainBrainQuestion!.findMany!()).rejects.toThrow(/not available on the tenant client/);
  });

  it("row-level security hides main-Brain rows from an organization context, even in raw SQL", async () => {
    await db.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pubcommand_brain_test') THEN CREATE ROLE pubcommand_brain_test NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$;`);
    await db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO pubcommand_brain_test`);
    await db.$executeRawUnsafe(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO pubcommand_brain_test`);
    await db.$executeRawUnsafe(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO pubcommand_brain_test`);
    const count = (bypass: boolean) =>
      db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE pubcommand_brain_test`);
        await tx.$executeRaw`SELECT set_config('app.current_org_id', ${ids.org}, true)`;
        if (bypass) await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
        const rows = await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM main_brain_notes WHERE origin_organization_id = $1::uuid`, ids.org);
        return Number(rows[0]?.n ?? 0);
      });
    expect(await count(false)).toBe(0);
    expect(await count(true)).toBeGreaterThan(0);
  });

  it("brand search and Ask never use main-Brain notes", async () => {
    await mainBrain((tx) =>
      tx.mainBrainNote.create({ data: { key: `note:${suffix}`, title: `Platform only ${suffix}`, slug: `platform-only-${suffix}`, body: `zzmainonly${suffix} secret playbook`, origin: "AUTHORED", source: "staff" } }),
    );
    expect(await searchMainNotes({ query: `zzmainonly${suffix}` })).toHaveLength(1);
    for (const brandId of [ids.a, ids.b]) {
      expect(await searchNotes({ organizationId: ids.org, scope: brandScope(brandId), query: `zzmainonly${suffix}` })).toEqual([]);
    }
    const q = await tenantDb(ids.org).knowledgeQuestion.create({ data: { organizationId: ids.org, brandId: ids.a, question: `zzmainonly${suffix} playbook?`, status: "QUEUED" } });
    await runAsk({ organizationId: ids.org, questionId: q.id, scope: brandScope(ids.a), scopeLabel: "Brand A Brain", brandContext: "x", brandNames: new Map(), actorId: null });
    const answered = await tenantDb(ids.org).knowledgeQuestion.findFirst({ where: { id: q.id } });
    expect(answered?.status).toBe("DONE");
    expect(JSON.stringify(answered?.answer)).not.toMatch(/platform only|main brain/i);
    expect((answered?.answer as { consideredIds: string[] }).consideredIds).toEqual([]);
  });
});

describe("push down", () => {
  let noteId = "";
  const copies = (orgId: string) => tenantDb(orgId).knowledgePage.findMany({ where: { source: BEST_PRACTICE_SOURCE, deletedAt: null, sourceRef: { contains: noteId } }, include: { attachments: true } });

  afterAll(async () => {
    // "All brands" also reached brands outside this test; remove those copies for good.
    if (noteId) await db.knowledgePage.deleteMany({ where: { source: BEST_PRACTICE_SOURCE, sourceRef: { contains: noteId } } });
  });

  beforeAll(async () => {
    const note = await mainBrain(async (tx) => {
      const created = await tx.mainBrainNote.create({
        data: { key: `note:push-${suffix}`, title: `Headline rules ${suffix}`, slug: `headline-rules-${suffix}`, body: "Use the 4 U's.\n\n![[rule.png]]", origin: "AUTHORED", source: "staff", pushScope: "SELECTED", pushedAt: new Date() },
      });
      await tx.mainBrainPushTarget.create({ data: { noteId: created.id, brandId: ids.a, targetOrganizationId: ids.org } });
      await tx.mainBrainAttachment.create({ data: { noteId: created.id, filename: "rule.png", contentType: "image/png", size: 4, data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) } });
      return created;
    });
    noteId = note.id;
  });

  it("reaches only the chosen brands, as an ordinary read-only note", async () => {
    await syncPushDown({ noteIds: [noteId] });
    const inOrg = await copies(ids.org);
    expect(inOrg.map((row) => row.brandId)).toEqual([ids.a]);
    expect(inOrg[0]).toMatchObject({ folder: BEST_PRACTICE_FOLDER, visibility: "PRIVATE", title: `Headline rules ${suffix}` });
    expect(inOrg[0]?.attachments.map((file) => file.filename)).toEqual(["rule.png"]);
    expect(await copies(ids.other)).toEqual([]);
    const seenByB = await tenantDb(ids.org).knowledgePage.findMany({ where: { AND: [scopeWhere(brandScope(ids.b)), { title: `Headline rules ${suffix}` }] } });
    expect(seenByB).toEqual([]);
    // Nothing in the copy names the platform Brain.
    expect(JSON.stringify(inOrg[0])).not.toMatch(/main brain|master|platform/i);
  });

  it("is idempotent, follows edits, then all brands, then withdrawal", async () => {
    const again = await syncPushDown({ noteIds: [noteId] });
    expect(again.created + again.updated).toBe(0);
    await mainBrain((tx) => tx.mainBrainNote.update({ where: { id: noteId }, data: { body: "Use the 4 U's. Updated." } }));
    expect((await syncPushDown({ noteIds: [noteId] })).updated).toBe(1);
    await mainBrain((tx) => tx.mainBrainNote.update({ where: { id: noteId }, data: { pushScope: "ALL" } }));
    await syncPushDown({ noteIds: [noteId] });
    expect((await copies(ids.org)).map((row) => row.brandId).sort()).toEqual([ids.a, ids.b].sort());
    expect((await copies(ids.other)).map((row) => row.brandId)).toEqual([ids.c]);
    await mainBrain((tx) => tx.mainBrainNote.update({ where: { id: noteId }, data: { pushScope: "NONE" } }));
    const removed = await syncPushDown({ noteIds: [noteId] });
    // ALL reached every brand on this database (at least these three).
    expect(removed.removed).toBeGreaterThanOrEqual(3);
    expect(await copies(ids.org)).toEqual([]);
  });
});

describe("vault imports are idempotent in both destinations", () => {
  const zip = () =>
    writeVaultZip([
      { path: `Copy/Headlines ${suffix}.md`, text: "# Headlines\nSee [[Leads]]" },
      { path: `Copy/Leads ${suffix}.md`, text: "Story leads" },
      { path: "Inbox/skip.txt", text: "not markdown" },
    ]);

  it("main Brain: second import changes nothing", async () => {
    const first = await planMainFromZip(zip());
    expect(first.ok && first.report.create).toBe(2);
    const job = await mainBrain((tx) => tx.mainBrainImport.create({ data: { filename: `main-${suffix}.zip`, size: 1, data: zip(), status: "QUEUED" } }));
    await runMainVaultImport({ importId: job.id, actorId: null });
    const done = await mainBrain((tx) => tx.mainBrainImport.findUnique({ where: { id: job.id } }));
    expect(done?.status).toBe("DONE");
    const second = await planMainFromZip(zip());
    expect(second.ok && second.report).toMatchObject({ create: 0, update: 0, unchanged: 2 });
    expect(await mainBrain((tx) => tx.mainBrainNote.count({ where: { key: `vault:Copy/Headlines ${suffix}.md` } }))).toBe(1);
  });

  it("brand Brain: second import changes nothing, and never lands in the main Brain", async () => {
    const job = await tenantDb(ids.org).knowledgeImport.create({ data: { organizationId: ids.org, brandId: ids.b, filename: `brand-${suffix}.zip`, size: 1, data: zip(), status: "QUEUED" } });
    await runVaultImport({ organizationId: ids.org, importId: job.id, actorId: null });
    expect(await tenantDb(ids.org).knowledgePage.count({ where: { brandId: ids.b, source: "vault-import" } })).toBe(2);
    const second = await planFromZip(ids.org, zip(), ids.b);
    expect(second.ok && second.report).toMatchObject({ create: 0, update: 0, unchanged: 2 });
    // Imports are member content: they do not learn up.
    expect(await mainBrain((tx) => tx.mainBrainNote.count({ where: { originOrganizationId: ids.org, source: "vault-import" } }))).toBe(0);
  });
});

describe("migration of old organization-level notes", () => {
  const sql = readFileSync(new URL("../../../../../packages/db/prisma/schema/migrations/20261117123153_brain_main_brain_platform/migration.sql", import.meta.url), "utf8");
  const start = sql.indexOf("WITH legacy AS");
  const end = sql.indexOf("-- ---------------------------------------------------------------------------\n-- Row-level security.");
  const dataSql = sql.slice(start, end);

  it("copies brandId-null rows into the main Brain, verifies, then marks them, and is safe to re-run", async () => {
    expect(start).toBeGreaterThan(0);
    const db0 = tenantDb(ids.other);
    await db0.knowledgePage.create({ data: { organizationId: ids.other, brandId: null, title: `Legacy ${suffix}`, slug: `legacy-${suffix}`, body: "old main note", visibility: "SHARED", source: "vault-import", sourceRef: `vault:Old/${suffix}.md` } });
    const statements = dataSql.split(/;\s*\n/).map((part) => part.trim()).filter((part) => part && !part.split("\n").every((line) => line.startsWith("--")));
    const runAll = () => mainBrain(async (tx) => {
      for (const statement of statements) await tx.$executeRawUnsafe(statement);
    });
    await runAll();
    await runAll();
    const copies = await mainBrain((tx) => tx.mainBrainNote.findMany({ where: { originOrganizationId: ids.other, origin: "MIGRATED" } }));
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ key: `vault:Old/${suffix}.md`, title: `Legacy ${suffix}`, body: "old main note", originSourceRef: `vault:Old/${suffix}.md` });
    expect(copies[0]?.originMeta).toMatchObject({ visibility: "SHARED" });
    const original = await db0.knowledgePage.findFirst({ where: { slug: `legacy-${suffix}` } });
    expect(original).toMatchObject({ visibility: "PRIVATE", sourceRef: `legacy:vault:Old/${suffix}.md`, body: "old main note" });
    expect(original?.movedToMainAt).toBeInstanceOf(Date);
    // Still invisible to every brand.
    expect(await searchNotes({ organizationId: ids.other, scope: brandScope(ids.c), query: "old main note" })).toEqual([]);
  });
});

describe("conflict-review hook", () => {
  it("lists main-Brain notes about an entity, strongest first", async () => {
    await mainBrain(async (tx) => {
      await tx.mainBrainNote.create({ data: { key: `note:e1-${suffix}`, title: `Jane Roe${suffix}`, slug: `e1-${suffix}`, body: "bio", origin: "AUTHORED", source: "staff" } });
      await tx.mainBrainNote.create({ data: { key: `note:e2-${suffix}`, title: `Jane Roe${suffix} — Facts`, slug: `e2-${suffix}`, body: "facts", origin: "AUTHORED", source: "staff" } });
      await tx.mainBrainNote.create({ data: { key: `note:e3-${suffix}`, title: `Lessons ${suffix}`, slug: `e3-${suffix}`, body: `As Jane Roe${suffix} says`, origin: "AUTHORED", source: "staff" } });
    });
    const rows = await listMainBrainNotesByEntity(`Jane Roe${suffix}`);
    expect(rows.map((row) => [row.title, row.strength])).toEqual([
      [`Jane Roe${suffix}`, 3],
      [`Jane Roe${suffix} — Facts`, 2],
      [`Lessons ${suffix}`, 1],
    ]);
  });
});
