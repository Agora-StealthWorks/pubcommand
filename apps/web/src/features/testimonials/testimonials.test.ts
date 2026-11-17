import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawPrisma, tenantDb } from "@pubcommand/db";
import { wikiEditor, wikiHome, wikiLists, wikiPublication } from "../wiki/data";
import { approvedForEditor, approvedForPublication } from "./read";
import {
  createCaptureLink,
  createTestimonial,
  getFile,
  getTestimonial,
  listTestimonials,
  reviewTestimonial,
  submitPublicTestimonial,
  updateTestimonial,
  type BrandLike,
} from "./server";
import { DEFAULT_DISCLOSURE, parseFilters, staffConsent, type TestimonialInput } from "../../../../../modules/testimonials/testimonials";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/pubcommand";

const db = rawPrisma();
const suffix = randomBytes(4).toString("hex");
const ids = { plan: "", orgA: "", orgB: "", fin: "", health: "", other: "", pubA: "", pubArchived: "", pubOther: "", editorA: "", user: "" };
let finBrand: BrandLike;
let healthBrand: BrandLike;

const input = (over: Partial<TestimonialInput> = {}): TestimonialInput => ({
  displayName: "Mark T.",
  location: "Columbus, OH",
  quote: "Clear, honest research every morning.",
  body: null,
  resultClaimed: null,
  givenOn: "2026-10-01",
  channel: "email",
  rating: 5,
  tags: [],
  videoUrl: null,
  contactEmail: "mark.private@example.com",
  publicationId: ids.pubA,
  editorId: ids.editorA,
  ...over,
});
const consent = () => staffConsent(true, "Replied yes by email", new Date());

beforeAll(async () => {
  execSync("pnpm exec prisma migrate deploy --schema prisma/schema", {
    cwd: new URL("../../../../../packages/db", import.meta.url).pathname,
    env: process.env,
    stdio: "ignore",
  });
  const plan = await db.plan.create({ data: { key: `tst-${suffix}`, name: "Testimonials test", seatLimit: 5, monthlyPriceCents: 0 } });
  const orgA = await db.organization.create({ data: { name: `Tst A ${suffix}`, slug: `tst-a-${suffix}`, planId: plan.id, seatLimit: 5 } });
  const orgB = await db.organization.create({ data: { name: `Tst B ${suffix}`, slug: `tst-b-${suffix}`, planId: plan.id, seatLimit: 5 } });
  const fin = await db.brand.create({ data: { organizationId: orgA.id, name: "Edge Daily", slug: `fin-${suffix}`, niche: "finance" } });
  const health = await db.brand.create({ data: { organizationId: orgA.id, name: "Vital Living", slug: `health-${suffix}`, niche: "health" } });
  const other = await db.brand.create({ data: { organizationId: orgB.id, name: "Other Co", slug: `oth-${suffix}`, niche: "general" } });
  const user = await db.user.create({ data: { email: `tst-${suffix}@example.com` } });
  const pubA = await db.calendarPublication.create({ data: { organizationId: orgA.id, brandId: fin.id, code: "TDE", slug: "the-daily-edge", name: "The Daily Edge", positioning: "One idea a day", offers: [{ label: "Annual", price: "$49", term: "per year" }] } });
  const pubArchived = await db.calendarPublication.create({ data: { organizationId: orgA.id, brandId: fin.id, code: "OLD", slug: "old", name: "Old Letter", deletedAt: new Date(), active: false } });
  const pubOther = await db.calendarPublication.create({ data: { organizationId: orgA.id, brandId: health.id, code: "VIT", slug: "vital", name: "Vital Weekly" } });
  const editorA = await db.pubEditor.create({ data: { organizationId: orgA.id, brandId: fin.id, name: "Ada Lee", slug: "ada-lee", title: "Chief strategist", email: "ada.internal@example.com" } });
  await db.pubPublicationEditor.create({ data: { organizationId: orgA.id, publicationId: pubA.id, editorId: editorA.id, role: "lead" } });
  Object.assign(ids, { plan: plan.id, orgA: orgA.id, orgB: orgB.id, fin: fin.id, health: health.id, other: other.id, pubA: pubA.id, pubArchived: pubArchived.id, pubOther: pubOther.id, editorA: editorA.id, user: user.id });
  finBrand = fin;
  healthBrand = health;
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } });
  await db.plan.deleteMany({ where: { id: ids.plan } });
  await db.user.deleteMany({ where: { id: ids.user } });
});

describe("approval rules per niche", () => {
  it("finance: a specific gain needs the reviewer to confirm it; approval teaches the Brain without contact details", async () => {
    const t = await createTestimonial({ organizationId: ids.orgA, brand: finBrand, values: input({ quote: "Up 85% in three months on the model portfolio!" }), consent: consent(), source: "manual", actorId: ids.user });
    const row = await getTestimonial(ids.orgA, ids.fin, t.id);
    expect(row?.flags.map((f) => f.code)).toContain("specific-gain");

    const blocked = await reviewTestimonial({ organizationId: ids.orgA, brand: finBrand, id: t.id, decision: "approved", reason: null, disclosure: null, acknowledged: false, actorId: ids.user });
    expect(blocked).toMatchObject({ ok: false, error: expect.stringMatching(/specific gain/) });
    expect((await getTestimonial(ids.orgA, ids.fin, t.id))?.status).toBe("pending");

    const ok = await reviewTestimonial({ organizationId: ids.orgA, brand: finBrand, id: t.id, decision: "approved", reason: null, disclosure: DEFAULT_DISCLOSURE.finance, acknowledged: true, actorId: ids.user });
    expect(ok).toEqual({ ok: true });
    const note = await tenantDb(ids.orgA).knowledgePage.findFirst({ where: { sourceRef: `testimonial:${t.id}` } });
    expect(note).toMatchObject({ brandId: ids.fin, folder: "Testimonials", deletedAt: null });
    expect(note!.body).toContain("Up 85%");
    expect(note!.body).not.toContain("mark.private@example.com");

    // Editing the words of an approved testimonial sends it back to review and pulls the note.
    const edited = await updateTestimonial({ organizationId: ids.orgA, brand: finBrand, id: t.id, values: input({ quote: "Up 90% in three months!" }), consent: null, actorId: ids.user });
    expect(edited).toEqual({ ok: true, reopened: true });
    expect((await getTestimonial(ids.orgA, ids.fin, t.id))?.status).toBe("pending");
    expect((await tenantDb(ids.orgA).knowledgePage.findFirst({ where: { sourceRef: `testimonial:${t.id}` } }))?.deletedAt).not.toBeNull();
  });

  it("health: approval needs a results-not-typical note", async () => {
    const t = await createTestimonial({ organizationId: ids.orgA, brand: healthBrand, values: input({ publicationId: ids.pubOther, editorId: null, quote: "I sleep better and have more energy." }), consent: consent(), source: "manual", actorId: ids.user });
    const blocked = await reviewTestimonial({ organizationId: ids.orgA, brand: healthBrand, id: t.id, decision: "approved", reason: null, disclosure: "  ", acknowledged: false, actorId: ids.user });
    expect(blocked).toMatchObject({ ok: false, error: expect.stringMatching(/results not typical/) });
    const ok = await reviewTestimonial({ organizationId: ids.orgA, brand: healthBrand, id: t.id, decision: "approved", reason: null, disclosure: DEFAULT_DISCLOSURE.health, acknowledged: false, actorId: ids.user });
    expect(ok).toEqual({ ok: true });
  });

  it("nobody approves without consent, and a rejection needs a reason", async () => {
    const t = await createTestimonial({ organizationId: ids.orgA, brand: finBrand, values: input(), consent: staffConsent(false, "", new Date()), source: "manual", actorId: ids.user });
    expect(await reviewTestimonial({ organizationId: ids.orgA, brand: finBrand, id: t.id, decision: "approved", reason: null, disclosure: null, acknowledged: true, actorId: ids.user })).toMatchObject({ ok: false, error: expect.stringMatching(/consent/) });
    expect(await reviewTestimonial({ organizationId: ids.orgA, brand: finBrand, id: t.id, decision: "rejected", reason: "", disclosure: null, acknowledged: false, actorId: ids.user })).toMatchObject({ ok: false });
    expect(await reviewTestimonial({ organizationId: ids.orgA, brand: finBrand, id: t.id, decision: "rejected", reason: "No permission", disclosure: null, acknowledged: false, actorId: ids.user })).toEqual({ ok: true });
  });
});

describe("public capture", () => {
  it("stores the exact consent wording shown, never the raw IP, and always lands pending", async () => {
    const wording = "I agree that Edge Daily may publish my words. Exact wording v7.";
    await createCaptureLink({ organizationId: ids.orgA, brand: finBrand, title: "Share your story", intro: "", consentText: wording, publicationId: ids.pubA, actorId: ids.user });
    const link = await tenantDb(ids.orgA).testimonialCaptureLink.findFirst({ where: { brandId: ids.fin } });
    const form = new FormData();
    form.set("displayName", "J.R.");
    form.set("quote", "Best newsletter I read.");
    form.set("publicationId", ids.pubOther); // another brand's publication is ignored: the link pins TDE
    form.set("consent", "yes");

    const result = await submitPublicTestimonial({ orgSlug: `tst-a-${suffix}`, token: link!.token, form, ip: "203.0.113.9" });
    expect(result.ok).toBe(true);
    const id = result.ok ? result.id : "";
    const row = await tenantDb(ids.orgA).testimonial.findFirst({ where: { id } });
    expect(row).toMatchObject({ status: "pending", source: "public-form", channel: "public-form", consentGiven: true, consentText: wording, consentMethod: "public-form", publicationId: ids.pubA, brandId: ids.fin, captureLinkId: link!.id });
    expect(row!.consentAt).toBeInstanceOf(Date);
    expect(row!.consentIpHash).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(row)).not.toContain("203.0.113.9");

    const noConsent = new FormData();
    noConsent.set("displayName", "K");
    noConsent.set("quote", "Nice");
    expect(await submitPublicTestimonial({ orgSlug: `tst-a-${suffix}`, token: link!.token, form: noConsent, ip: null })).toMatchObject({ ok: false, error: expect.stringMatching(/permission/) });

    // The token only works on its own organization's host.
    expect(await submitPublicTestimonial({ orgSlug: `tst-b-${suffix}`, token: link!.token, form, ip: null })).toMatchObject({ ok: false, status: 404 });

    await tenantDb(ids.orgA).testimonialCaptureLink.updateMany({ where: { id: link!.id }, data: { active: false } });
    expect(await submitPublicTestimonial({ orgSlug: `tst-a-${suffix}`, token: link!.token, form, ip: null })).toMatchObject({ ok: false, error: "This form is closed." });
  });
});

describe("wiki shows only Publication Setup data and approved testimonials", () => {
  it("publication and editor pages list approved testimonials only, without private fields", async () => {
    const mk = (quote: string) => createTestimonial({ organizationId: ids.orgA, brand: finBrand, values: input({ quote }), consent: consent(), source: "manual", actorId: ids.user });
    const approved = await mk("Ada Lee explains things plainly.");
    await mk("Pending words.");
    const rejected = await mk("Rejected words.");
    const deleted = await mk("Deleted words.");
    await reviewTestimonial({ organizationId: ids.orgA, brand: finBrand, id: approved.id, decision: "approved", reason: null, disclosure: null, acknowledged: false, actorId: ids.user });
    await reviewTestimonial({ organizationId: ids.orgA, brand: finBrand, id: rejected.id, decision: "rejected", reason: "Off-brand", disclosure: null, acknowledged: false, actorId: ids.user });
    await reviewTestimonial({ organizationId: ids.orgA, brand: finBrand, id: deleted.id, decision: "approved", reason: null, disclosure: null, acknowledged: false, actorId: ids.user });
    await tenantDb(ids.orgA).testimonial.updateMany({ where: { id: deleted.id }, data: { deletedAt: new Date() } });

    const page = await wikiPublication(ids.orgA, ids.fin, "the-daily-edge", { calendar: false, promos: false });
    expect(page?.pub).toMatchObject({ name: "The Daily Edge", positioning: "One idea a day", offers: [{ label: "Annual", price: "$49", term: "per year" }] });
    expect(page?.team.map((m) => m.name)).toEqual(["Ada Lee"]);
    const quotes = page!.testimonials.items.map((t) => t.quote);
    expect(quotes).toContain("Ada Lee explains things plainly.");
    for (const hidden of ["Pending words.", "Rejected words.", "Deleted words."]) expect(quotes).not.toContain(hidden);
    expect(JSON.stringify(page!.testimonials)).not.toMatch(/mark\.private|consent|flags/);

    const editor = await wikiEditor(ids.orgA, ids.fin, "ada-lee");
    expect(editor?.writes.map((w) => w.pub.slug)).toEqual(["the-daily-edge"]);
    expect(editor!.testimonials.items.every((t) => t.quote !== "Pending words.")).toBe(true);
    expect(editor!.testimonials.items.length).toBeGreaterThan(0);

    // Archived publications are not wiki pages; the lists only carry Publication Setup rows.
    expect(await wikiPublication(ids.orgA, ids.fin, "old", { calendar: false, promos: false })).toBeNull();
    const lists = await wikiLists(ids.orgA, ids.fin);
    expect(lists.publications.map((p) => p.code)).toEqual(["TDE"]);
    const home = await wikiHome(ids.orgA, ids.fin, { testimonials: true });
    expect(home.latest.items.every((t) => !["Pending words.", "Rejected words.", "Deleted words."].includes(t.quote))).toBe(true);
  });
});

describe("isolation", () => {
  it("another organization or brand never sees a testimonial, its files or its approved list", async () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const t = await createTestimonial({ organizationId: ids.orgA, brand: finBrand, values: input({ publicationId: ids.pubOther }), consent: consent(), source: "manual", actorId: ids.user, files: [{ kind: "photo", filename: "p.png", mime: "image/png", data: png }] });
    const row = await getTestimonial(ids.orgA, ids.fin, t.id);
    // A publication from another brand is dropped rather than linked.
    expect(row?.publicationId).toBeNull();
    const fileId = row!.files[0]!.id;
    expect(await getFile(ids.orgA, ids.fin, fileId)).not.toBeNull();
    expect(await getFile(ids.orgA, ids.fin, fileId, { approvedOnly: true })).toBeNull();
    expect(await getFile(ids.orgA, ids.health, fileId)).toBeNull();
    expect(await getFile(ids.orgB, ids.fin, fileId)).toBeNull();
    expect(await getTestimonial(ids.orgB, ids.fin, t.id)).toBeNull();
    expect(await getTestimonial(ids.orgA, ids.health, t.id)).toBeNull();
    expect((await listTestimonials(ids.orgB, ids.other, parseFilters({}))).total).toBe(0);
    expect((await approvedForPublication(ids.orgB, ids.fin, ids.pubA)).total).toBe(0);
    expect((await approvedForEditor(ids.orgA, ids.health, { id: ids.editorA, name: "Ada Lee" })).total).toBe(0);
    // Updates from the wrong brand do nothing.
    expect(await updateTestimonial({ organizationId: ids.orgA, brand: healthBrand, id: t.id, values: input(), consent: null, actorId: ids.user })).toEqual({ ok: false, reopened: false });
  });
});
