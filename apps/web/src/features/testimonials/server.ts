import { createHash, randomBytes } from "node:crypto";
import { brandProfile } from "@pubcommand/core";
import { Prisma, appendOrgAudit, resolveOrgBySlug, tenantDb } from "@pubcommand/db";
import { teachBrain } from "../brain/teach";
import { getEditors, getPublications, type Editor, type Publication } from "../pubsetup/read";
import {
  approvalBlockers,
  asFlags,
  cleanViewQuery,
  complianceFlags,
  defaultConsentText,
  isUuid,
  parseTestimonialInput,
  publicConsent,
  testimonialNote,
  type ConsentRecord,
  type Filters,
  type Flag,
  type Niche,
  type TestimonialInput,
} from "../../../../../modules/testimonials/testimonials";

/**
 * Testimonials server code: every read and write goes through tenantDb and is scoped
 * to one brand. Callers (pages, actions, routes) check permissions first; these
 * functions take ids so they can be tested without a request.
 */

export type BrandLike = { id: string; name: string; niche?: string | null; audience?: string | null; complianceNotes?: string | null };

export function nicheOf(brand: BrandLike): Niche {
  return brandProfile(brand).niche;
}

export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const PAGE_SIZE = 50;

const ROW_SELECT = {
  id: true,
  brandId: true,
  publicationId: true,
  editorId: true,
  displayName: true,
  location: true,
  quote: true,
  body: true,
  resultClaimed: true,
  givenOn: true,
  channel: true,
  rating: true,
  tags: true,
  videoUrl: true,
  source: true,
  status: true,
  reviewedAt: true,
  reviewReason: true,
  disclosure: true,
  flags: true,
  aiStatus: true,
  consentGiven: true,
  consentMethod: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  files: { select: { id: true, kind: true, filename: true }, orderBy: { createdAt: "asc" } },
} satisfies Prisma.TestimonialSelect;

type RowBase = Prisma.TestimonialGetPayload<{ select: typeof ROW_SELECT }>;

export type PubRef = { id: string; code: string; slug: string; name: string; color: string };
export type EditorRef = { id: string; slug: string; name: string };

export type TestimonialRow = Omit<RowBase, "givenOn" | "flags"> & {
  givenOn: string | null;
  flags: Flag[];
  publication: PubRef | null;
  editor: EditorRef | null;
};

export type Lookups = { pubs: Map<string, PubRef>; editors: Map<string, EditorRef>; publications: Publication[]; editorList: Editor[] };

/** Publications and editors from Publication Setup, archived included so old testimonials keep their labels. */
export async function lookups(organizationId: string, brandId: string): Promise<Lookups> {
  const [publications, editorList] = await Promise.all([
    getPublications(organizationId, brandId, { includeArchived: true }),
    getEditors(organizationId, brandId, { includeArchived: true }),
  ]);
  return {
    publications,
    editorList,
    pubs: new Map(publications.map((p) => [p.id, { id: p.id, code: p.code, slug: p.slug, name: p.name, color: p.color }])),
    editors: new Map(editorList.map((e) => [e.id, { id: e.id, slug: e.slug, name: e.name }])),
  };
}

function toRow(row: RowBase, look: Pick<Lookups, "pubs" | "editors">): TestimonialRow {
  return {
    ...row,
    givenOn: row.givenOn ? row.givenOn.toISOString().slice(0, 10) : null,
    flags: asFlags(row.flags),
    publication: row.publicationId ? (look.pubs.get(row.publicationId) ?? null) : null,
    editor: row.editorId ? (look.editors.get(row.editorId) ?? null) : null,
  };
}

export function filterWhere(brandId: string, filters: Filters): Prisma.TestimonialWhereInput {
  const and: Prisma.TestimonialWhereInput[] = [{ brandId, deletedAt: null }];
  if (filters.status !== "all") and.push({ status: filters.status });
  if (filters.pub) and.push({ publicationId: filters.pub });
  if (filters.editor) and.push({ editorId: filters.editor });
  if (filters.channel) and.push({ channel: filters.channel });
  if (filters.tag) and.push({ tags: { has: filters.tag } });
  if (filters.from) and.push({ givenOn: { gte: new Date(`${filters.from}T00:00:00Z`) } });
  if (filters.to) and.push({ givenOn: { lte: new Date(`${filters.to}T00:00:00Z`) } });
  if (filters.flagged) and.push({ flagCount: { gt: 0 } });
  if (filters.q) {
    const q = filters.q;
    and.push({
      OR: [
        { displayName: { contains: q, mode: "insensitive" } },
        { quote: { contains: q, mode: "insensitive" } },
        { body: { contains: q, mode: "insensitive" } },
        { resultClaimed: { contains: q, mode: "insensitive" } },
        { location: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  return { AND: and };
}

export async function listTestimonials(organizationId: string, brandId: string, filters: Filters, options: { pageSize?: number; all?: boolean } = {}) {
  const db = tenantDb(organizationId);
  const where = filterWhere(brandId, filters);
  const size = options.pageSize ?? PAGE_SIZE;
  const [rows, total, look] = await Promise.all([
    db.testimonial.findMany({
      where,
      orderBy: [{ givenOn: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      select: ROW_SELECT,
      ...(options.all ? { take: 5000 } : { skip: (filters.page - 1) * size, take: size }),
    }),
    db.testimonial.count({ where }),
    lookups(organizationId, brandId),
  ]);
  return { rows: rows.map((r) => toRow(r, look)), total, look };
}

export async function statusCounts(organizationId: string, brandId: string): Promise<Record<string, number>> {
  const db = tenantDb(organizationId);
  const [pending, approved, rejected] = await Promise.all(
    (["pending", "approved", "rejected"] as const).map((status) => db.testimonial.count({ where: { brandId, deletedAt: null, status } })),
  );
  return { pending: pending!, approved: approved!, rejected: rejected!, all: pending! + approved! + rejected! };
}

export async function getTestimonial(organizationId: string, brandId: string, id: string) {
  if (!isUuid(id)) return null;
  const db = tenantDb(organizationId);
  const row = await db.testimonial.findFirst({
    where: { id, brandId, deletedAt: null },
    select: { ...ROW_SELECT, contactEmail: true, consentText: true, consentAt: true, reviewedById: true, aiReason: true, aiFlags: true, createdById: true, captureLinkId: true },
  });
  if (!row) return null;
  const look = await lookups(organizationId, brandId);
  // Reviewer name through their membership (User is not a tenant table). Staff reviewers without a membership show no name.
  const membership = row.reviewedById ? await db.membership.findFirst({ where: { userId: row.reviewedById }, select: { user: { select: { email: true, name: true } } } }).catch(() => null) : null;
  const reviewer = membership?.user ?? null;
  return { ...toRow(row, look), contactEmail: row.contactEmail, consentText: row.consentText, consentAt: row.consentAt, aiReason: row.aiReason, aiFlags: row.aiFlags, reviewer: reviewer ? reviewer.name || reviewer.email : null, look };
}

export type TestimonialDetail = NonNullable<Awaited<ReturnType<typeof getTestimonial>>>;

/** Publication/editor ids must belong to this brand; anything else is dropped. */
async function scopedRefs(organizationId: string, brandId: string, input: { publicationId: string | null; editorId: string | null }) {
  const db = tenantDb(organizationId);
  const [pub, editor] = await Promise.all([
    input.publicationId ? db.calendarPublication.findFirst({ where: { id: input.publicationId, brandId }, select: { id: true } }) : null,
    input.editorId ? db.pubEditor.findFirst({ where: { id: input.editorId, brandId }, select: { id: true } }) : null,
  ]);
  return { publicationId: pub?.id ?? null, editorId: editor?.id ?? null };
}

function contentData(input: TestimonialInput) {
  return {
    displayName: input.displayName,
    location: input.location,
    quote: input.quote,
    body: input.body,
    resultClaimed: input.resultClaimed,
    givenOn: input.givenOn ? new Date(`${input.givenOn}T00:00:00Z`) : null,
    channel: input.channel,
    rating: input.rating,
    tags: input.tags,
    videoUrl: input.videoUrl,
    contactEmail: input.contactEmail,
  };
}

export type UploadFile = { kind: "photo" | "screenshot"; filename: string; mime: string; data: Uint8Array<ArrayBuffer> };

export function checkUpload(file: unknown): { ok: true; file: File } | { ok: false; error: string } | null {
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: "Images must be 8 MB or less." };
  if (!(IMAGE_MIMES as readonly string[]).includes(file.type)) return { ok: false, error: "Upload a PNG, JPG, WebP or GIF image." };
  return { ok: true, file };
}

export async function toUpload(kind: UploadFile["kind"], file: File): Promise<UploadFile> {
  return { kind, filename: file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "image", mime: file.type, data: new Uint8Array(await file.arrayBuffer()) };
}

export async function createTestimonial(input: {
  organizationId: string;
  brand: BrandLike;
  values: TestimonialInput;
  consent: ConsentRecord;
  source: "manual" | "public-form";
  actorId: string | null;
  files?: UploadFile[];
  captureLinkId?: string | null;
  ipHash?: string | null;
}): Promise<{ id: string }> {
  const db = tenantDb(input.organizationId);
  const refs = await scopedRefs(input.organizationId, input.brand.id, input.values);
  const flags = complianceFlags(input.values, nicheOf(input.brand));
  const created = await db.testimonial.create({
    data: {
      organizationId: input.organizationId,
      brandId: input.brand.id,
      ...refs,
      ...contentData(input.values),
      source: input.source,
      status: "pending",
      flags: flags as unknown as Prisma.InputJsonValue,
      flagCount: flags.length,
      consentGiven: input.consent.consentGiven,
      consentText: input.consent.consentText,
      consentAt: input.consent.consentAt,
      consentMethod: input.consent.consentMethod,
      consentIpHash: input.ipHash ?? null,
      captureLinkId: input.captureLinkId ?? null,
      createdById: input.actorId,
      updatedById: input.actorId,
    },
    select: { id: true },
  });
  for (const file of input.files ?? []) {
    await db.testimonialFile.create({ data: { organizationId: input.organizationId, testimonialId: created.id, kind: file.kind, filename: file.filename, mime: file.mime, size: file.data.byteLength, data: file.data } });
  }
  await appendOrgAudit(input.organizationId, {
    actorId: input.actorId,
    action: input.source === "public-form" ? "testimonials.submitted" : "testimonials.created",
    targetType: "testimonial",
    targetId: created.id,
    metadata: { flags: flags.map((f) => f.code) },
  });
  return created;
}

/**
 * Edit the words or details. A change to what the person said (quote, full text,
 * result) sends an approved testimonial back to review and pulls it from the wiki and Brain.
 */
export async function updateTestimonial(input: {
  organizationId: string;
  brand: BrandLike;
  id: string;
  values: TestimonialInput;
  consent: ConsentRecord | null;
  actorId: string;
  files?: UploadFile[];
}): Promise<{ ok: boolean; reopened: boolean }> {
  const db = tenantDb(input.organizationId);
  const existing = await db.testimonial.findFirst({ where: { id: input.id, brandId: input.brand.id, deletedAt: null }, select: { status: true, quote: true, body: true, resultClaimed: true } });
  if (!existing) return { ok: false, reopened: false };
  const refs = await scopedRefs(input.organizationId, input.brand.id, input.values);
  const changedWords = existing.quote !== input.values.quote || (existing.body ?? null) !== input.values.body || (existing.resultClaimed ?? null) !== input.values.resultClaimed;
  const reopened = existing.status === "approved" && changedWords;
  const flags = complianceFlags(input.values, nicheOf(input.brand));
  await db.testimonial.updateMany({
    where: { id: input.id, brandId: input.brand.id },
    data: {
      ...refs,
      ...contentData(input.values),
      flags: flags as unknown as Prisma.InputJsonValue,
      flagCount: flags.length,
      ...(changedWords ? { aiStatus: "none", aiReason: null, aiFlags: Prisma.DbNull } : {}),
      ...(input.consent ? { consentGiven: input.consent.consentGiven, consentText: input.consent.consentText, consentAt: input.consent.consentAt, consentMethod: input.consent.consentMethod } : {}),
      ...(reopened ? { status: "pending", reviewedAt: null, reviewedById: null, reviewReason: "Edited after approval; needs a new review." } : {}),
      updatedById: input.actorId,
    },
  });
  for (const file of input.files ?? []) {
    await db.testimonialFile.create({ data: { organizationId: input.organizationId, testimonialId: input.id, kind: file.kind, filename: file.filename, mime: file.mime, size: file.data.byteLength, data: file.data } });
  }
  if (reopened) await forgetInBrain(input.organizationId, input.id);
  await appendOrgAudit(input.organizationId, { actorId: input.actorId, action: "testimonials.updated", targetType: "testimonial", targetId: input.id, metadata: { reopened } });
  return { ok: true, reopened };
}

export type ReviewResult = { ok: true } | { ok: false; error: string };

/** Approve or reject. Approval enforces the brand's niche rules (approvalBlockers) and teaches the Brain. */
export async function reviewTestimonial(input: {
  organizationId: string;
  brand: BrandLike;
  id: string;
  decision: "approved" | "rejected" | "pending";
  reason: string | null;
  disclosure: string | null;
  acknowledged: boolean;
  actorId: string;
}): Promise<ReviewResult> {
  const db = tenantDb(input.organizationId);
  const t = await db.testimonial.findFirst({ where: { id: input.id, brandId: input.brand.id, deletedAt: null }, select: { id: true, status: true, consentGiven: true, flags: true, quote: true, body: true, resultClaimed: true } });
  if (!t) return { ok: false, error: "That testimonial is gone." };
  const niche = nicheOf(input.brand);
  const disclosure = input.disclosure?.trim().slice(0, 500) || null;
  const reason = input.reason?.trim().slice(0, 1000) || null;
  if (input.decision === "approved") {
    const flags = complianceFlags(t, niche);
    const blockers = approvalBlockers({ consentGiven: t.consentGiven, disclosure, flags, acknowledged: input.acknowledged }, niche);
    if (blockers.length) return { ok: false, error: blockers.join(" ") };
  }
  if (input.decision === "rejected" && !reason) return { ok: false, error: "Say why it was rejected, so whoever collected it knows." };
  await db.testimonial.updateMany({
    where: { id: t.id, brandId: input.brand.id },
    data: {
      status: input.decision,
      disclosure,
      reviewReason: reason,
      reviewedAt: input.decision === "pending" ? null : new Date(),
      reviewedById: input.decision === "pending" ? null : input.actorId,
    },
  });
  await appendOrgAudit(input.organizationId, { actorId: input.actorId, action: `testimonials.${input.decision === "pending" ? "reopened" : input.decision}`, targetType: "testimonial", targetId: t.id, metadata: reason ? { reason } : undefined });
  if (input.decision === "approved") await teachApproved(input.organizationId, input.brand, t.id, input.actorId);
  else if (t.status === "approved") await forgetInBrain(input.organizationId, t.id);
  return { ok: true };
}

/** The Brain note for an approved testimonial (sourceRef testimonial:<id>; no contact details). */
export async function teachApproved(organizationId: string, brand: BrandLike, id: string, actorId: string | null): Promise<void> {
  const db = tenantDb(organizationId);
  const t = await db.testimonial.findFirst({ where: { id, brandId: brand.id, status: "approved", deletedAt: null } });
  if (!t) return;
  const [pub, editor] = await Promise.all([
    t.publicationId ? db.calendarPublication.findFirst({ where: { id: t.publicationId }, select: { name: true } }) : null,
    t.editorId ? db.pubEditor.findFirst({ where: { id: t.editorId }, select: { name: true } }) : null,
  ]);
  const note = testimonialNote({
    id: t.id,
    displayName: t.displayName,
    location: t.location,
    quote: t.quote,
    body: t.body,
    resultClaimed: t.resultClaimed,
    givenOn: t.givenOn ? t.givenOn.toISOString().slice(0, 10) : null,
    channel: t.channel,
    tags: t.tags,
    disclosure: t.disclosure,
    publication: pub?.name ?? null,
    editor: editor?.name ?? null,
  });
  await teachBrain({ organizationId, brandId: brand.id, sourceRef: `testimonial:${t.id}`, title: note.title, body: note.body, folder: "Testimonials", source: "testimonials", actorId });
}

/** Pull a testimonial's note from the brand's Brain (soft delete) when it stops being approved. */
export async function forgetInBrain(organizationId: string, id: string): Promise<void> {
  await tenantDb(organizationId)
    .knowledgePage.updateMany({ where: { sourceRef: `testimonial:${id}`, deletedAt: null }, data: { deletedAt: new Date() } })
    .catch((error) => console.error("[testimonials] could not remove the Brain note", error));
}

export async function deleteTestimonial(organizationId: string, brandId: string, id: string, actorId: string): Promise<boolean> {
  const db = tenantDb(organizationId);
  const { count } = await db.testimonial.updateMany({ where: { id, brandId, deletedAt: null }, data: { deletedAt: new Date(), updatedById: actorId } });
  if (!count) return false;
  await forgetInBrain(organizationId, id);
  await appendOrgAudit(organizationId, { actorId, action: "testimonials.deleted", targetType: "testimonial", targetId: id });
  return true;
}

export async function deleteFile(organizationId: string, brandId: string, testimonialId: string, fileId: string, actorId: string): Promise<boolean> {
  const db = tenantDb(organizationId);
  const owner = await db.testimonial.findFirst({ where: { id: testimonialId, brandId }, select: { id: true } });
  if (!owner || !isUuid(fileId)) return false;
  const { count } = await db.testimonialFile.deleteMany({ where: { id: fileId, testimonialId } });
  if (count) await appendOrgAudit(organizationId, { actorId, action: "testimonials.file_deleted", targetType: "testimonial", targetId: testimonialId });
  return count > 0;
}

/** A testimonial's file, only inside its brand. approvedOnly for wiki viewers. */
export async function getFile(organizationId: string, brandId: string, fileId: string, options: { approvedOnly?: boolean } = {}) {
  if (!isUuid(fileId)) return null;
  const db = tenantDb(organizationId);
  const file = await db.testimonialFile.findFirst({ where: { id: fileId }, select: { data: true, mime: true, filename: true, kind: true, testimonialId: true } });
  if (!file) return null;
  const owner = await db.testimonial.findFirst({
    where: { id: file.testimonialId, brandId, deletedAt: null, ...(options.approvedOnly ? { status: "approved" } : {}) },
    select: { id: true },
  });
  return owner ? file : null;
}

// ── Saved views ──────────────────────────────────────────────────────────

export async function listViews(organizationId: string, brandId: string) {
  return tenantDb(organizationId).testimonialView.findMany({ where: { brandId }, orderBy: { name: "asc" }, select: { id: true, name: true, query: true } });
}

export async function saveView(organizationId: string, brandId: string, name: string, query: string, actorId: string) {
  const clean = name.trim().slice(0, 80);
  if (!clean) return null;
  const view = await tenantDb(organizationId).testimonialView.create({ data: { organizationId, brandId, name: clean, query: cleanViewQuery(query), createdById: actorId }, select: { id: true } });
  await appendOrgAudit(organizationId, { actorId, action: "testimonials.view_saved", targetType: "testimonial_view", targetId: view.id });
  return view;
}

export async function deleteView(organizationId: string, brandId: string, id: string, actorId: string) {
  if (!isUuid(id)) return;
  await tenantDb(organizationId).testimonialView.deleteMany({ where: { id, brandId } });
  await appendOrgAudit(organizationId, { actorId, action: "testimonials.view_deleted", targetType: "testimonial_view", targetId: id });
}

// ── Public capture links ─────────────────────────────────────────────────

export function newToken(): string {
  return randomBytes(18).toString("base64url");
}

export async function listCaptureLinks(organizationId: string, brandId: string) {
  const db = tenantDb(organizationId);
  const links = await db.testimonialCaptureLink.findMany({ where: { brandId }, orderBy: { createdAt: "desc" } });
  const counts = await Promise.all(links.map((l) => db.testimonial.count({ where: { captureLinkId: l.id, deletedAt: null } })));
  return links.map((l, i) => ({ ...l, submissions: counts[i] ?? 0 }));
}

export async function createCaptureLink(input: { organizationId: string; brand: BrandLike; title: string; intro: string; consentText: string; publicationId: string | null; actorId: string }) {
  const db = tenantDb(input.organizationId);
  const pub = input.publicationId && isUuid(input.publicationId) ? await db.calendarPublication.findFirst({ where: { id: input.publicationId, brandId: input.brand.id }, select: { id: true } }) : null;
  const link = await db.testimonialCaptureLink.create({
    data: {
      organizationId: input.organizationId,
      brandId: input.brand.id,
      publicationId: pub?.id ?? null,
      token: newToken(),
      title: input.title.trim().slice(0, 120) || `Share your ${input.brand.name} story`,
      intro: input.intro.trim().slice(0, 1000) || null,
      consentText: input.consentText.trim().slice(0, 1500) || defaultConsentText(input.brand.name),
      createdById: input.actorId,
    },
    select: { id: true },
  });
  await appendOrgAudit(input.organizationId, { actorId: input.actorId, action: "testimonials.capture_link_created", targetType: "testimonial_capture_link", targetId: link.id });
  return link;
}

export async function setCaptureLinkActive(organizationId: string, brandId: string, id: string, active: boolean, actorId: string) {
  if (!isUuid(id)) return;
  await tenantDb(organizationId).testimonialCaptureLink.updateMany({ where: { id, brandId }, data: { active } });
  await appendOrgAudit(organizationId, { actorId, action: active ? "testimonials.capture_link_opened" : "testimonials.capture_link_closed", targetType: "testimonial_capture_link", targetId: id });
}

/** A capture link from its public token. The org comes from the host, so a token only works on its own org. */
export async function captureLinkByToken(orgSlug: string, token: string) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  const org = await resolveOrgBySlug(orgSlug);
  if (!org || org.suspendedAt || org.redirected) return null;
  const db = tenantDb(org.id);
  const link = await db.testimonialCaptureLink.findFirst({ where: { token } });
  if (!link) return null;
  const brand = await db.brand.findFirst({ where: { id: link.brandId } });
  if (!brand) return null;
  const publications = (await getPublications(org.id, brand.id, { activeOnly: true })).filter((p) => p.status !== "retired");
  return { org, link, brand, publications };
}

export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return createHash("sha256").update(`${process.env.AUTH_SECRET ?? "pubcommand"}:testimonial:${ip}`).digest("hex").slice(0, 32);
}

/**
 * A public submission. Always pending; the exact consent text shown on the form is
 * stored with it. Returns an error message for the form, or the new id.
 */
export async function submitPublicTestimonial(input: {
  orgSlug: string;
  token: string;
  form: FormData;
  ip: string | null;
  now?: Date;
}): Promise<{ ok: true; id: string; organizationId: string; brand: BrandLike } | { ok: false; error: string; status?: number }> {
  const found = await captureLinkByToken(input.orgSlug, input.token);
  if (!found) return { ok: false, error: "This link is not valid.", status: 404 };
  if (!found.link.active) return { ok: false, error: "This form is closed." };
  // Honeypot: real people never fill the hidden "website" field.
  if (typeof input.form.get("website") === "string" && String(input.form.get("website")).trim()) return { ok: true, id: "", organizationId: found.org.id, brand: found.brand };
  const parsed = parseTestimonialInput(input.form, { channel: "public-form" });
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const values: TestimonialInput = { ...parsed.values, channel: "public-form", editorId: null, tags: [] };
  if (found.link.publicationId) values.publicationId = found.link.publicationId;
  else if (values.publicationId && !found.publications.some((p) => p.id === values.publicationId)) values.publicationId = null;
  const consent = publicConsent(input.form.get("consent") === "yes", found.link.consentText, input.now ?? new Date());
  if (!consent) return { ok: false, error: "Please tick the box to give us permission to share your words." };
  const photo = checkUpload(input.form.get("photo"));
  if (photo && !photo.ok) return { ok: false, error: photo.error };
  const created = await createTestimonial({
    organizationId: found.org.id,
    brand: found.brand,
    values,
    consent,
    source: "public-form",
    actorId: null,
    files: photo?.ok ? [await toUpload("photo", photo.file)] : [],
    captureLinkId: found.link.id,
    ipHash: hashIp(input.ip),
  });
  return { ok: true, id: created.id, organizationId: found.org.id, brand: found.brand };
}
