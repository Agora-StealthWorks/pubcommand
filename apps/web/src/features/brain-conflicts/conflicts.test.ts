import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rawPrisma, tenantDb, tenantModelNames } from "@pubcommand/db";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/pubcommand";
delete process.env.ANTHROPIC_API_KEY;

// Server-action plumbing: a signed-in staff member, redirects as throws, after() collected and awaited by the test.
const pending: (() => Promise<unknown> | unknown)[] = [];
const staffUser = { id: "" };
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => pending.push(fn) }));
vi.mock("../main-brain/staff", () => ({
  brainStaff: async () => ({ userId: staffUser.id, email: "staff@example.com", role: "SUPER_ADMIN" }),
  requireBrainStaff: async () => ({ userId: staffUser.id, email: "staff@example.com", role: "SUPER_ADMIN" }),
}));

const { mainBrain } = await import("../main-brain/db");
const { runMainAsk } = await import("../main-brain/ask");
const { checkEntity, recheckEntities } = await import("./check");
const { loadEntity } = await import("./entities");
const actions = await import("./actions");

const db = rawPrisma();
const suffix = randomBytes(4).toString("hex");
const ids = { org: "", other: "", brand: "", otherBrand: "", pub: "", editor: "", noteA: "", noteB: "", noteOther: "", plan: "" };
const pubName = `Quokka Ledger ${suffix}`;
const editorName = `Ada Quokka${suffix.replace(/\d/g, "x")}`;

async function flush() {
  while (pending.length) await pending.shift()!();
}

async function act(fn: (fd: FormData) => Promise<unknown>, fields: Record<string, string>): Promise<string> {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  try {
    await fn(fd);
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith("REDIRECT ")) return decodeURIComponent(message.slice(9));
    throw error;
  }
  return "";
}

const conflictsOf = (entityId: string) => mainBrain((tx) => tx.mainBrainConflict.findMany({ where: { entityId }, orderBy: { factKey: "asc" } }));
const note = (id: string) => mainBrain((tx) => tx.mainBrainNote.findUniqueOrThrow({ where: { id } }));

beforeAll(async () => {
  execSync("pnpm exec prisma migrate deploy --schema prisma/schema", { cwd: new URL("../../../../../packages/db", import.meta.url).pathname, env: process.env, stdio: "ignore" });
  const plan = await db.plan.create({ data: { key: `cf-${suffix}`, name: "Conflicts test", seatLimit: 5, monthlyPriceCents: 0 } });
  const org = await db.organization.create({ data: { name: `CF ${suffix}`, slug: `cf-${suffix}`, planId: plan.id, seatLimit: 5 } });
  const other = await db.organization.create({ data: { name: `CF other ${suffix}`, slug: `cf-other-${suffix}`, planId: plan.id, seatLimit: 5 } });
  const brand = await db.brand.create({ data: { organizationId: org.id, name: "Ledger Brand", slug: `lb-${suffix}` } });
  const otherBrand = await db.brand.create({ data: { organizationId: other.id, name: "Other Brand", slug: `ob-${suffix}` } });
  const user = await db.user.create({ data: { email: `staff-${suffix}@example.com` } });
  staffUser.id = user.id;
  const t = tenantDb(org.id);
  const pub = await t.calendarPublication.create({
    data: {
      organizationId: org.id,
      brandId: brand.id,
      code: "QKL",
      name: pubName,
      slug: `qkl-${suffix}`,
      frequency: "Weekly",
      status: "active",
      launchDate: new Date("2024-05-01T00:00:00Z"),
      offers: [{ label: "Annual", price: "$49", term: "per year" }],
    },
  });
  const editor = await t.pubEditor.create({ data: { organizationId: org.id, brandId: brand.id, name: editorName, slug: `ada-${suffix}`, title: "Chief Strategist" } });
  await t.pubPublicationEditor.create({ data: { organizationId: org.id, publicationId: pub.id, editorId: editor.id, role: "lead" } });
  const mk = (title: string, body: string, extra: Record<string, unknown> = {}) =>
    mainBrain((tx) => tx.mainBrainNote.create({ data: { key: `note:${suffix}:${title}`, title, slug: `cf-${suffix}-${title.length}-${Math.random().toString(36).slice(2, 7)}`, body, origin: "AUTHORED", source: "staff", ...extra } }));
  const a = await mk(`${pubName} — Facts`, `${pubName} is a daily newsletter.\nAn annual subscription costs $79 per year.\nIt launched in 2019.`);
  const b = await mk(`Editors ${suffix}`, `${editorName}, Senior Analyst, writes for the firm.\nThe ${pubName} (QKL) team meets on Mondays.`);
  const o = await mk(`${pubName} (other publisher)`, `${pubName} is a monthly letter that costs $5 per year.`, { origin: "LEARNED", source: "pubsetup", originOrganizationId: other.id, originBrandId: otherBrand.id });
  Object.assign(ids, { org: org.id, other: other.id, brand: brand.id, otherBrand: otherBrand.id, pub: pub.id, editor: editor.id, noteA: a.id, noteB: b.id, noteOther: o.id, plan: plan.id });
});

afterAll(async () => {
  await mainBrain(async (tx) => {
    await tx.mainBrainNote.deleteMany({ where: { key: { contains: suffix } } });
    await tx.mainBrainQuestion.deleteMany({ where: { question: { contains: suffix } } });
  });
  await db.organization.deleteMany({ where: { id: { in: [ids.org, ids.other].filter(Boolean) } } });
  await db.platformAuditLog.deleteMany({ where: { actorId: staffUser.id } }).catch(() => undefined);
  await db.user.deleteMany({ where: { id: staffUser.id } }).catch(() => undefined);
  await db.plan.deleteMany({ where: { key: `cf-${suffix}` } });
});

describe("detection", () => {
  it("records rule conflicts for a publication, ignores another publisher's note, and says the AI did not run", async () => {
    const summary = await recheckEntities({ organizationId: ids.org });
    expect(summary).toMatchObject({ entities: 2, checked: 2, failed: 0 });
    const rows = await conflictsOf(ids.pub);
    expect(rows.map((r) => r.factKey)).toEqual(["frequency", "launchDate", "offers"]);
    expect(rows.every((r) => r.noteId === ids.noteA && r.status === "OPEN" && r.layer === "rule")).toBe(true);
    expect(rows.find((r) => r.factKey === "offers")).toMatchObject({ noteValue: "$79", suggestedValue: "$49", entityOrganizationId: ids.org, entityBrandId: ids.brand });
    const check = await mainBrain((tx) => tx.mainBrainConflictCheck.findUniqueOrThrow({ where: { entityKind_entityId: { entityKind: "publication", entityId: ids.pub } } }));
    expect(check.aiStatus).toBe("unavailable");
    expect(check.aiReason).toMatch(/deterministic rules/);
    expect(check.noteIds).not.toContain(ids.noteOther);
    expect((await conflictsOf(ids.editor)).map((r) => [r.factKey, r.noteValue])).toEqual([["title", "Senior Analyst"]]);
  });

  it("re-checks only what changed", async () => {
    expect(await recheckEntities({ organizationId: ids.org })).toMatchObject({ checked: 0, unchanged: 2 });
    // A note edit re-checks the entities that note is about (this one names both).
    await mainBrain((tx) => tx.mainBrainNote.update({ where: { id: ids.noteB }, data: { body: `${editorName}, Chief Strategist, writes for the firm.\nThe ${pubName} (QKL) team meets on Mondays.` } }));
    expect(await recheckEntities({ organizationId: ids.org })).toMatchObject({ checked: 2, unchanged: 0, cleared: 1 });
    expect((await conflictsOf(ids.editor))[0]).toMatchObject({ status: "RESOLVED", resolution: "cleared" });
    // A Setup fact change re-checks that entity: frequency now agrees, its conflict clears.
    await tenantDb(ids.org).calendarPublication.updateMany({ where: { id: ids.pub }, data: { frequency: "Daily" } });
    expect(await recheckEntities({ organizationId: ids.org })).toMatchObject({ checked: 1, unchanged: 1 });
    expect((await conflictsOf(ids.pub)).find((r) => r.factKey === "frequency")).toMatchObject({ status: "RESOLVED", resolution: "cleared" });
    await tenantDb(ids.org).calendarPublication.updateMany({ where: { id: ids.pub }, data: { frequency: "Weekly" } });
    await recheckEntities({ organizationId: ids.org });
    expect((await conflictsOf(ids.pub)).find((r) => r.factKey === "frequency")).toMatchObject({ status: "OPEN", resolution: null });
  });
});

describe("rectify", () => {
  const byFact = async (key: string) => (await conflictsOf(ids.pub)).find((r) => r.factKey === key)!;

  it("dismiss persists across re-checks until the note changes", async () => {
    const row = await byFact("launchDate");
    expect(await act(actions.dismissConflict, { conflictId: row.id, reason: "" })).toMatch(/error=Say why/);
    expect(await act(actions.dismissConflict, { conflictId: row.id, reason: "Trial edition in 2019" })).toMatch(/notice=Dismissed/);
    await recheckEntities({ only: { kind: "publication", id: ids.pub }, force: true });
    expect(await byFact("launchDate")).toMatchObject({ status: "DISMISSED", reason: "Trial edition in 2019", resolvedById: staffUser.id });
  });

  it("inline passage edit fixes the note (staff edit wins) and the re-check clears the conflict", async () => {
    const row = await byFact("offers");
    const back = await act(actions.editPassage, { conflictId: row.id, passage: "An annual subscription costs $49 per year." });
    expect(back).toMatch(/notice=Passage corrected/);
    const fixed = await note(ids.noteA);
    expect(fixed.body).toContain("costs $49 per year");
    expect(fixed.body).not.toContain("$79");
    expect(fixed.editedAt).not.toBeNull();
    expect(await byFact("offers")).toMatchObject({ status: "RESOLVED", resolution: "note-edited" });
    await flush(); // the re-check queued by the action
    expect(await byFact("offers")).toMatchObject({ status: "RESOLVED" });
    // The note changed, so the dismissed launch-date conflict comes back.
    expect(await byFact("launchDate")).toMatchObject({ status: "OPEN", resolution: null });
  });

  it("AI rewrite reports unavailable without a key and saves nothing", async () => {
    const row = await byFact("frequency");
    const before = (await note(ids.noteA)).body;
    await act(actions.suggestRewrite, { conflictId: row.id });
    await flush();
    expect((await byFact("frequency")).suggestion).toMatchObject({ status: "unavailable" });
    expect((await note(ids.noteA)).body).toBe(before);
    expect(await act(actions.applyRewrite, { conflictId: row.id, body: "anything" })).toMatch(/error=/);
    expect((await note(ids.noteA)).body).toBe(before);
  });

  it("setup-to-fix stays open, never touches org data", async () => {
    const row = await byFact("frequency");
    await act(actions.markSetupToFix, { conflictId: row.id, reason: "Brain is right" });
    expect(await byFact("frequency")).toMatchObject({ status: "OPEN", resolution: "setup-to-fix" });
    expect((await tenantDb(ids.org).calendarPublication.findFirst({ where: { id: ids.pub } }))?.frequency).toBe("Weekly");
  });

  it("marking the note outdated keeps it, closes its conflicts, and Ask skips it", async () => {
    const row = await byFact("launchDate");
    await act(actions.supersedeNote, { conflictId: row.id, reason: "" });
    expect(await mainBrain((tx) => tx.mainBrainNote.findFirst({ where: { id: ids.noteA, deletedAt: null } }))).not.toBeNull();
    const open = (await conflictsOf(ids.pub)).filter((r) => r.status === "OPEN" && r.noteId === ids.noteA);
    expect(open).toEqual([]);
    const q = await mainBrain((tx) => tx.mainBrainQuestion.create({ data: { question: `${pubName} launched ${suffix}?`, status: "QUEUED" } }));
    await runMainAsk({ questionId: q.id, actorId: null });
    const answered = await mainBrain((tx) => tx.mainBrainQuestion.findUniqueOrThrow({ where: { id: q.id } }));
    expect(JSON.stringify(answered.answer ?? {})).not.toContain(ids.noteA);
    // The next check skips the outdated note entirely.
    await checkEntity((await loadEntity("publication", ids.pub))!, { force: true });
    const check = await mainBrain((tx) => tx.mainBrainConflictCheck.findUniqueOrThrow({ where: { entityKind_entityId: { entityKind: "publication", entityId: ids.pub } } }));
    expect(check.noteIds).not.toContain(ids.noteA);
    await act(actions.restoreNote, { noteId: ids.noteA });
    expect(await mainBrain((tx) => tx.mainBrainNoteFlag.count({ where: { noteId: ids.noteA } }))).toBe(0);
  });
});

describe("the organization side never sees conflicts", () => {
  it("the tenant client has no conflict models", async () => {
    const names = tenantModelNames();
    for (const model of ["MainBrainConflict", "MainBrainConflictCheck", "MainBrainNoteFlag"]) expect(names).not.toContain(model);
    const tenant = tenantDb(ids.org) as unknown as Record<string, { findMany?: (args?: unknown) => Promise<unknown> }>;
    await expect(tenant.mainBrainConflict!.findMany!()).rejects.toThrow(/not available on the tenant client/);
    await expect(tenant.mainBrainConflictCheck!.findMany!()).rejects.toThrow(/not available on the tenant client/);
    await expect(tenant.mainBrainNoteFlag!.findMany!()).rejects.toThrow(/not available on the tenant client/);
  });

  it("row-level security hides conflict rows from an organization context, even in raw SQL", async () => {
    await db.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pubcommand_conflicts_test') THEN CREATE ROLE pubcommand_conflicts_test NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$;`);
    await db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO pubcommand_conflicts_test`);
    await db.$executeRawUnsafe(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO pubcommand_conflicts_test`);
    await db.$executeRawUnsafe(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO pubcommand_conflicts_test`);
    const count = (bypass: boolean) =>
      db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE pubcommand_conflicts_test`);
        await tx.$executeRaw`SELECT set_config('app.current_org_id', ${ids.org}, true)`;
        if (bypass) await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
        const rows = await tx.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT (SELECT count(*) FROM main_brain_conflicts WHERE entity_organization_id = $1::uuid) + (SELECT count(*) FROM main_brain_conflict_checks WHERE entity_organization_id = $1::uuid) AS n`,
          ids.org,
        );
        return Number(rows[0]?.n ?? 0);
      });
    expect(await count(false)).toBe(0);
    expect(await count(true)).toBeGreaterThan(0);
  });

  it("no org route or org feature imports the conflict review", () => {
    const root = new URL("../../app/sites/org", import.meta.url).pathname;
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name)) files.push(path);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(10);
    const offenders = files.filter((file) => /brain-conflicts|mainBrainConflict|main_brain_conflict|mainBrainNoteFlag|features\/main-brain/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
