import { tenantDb, type Prisma } from "@pubcommand/db";

/**
 * What other apps (the Wiki) may read: approved, live testimonials only, and only the
 * fields that may be published. Never contact details, consent records or flags.
 */

const PUBLIC_SELECT = {
  id: true,
  publicationId: true,
  editorId: true,
  displayName: true,
  location: true,
  quote: true,
  resultClaimed: true,
  givenOn: true,
  channel: true,
  rating: true,
  videoUrl: true,
  disclosure: true,
  files: { where: { kind: "photo" }, select: { id: true }, take: 1 },
} satisfies Prisma.TestimonialSelect;

export type PublicTestimonial = {
  id: string;
  publicationId: string | null;
  editorId: string | null;
  displayName: string;
  location: string | null;
  quote: string;
  resultClaimed: string | null;
  givenOn: string | null;
  channel: string;
  rating: number | null;
  videoUrl: string | null;
  disclosure: string | null;
  photoId: string | null;
};

type Row = Prisma.TestimonialGetPayload<{ select: typeof PUBLIC_SELECT }>;

function toPublic({ files, givenOn, ...row }: Row): PublicTestimonial {
  return { ...row, givenOn: givenOn ? givenOn.toISOString().slice(0, 10) : null, photoId: files[0]?.id ?? null };
}

const APPROVED = { status: "approved", deletedAt: null } as const;
const ORDER = [{ givenOn: { sort: "desc", nulls: "last" } }, { reviewedAt: "desc" }] satisfies Prisma.TestimonialOrderByWithRelationInput[];

export async function approvedForPublication(organizationId: string, brandId: string, publicationId: string, take = 6): Promise<{ items: PublicTestimonial[]; total: number }> {
  const where = { brandId, publicationId, ...APPROVED };
  const db = tenantDb(organizationId);
  const [rows, total] = await Promise.all([db.testimonial.findMany({ where, orderBy: ORDER, take, select: PUBLIC_SELECT }), db.testimonial.count({ where })]);
  return { items: rows.map(toPublic), total };
}

/** Linked to the editor, or naming them in the words. */
export async function approvedForEditor(organizationId: string, brandId: string, editor: { id: string; name: string }, take = 6): Promise<{ items: PublicTestimonial[]; total: number }> {
  const name = editor.name.trim();
  const where: Prisma.TestimonialWhereInput = {
    brandId,
    ...APPROVED,
    OR: [
      { editorId: editor.id },
      ...(name.length >= 3 ? [{ quote: { contains: name, mode: "insensitive" as const } }, { body: { contains: name, mode: "insensitive" as const } }] : []),
    ],
  };
  const db = tenantDb(organizationId);
  const [rows, total] = await Promise.all([db.testimonial.findMany({ where, orderBy: ORDER, take, select: PUBLIC_SELECT }), db.testimonial.count({ where })]);
  return { items: rows.map(toPublic), total };
}

export async function latestApproved(organizationId: string, brandId: string, take = 6): Promise<{ items: PublicTestimonial[]; total: number }> {
  const where = { brandId, ...APPROVED };
  const db = tenantDb(organizationId);
  const [rows, total] = await Promise.all([db.testimonial.findMany({ where, orderBy: [{ reviewedAt: "desc" }], take, select: PUBLIC_SELECT }), db.testimonial.count({ where })]);
  return { items: rows.map(toPublic), total };
}

/** Approved counts per publication id, for the publications list. */
export async function approvedCounts(organizationId: string, brandId: string): Promise<Map<string, number>> {
  const rows = await tenantDb(organizationId).testimonial.findMany({ where: { brandId, ...APPROVED, publicationId: { not: null } }, select: { publicationId: true } });
  const out = new Map<string, number>();
  for (const r of rows) if (r.publicationId) out.set(r.publicationId, (out.get(r.publicationId) ?? 0) + 1);
  return out;
}
