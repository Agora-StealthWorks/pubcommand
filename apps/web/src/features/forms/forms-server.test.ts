import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rawPrisma, tenantDb, type Prisma } from "@pubcommand/db";
import { createField } from "../../../../../modules/forms/fields";
import type { EndRule, FieldDef } from "../../../../../modules/forms/types";

// `after()` needs a Next request scope; run the callback straight away instead.
const pending: Promise<unknown>[] = [];
vi.mock("next/server", () => ({ after: (callback: () => Promise<unknown>) => void pending.push(callback()) }));

const { handleSubmit, loadPublicResults } = await import("./public");
const { formsSchedule } = await import("@/jobs/forms-schedule");
const { formsOrphanCleanup } = await import("@/jobs/forms-orphan-cleanup");

const tag = randomUUID().slice(0, 8);
// Own organization, so the test works on an empty database (CI) and never touches seeded data.
const ORG_SLUG = `forms-test-${tag}`;
let planId = "";
let organizationId = "";
let brandId = "";
let themeId = "";
const formIds: string[] = [];

const field = (type: string, patch: Partial<FieldDef> = {}): FieldDef => ({ ...createField(type, randomUUID()), label: type, ...patch });

async function makeForm(fields: FieldDef[], patch: Partial<Prisma.FormUncheckedCreateInput> = {}) {
  const db = tenantDb(organizationId);
  const form = await db.form.create({
    data: { organizationId, brandId, themeId, title: `Test ${tag}`, slug: `t-${tag}-${formIds.length}`, status: "OPEN", ...patch },
  });
  formIds.push(form.id);
  for (const [position, item] of fields.entries()) {
    await db.formField.create({
      data: {
        id: item.id,
        organizationId,
        formId: form.id,
        position,
        type: item.type,
        label: item.label,
        required: item.required,
        config: item.config as Prisma.InputJsonValue,
        visibility: (item.visibility ?? {}) as Prisma.InputJsonValue,
        skipLogic: {},
      },
    });
  }
  return form;
}

function submit(slug: string, answers: Record<string, unknown>, files: Record<string, File> = {}) {
  const body = new FormData();
  body.set("payload", JSON.stringify({ answers, startedAt: Date.now() - 20000, honeypot: "", resumeToken: null, lastPageIndex: 0, utm: {} }));
  for (const [key, file] of Object.entries(files)) body.set(key, file);
  return handleSubmit(new Request(`http://${ORG_SLUG}.localhost/f/${slug}/submit`, { method: "POST", body }), ORG_SLUG, slug);
}

beforeAll(async () => {
  const plan = await rawPrisma().plan.create({ data: { key: `forms-test-${tag}`, name: "Forms test", seatLimit: 5 } });
  planId = plan.id;
  await rawPrisma().planModule.create({ data: { planId, moduleId: "forms" } });
  const org = await rawPrisma().organization.create({ data: { name: `Forms test ${tag}`, slug: ORG_SLUG, planId, seatLimit: 5 } });
  organizationId = org.id;
  const db = tenantDb(organizationId);
  const brand = await db.brand.create({ data: { organizationId, name: "Forms test brand", slug: `b-${tag}` } });
  brandId = brand.id;
  const theme = await db.formTheme.create({ data: { organizationId, brandId, name: `Theme ${tag}`, privacyPolicyUrl: "https://example.com/privacy" } });
  themeId = theme.id;
});

afterAll(async () => {
  if (organizationId) await rawPrisma().organization.deleteMany({ where: { id: organizationId } });
  if (planId) await rawPrisma().plan.deleteMany({ where: { id: planId } });
});

describe("submit route: redirect-by-answer", () => {
  const plan = field("single_choice", { label: "Plan", required: true });
  const basic = plan.config.choices![0]!.id;
  const pro = plan.config.choices![1]!.id;
  const extra = field("yes_no", { label: "Extra", visibility: { action: "show", match: "all", rules: [{ fieldId: plan.id, op: "equals", value: pro }] } });
  const rules: EndRule[] = [
    { id: "r1", match: "all", rules: [{ fieldId: extra.id, op: "equals", value: true }], action: "redirect", url: "https://example.com/pro", title: "", message: "" },
    { id: "r2", match: "all", rules: [{ fieldId: plan.id, op: "equals", value: pro }], action: "message", url: "", title: "Welcome, Pro", message: "Variant B" },
  ];
  let slug = "";

  beforeAll(async () => {
    const form = await makeForm([plan, extra], { endRules: rules as unknown as Prisma.InputJsonValue, confirmTitle: "Thanks", confirmMessage: "Default" });
    slug = form.slug;
  });

  it("sends a matching answer to its URL and another to its thank-you variant", async () => {
    const redirect = await (await submit(slug, { [plan.id]: pro, [extra.id]: true })).json();
    expect(redirect).toEqual({ ok: true, ending: { title: "Thanks", message: "Default", redirectUrl: "https://example.com/pro" } });
    const variant = await (await submit(slug, { [plan.id]: pro, [extra.id]: false })).json();
    expect(variant.ending).toEqual({ title: "Welcome, Pro", message: "Variant B", redirectUrl: null });
  });

  it("ignores a crafted POST answering a hidden question or naming its own redirect", async () => {
    const response = await submit(slug, { [plan.id]: basic, [extra.id]: true, redirectUrl: "https://evil.example" });
    const body = await response.json();
    expect(body.ending).toEqual({ title: "Thanks", message: "Default", redirectUrl: null });
    const stored = await tenantDb(organizationId).formResponse.findFirst({ where: { formId: formIds[0] }, orderBy: { createdAt: "desc" } });
    expect(stored!.answers).toEqual({ [plan.id]: basic });
  });
});

describe("submit route: image upload", () => {
  const image = field("image_upload", { label: "Photo", required: true, config: { maxSizeMb: 1 } });
  let slug = "";
  beforeAll(async () => {
    slug = (await makeForm([image])).slug;
  });

  it("stores a real image with its sniffed type and refuses a disguised file", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const ok = await submit(slug, { [image.id]: { filename: "x.png", size: 1, mimeType: "image/png" } }, { [`file:${image.id}`]: new File([png], "me.png", { type: "text/plain" }) });
    expect(ok.status).toBe(200);
    const file = await tenantDb(organizationId).formFile.findFirst({ where: { fieldId: image.id } });
    expect(file).toMatchObject({ mimeType: "image/png", size: png.length, kind: "upload" });
    const fake = await submit(slug, {}, { [`file:${image.id}`]: new File(["<svg onload=alert(1)>"], "evil.png", { type: "image/png" }) });
    expect(fake.status).toBe(422);
    expect((await fake.json()).errors[image.id]).toMatch(/not a PNG/);
    // A claimed answer without the file itself counts as no answer.
    const claimed = await submit(slug, { [image.id]: { filename: "x.png", size: 10, mimeType: "image/png", fileId: randomUUID() } });
    expect((await claimed.json()).errors[image.id]).toMatch(/upload an image/);
  });
});

describe("public live results", () => {
  it("shows tallies only when turned on and enough people answered", async () => {
    const pick = field("single_choice", { label: "Pick" });
    const name = field("name");
    const form = await makeForm([pick, name], { publicResultsEnabled: false, publicResultsMin: 3 });
    expect(await loadPublicResults(ORG_SLUG, form.slug)).toBeNull();
    await tenantDb(organizationId).form.updateMany({ where: { id: form.id }, data: { publicResultsEnabled: true } });
    for (let index = 0; index < 3; index += 1) await submit(form.slug, { [pick.id]: pick.config.choices![0]!.id, [name.id]: `Person ${index}` });
    const loaded = await loadPublicResults(ORG_SLUG, form.slug);
    expect(loaded!.results.available).toBe(true);
    expect(JSON.stringify(loaded)).not.toContain("Person");
  });
});

describe("jobs", () => {
  it("publishes a scheduled draft, blocks one that fails the checks, and closes an expired form", async () => {
    const q = field("short_text", { label: "Q" });
    const ready = await makeForm([q], { status: "DRAFT", autoPublish: true, opensAt: new Date(Date.now() - 60000) });
    const broken = await makeForm([], { status: "DRAFT", autoPublish: true, opensAt: new Date(Date.now() - 60000) });
    const expired = await makeForm([field("short_text", { label: "Q" })], { status: "OPEN", closesAt: new Date(Date.now() - 60000) });
    await formsSchedule.run({ scheduledFor: new Date(), trigger: "manual", log: () => undefined });
    const db = tenantDb(organizationId);
    const rows = await db.form.findMany({ where: { id: { in: [ready.id, broken.id, expired.id] } }, select: { id: true, status: true, autoPublish: true, scheduleNote: true } });
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(ready.id)).toMatchObject({ status: "OPEN", autoPublish: false, scheduleNote: null });
    expect(byId.get(broken.id)).toMatchObject({ status: "DRAFT", autoPublish: false });
    expect(byId.get(broken.id)!.scheduleNote).toMatch(/question/);
    expect(byId.get(expired.id)!.status).toBe("CLOSED");
  });

  it("reaps old orphaned uploads only", async () => {
    const db = tenantDb(organizationId);
    const old = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    const orphan = await db.formFile.create({ data: { organizationId, kind: "upload", filename: "o.png", mimeType: "image/png", size: 1, data: new Uint8Array([1]), createdAt: old } });
    const fresh = await db.formFile.create({ data: { organizationId, kind: "upload", filename: "f.png", mimeType: "image/png", size: 1, data: new Uint8Array([1]) } });
    await formsOrphanCleanup.run({ scheduledFor: new Date(), trigger: "manual", log: () => undefined });
    expect(await db.formFile.count({ where: { id: orphan.id } })).toBe(0);
    expect(await db.formFile.count({ where: { id: fresh.id } })).toBe(1);
    await db.formFile.deleteMany({ where: { id: fresh.id } });
  });
});

afterAll(async () => {
  await Promise.allSettled(pending);
});
