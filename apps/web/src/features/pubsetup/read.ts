import { tenantDb, type Prisma } from "@pubcommand/db";
import { matchPublication, publicationPromptContext } from "../../../../../modules/pubsetup/brain";
import { resolveBranding, type ResolvedBranding } from "../../../../../modules/pubsetup/branding";
import { asPairs, type Pair } from "../../../../../modules/pubsetup/fields";
import type { LogoSlots } from "../../../../../modules/pubsetup/logos";
import { sortLegacyLogos } from "./logo-tone";

/**
 * The read API every app uses for publications, editors and branding. Publication Setup
 * owns this data; other apps (Wiki, Testimonials, Packager, Funnels, Mini-Blog, Promo
 * Analyzer...) read it here and never write it. No permission check: callers check their
 * own app's permission first. Binary images are never loaded here; use getImage().
 */

export type PublicationEditorRef = { id: string; name: string; slug: string; role: string; title: string | null };

export type Publication = {
  id: string;
  brandId: string;
  code: string;
  slug: string;
  name: string;
  tagline: string | null;
  pubType: string | null;
  tier: string | null;
  frequency: string | null;
  /** "active" | "launching" | "paused" | "retired" */
  status: string;
  /** YYYY-MM-DD */
  launchDate: string | null;
  description: string | null;
  longDescription: string | null;
  positioning: string | null;
  audience: string | null;
  deliverables: string[];
  /** Retail pricing as people typed it ("$7,500/yr"). */
  retailPrice: string | null;
  lifetimePrice: string | null;
  salePrice: string | null;
  pricingNotes: string | null;
  offers: { label: string; price: string; term: string }[];
  websiteUrl: string | null;
  signupUrl: string | null;
  archiveUrl: string | null;
  sampleIssues: { title: string; url: string }[];
  voiceNotes: string | null;
  complianceNotes: string | null;
  /** Calendar chip color. */
  color: string;
  /** Either logo slot is filled. Pick one with logoFor(pub, background). */
  hasLogo: boolean;
  /** Logo slots by background: light = for light backgrounds (dark artwork). */
  logos: LogoSlots;
  hasCover: boolean;
  /** False when retired or archived; pickers should hide it. */
  active: boolean;
  archived: boolean;
  sortOrder: number;
  editors: PublicationEditorRef[];
  updatedAt: Date;
};

export type EditorPublicationRef = { id: string; code: string; name: string; role: string };

export type Editor = {
  id: string;
  brandId: string;
  name: string;
  slug: string;
  title: string | null;
  /** "active" | "inactive" */
  status: string;
  shortBio: string | null;
  longBio: string | null;
  credentials: string | null;
  trackRecord: string | null;
  specialties: string[];
  socialLinks: { label: string; url: string }[];
  voiceNotes: string | null;
  /** Internal contact. Never show it on public or wiki pages. */
  email: string | null;
  hasPhoto: boolean;
  archived: boolean;
  sortOrder: number;
  publications: EditorPublicationRef[];
  updatedAt: Date;
};

export type Branding = ResolvedBranding & { brandId: string; publicationId: string | null; /** Cache key for brand logo URLs. */ brandVersion: number | null };

/** "pub-logo" / "brand-logo" are the light-background slots, "-dark" the dark-background ones. Headers are legacy (email branding was removed). */
export type ImageKind = "pub-logo" | "pub-logo-dark" | "pub-cover" | "pub-header" | "editor-photo" | "brand-logo" | "brand-logo-dark" | "brand-header";

const PUB_SELECT = {
  id: true,
  brandId: true,
  code: true,
  slug: true,
  name: true,
  tagline: true,
  pubType: true,
  tier: true,
  frequency: true,
  status: true,
  launchDate: true,
  description: true,
  longDescription: true,
  positioning: true,
  audience: true,
  deliverables: true,
  retailPrice: true,
  lifetimePrice: true,
  salePrice: true,
  pricingNotes: true,
  offers: true,
  websiteUrl: true,
  signupUrl: true,
  archiveUrl: true,
  sampleIssues: true,
  voiceNotes: true,
  complianceNotes: true,
  color: true,
  logoMime: true,
  logoOnDarkMime: true,
  coverMime: true,
  active: true,
  deletedAt: true,
  sortOrder: true,
  updatedAt: true,
  editorLinks: {
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { role: true, editor: { select: { id: true, name: true, slug: true, title: true, deletedAt: true } } },
  },
} satisfies Prisma.CalendarPublicationSelect;

const EDITOR_SELECT = {
  id: true,
  brandId: true,
  name: true,
  slug: true,
  title: true,
  status: true,
  shortBio: true,
  longBio: true,
  credentials: true,
  trackRecord: true,
  specialties: true,
  socialLinks: true,
  voiceNotes: true,
  email: true,
  photoMime: true,
  deletedAt: true,
  sortOrder: true,
  updatedAt: true,
  publicationLinks: {
    orderBy: { createdAt: "asc" },
    select: { role: true, publication: { select: { id: true, code: true, name: true, deletedAt: true, sortOrder: true } } },
  },
} satisfies Prisma.PubEditorSelect;

type PubRow = {
  id: string;
  brandId: string;
  code: string;
  slug: string | null;
  name: string;
  tagline: string | null;
  pubType: string | null;
  tier: string | null;
  frequency: string | null;
  status: string;
  launchDate: Date | null;
  description: string | null;
  longDescription: string | null;
  positioning: string | null;
  audience: string | null;
  deliverables: string[];
  retailPrice: string | null;
  lifetimePrice: string | null;
  salePrice: string | null;
  pricingNotes: string | null;
  offers: unknown;
  websiteUrl: string | null;
  signupUrl: string | null;
  archiveUrl: string | null;
  sampleIssues: unknown;
  voiceNotes: string | null;
  complianceNotes: string | null;
  color: string;
  logoMime: string | null;
  logoOnDarkMime: string | null;
  coverMime: string | null;
  active: boolean;
  deletedAt: Date | null;
  sortOrder: number;
  updatedAt: Date;
  editorLinks: { role: string; editor: { id: string; name: string; slug: string; title: string | null; deletedAt: Date | null } }[];
};

function pick<K extends string>(rows: Pair[], keys: readonly K[]): Record<K, string>[] {
  return rows.map((row) => Object.fromEntries(keys.map((k) => [k, row[k] ?? ""])) as Record<K, string>);
}

function toPublication(row: PubRow): Publication {
  const { logoMime, logoOnDarkMime, coverMime, deletedAt, editorLinks, launchDate, offers, sampleIssues, slug, ...rest } = row;
  return {
    ...rest,
    slug: slug ?? row.code.toLowerCase(),
    launchDate: launchDate ? launchDate.toISOString().slice(0, 10) : null,
    offers: pick(asPairs(offers), ["label", "price", "term"] as const),
    sampleIssues: pick(asPairs(sampleIssues), ["title", "url"] as const),
    hasLogo: Boolean(logoMime || logoOnDarkMime),
    logos: { light: Boolean(logoMime), dark: Boolean(logoOnDarkMime) },
    hasCover: Boolean(coverMime),
    archived: Boolean(deletedAt),
    active: row.active && !deletedAt,
    editors: editorLinks.filter((l) => !l.editor.deletedAt).map((l) => ({ id: l.editor.id, name: l.editor.name, slug: l.editor.slug, title: l.editor.title, role: l.role })),
  };
}

type EditorRow = {
  id: string;
  brandId: string;
  name: string;
  slug: string;
  title: string | null;
  status: string;
  shortBio: string | null;
  longBio: string | null;
  credentials: string | null;
  trackRecord: string | null;
  specialties: string[];
  socialLinks: unknown;
  voiceNotes: string | null;
  email: string | null;
  photoMime: string | null;
  deletedAt: Date | null;
  sortOrder: number;
  updatedAt: Date;
  publicationLinks: { role: string; publication: { id: string; code: string; name: string; deletedAt: Date | null; sortOrder: number } }[];
};

function toEditor(row: EditorRow): Editor {
  const { photoMime, deletedAt, publicationLinks, socialLinks, ...rest } = row;
  return {
    ...rest,
    socialLinks: pick(asPairs(socialLinks), ["label", "url"] as const),
    hasPhoto: Boolean(photoMime),
    archived: Boolean(deletedAt),
    publications: publicationLinks
      .filter((l) => !l.publication.deletedAt)
      .sort((a, b) => a.publication.sortOrder - b.publication.sortOrder)
      .map((l) => ({ id: l.publication.id, code: l.publication.code, name: l.publication.name, role: l.role })),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A brand's publications, in display order. Archived ones only when asked; retired ones are included (status says so). */
export async function getPublications(organizationId: string, brandId: string, options: { includeArchived?: boolean; activeOnly?: boolean } = {}): Promise<Publication[]> {
  await sortLegacyLogos(organizationId, brandId);
  const rows = await tenantDb(organizationId).calendarPublication.findMany({
    where: { brandId, ...(options.includeArchived ? {} : { deletedAt: null }), ...(options.activeOnly ? { active: true } : {}) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: PUB_SELECT,
  });
  return rows.map(toPublication);
}

/** One publication by id, slug or code (archived included, so old links still resolve). */
export async function getPublication(organizationId: string, brandId: string, ref: string): Promise<Publication | null> {
  const value = ref.trim();
  if (!value) return null;
  await sortLegacyLogos(organizationId, brandId);
  const or = [
    ...(UUID.test(value) ? [{ id: value }] : []),
    { slug: value.toLowerCase() },
    { code: value.toUpperCase() },
  ];
  const row = await tenantDb(organizationId).calendarPublication.findFirst({ where: { brandId, OR: or }, select: PUB_SELECT });
  return row ? toPublication(row) : null;
}

/** A brand's editors, in display order. */
export async function getEditors(organizationId: string, brandId: string, options: { includeArchived?: boolean; activeOnly?: boolean } = {}): Promise<Editor[]> {
  const rows = await tenantDb(organizationId).pubEditor.findMany({
    where: { brandId, ...(options.includeArchived ? {} : { deletedAt: null }), ...(options.activeOnly ? { status: "active" } : {}) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: EDITOR_SELECT,
  });
  return rows.map(toEditor);
}

/** One editor by id or slug. */
export async function getEditor(organizationId: string, brandId: string, ref: string): Promise<Editor | null> {
  const value = ref.trim();
  if (!value) return null;
  const row = await tenantDb(organizationId).pubEditor.findFirst({
    where: { brandId, OR: [...(UUID.test(value) ? [{ id: value }] : []), { slug: value.toLowerCase() }] },
    select: EDITOR_SELECT,
  });
  return row ? toEditor(row) : null;
}

const BRANDING_SELECT = {
  primaryColor: true,
  accentColor: true,
  textColor: true,
  backgroundColor: true,
  headingFont: true,
  bodyFont: true,
  tagline: true,
  logoMime: true,
  logoOnDarkMime: true,
} as const;

function slots(row: { logoMime: string | null; logoOnDarkMime: string | null } | null): LogoSlots | undefined {
  return row ? { light: Boolean(row.logoMime), dark: Boolean(row.logoOnDarkMime) } : undefined;
}

/** The brand-level defaults alone (what a publication inherits). */
export async function getBrandBranding(organizationId: string, brandId: string): Promise<Branding> {
  const db = tenantDb(organizationId);
  await sortLegacyLogos(organizationId, brandId);
  const [brand, defaults] = await Promise.all([
    db.brand.findFirst({ where: { id: brandId }, select: { name: true } }),
    db.pubBrandBranding.findFirst({ where: { brandId }, select: { ...BRANDING_SELECT, updatedAt: true } }),
  ]);
  const resolved = resolveBranding(null, defaults ? { ...defaults, logos: slots(defaults) } : null, brand?.name ?? "");
  return { ...resolved, brandId, publicationId: null, brandVersion: defaults?.updatedAt.getTime() ?? null };
}

/** A publication's branding with brand defaults filled in (each value says where it came from). */
export async function getBranding(organizationId: string, publicationId: string): Promise<Branding | null> {
  if (!UUID.test(publicationId)) return null;
  const db = tenantDb(organizationId);
  const found = await db.calendarPublication.findFirst({ where: { id: publicationId }, select: { brandId: true } });
  if (!found) return null;
  await sortLegacyLogos(organizationId, found.brandId);
  const pub = await db.calendarPublication.findFirst({ where: { id: publicationId }, select: { ...BRANDING_SELECT, brandId: true } });
  if (!pub) return null;
  const [brand, defaults] = await Promise.all([
    db.brand.findFirst({ where: { id: pub.brandId }, select: { name: true } }),
    db.pubBrandBranding.findFirst({ where: { brandId: pub.brandId }, select: { ...BRANDING_SELECT, updatedAt: true } }),
  ]);
  const resolved = resolveBranding({ ...pub, logos: slots(pub) }, defaults ? { ...defaults, logos: slots(defaults) } : null, brand?.name ?? "");
  return { ...resolved, brandId: pub.brandId, publicationId, brandVersion: defaults?.updatedAt.getTime() ?? null };
}

/**
 * The bytes of one image, for an app to serve from its own route. id is the publication,
 * editor or brand id; pass brandId to keep it inside one brand. Serve with nosniff and a sandbox CSP (SVG may be uploaded).
 */
export async function getImage(organizationId: string, kind: ImageKind, id: string, brandId?: string): Promise<{ data: Uint8Array; mime: string; filename: string } | null> {
  if (!UUID.test(id)) return null;
  if (brandId && kind.startsWith("brand-") && id !== brandId) return null;
  const scope = brandId ? { brandId } : {};
  const db = tenantDb(organizationId);
  const out = (data: Uint8Array | null, mime: string | null, filename: string | null) => (data && mime ? { data, mime, filename: filename ?? "image" } : null);
  switch (kind) {
    case "pub-logo": {
      const r = await db.calendarPublication.findFirst({ where: { id, ...scope }, select: { logoData: true, logoMime: true, logoFilename: true } });
      return r ? out(r.logoData, r.logoMime, r.logoFilename) : null;
    }
    case "pub-logo-dark": {
      const r = await db.calendarPublication.findFirst({ where: { id, ...scope }, select: { logoOnDarkData: true, logoOnDarkMime: true, logoOnDarkFilename: true } });
      return r ? out(r.logoOnDarkData, r.logoOnDarkMime, r.logoOnDarkFilename) : null;
    }
    case "pub-cover": {
      const r = await db.calendarPublication.findFirst({ where: { id, ...scope }, select: { coverData: true, coverMime: true, coverFilename: true } });
      return r ? out(r.coverData, r.coverMime, r.coverFilename) : null;
    }
    case "pub-header": {
      const r = await db.calendarPublication.findFirst({ where: { id, ...scope }, select: { emailHeaderData: true, emailHeaderMime: true, emailHeaderFilename: true } });
      return r ? out(r.emailHeaderData, r.emailHeaderMime, r.emailHeaderFilename) : null;
    }
    case "editor-photo": {
      const r = await db.pubEditor.findFirst({ where: { id, ...scope }, select: { photoData: true, photoMime: true, photoFilename: true } });
      return r ? out(r.photoData, r.photoMime, r.photoFilename) : null;
    }
    case "brand-logo": {
      const r = await db.pubBrandBranding.findFirst({ where: { brandId: id }, select: { logoData: true, logoMime: true, logoFilename: true } });
      return r ? out(r.logoData, r.logoMime, r.logoFilename) : null;
    }
    case "brand-logo-dark": {
      const r = await db.pubBrandBranding.findFirst({ where: { brandId: id }, select: { logoOnDarkData: true, logoOnDarkMime: true, logoOnDarkFilename: true } });
      return r ? out(r.logoOnDarkData, r.logoOnDarkMime, r.logoOnDarkFilename) : null;
    }
    case "brand-header": {
      const r = await db.pubBrandBranding.findFirst({ where: { brandId: id }, select: { emailHeaderData: true, emailHeaderMime: true, emailHeaderFilename: true } });
      return r ? out(r.emailHeaderData, r.emailHeaderMime, r.emailHeaderFilename) : null;
    }
  }
}

/** The publication a promo belongs to, from its free-text product (code, slug or name). */
export async function findPublicationForProduct(organizationId: string, brandId: string, product: string | null | undefined): Promise<Publication | null> {
  if (!product?.trim()) return null;
  return matchPublication(product, await getPublications(organizationId, brandId));
}

/** A prompt block (positioning, audience, voice, editors, compliance) for AI drafts, or "" when the promo has no publication. */
export async function publicationPromptBlock(organizationId: string, brandId: string, product: string | null | undefined): Promise<string> {
  const pub = await findPublicationForProduct(organizationId, brandId, product);
  if (!pub) return "";
  const editors = pub.editors.length
    ? await tenantDb(organizationId).pubEditor.findMany({ where: { id: { in: pub.editors.map((e) => e.id) } }, select: { id: true, voiceNotes: true } })
    : [];
  const voice = new Map(editors.map((e) => [e.id, e.voiceNotes]));
  return publicationPromptContext({ ...pub, editors: pub.editors.map((e) => ({ name: e.name, role: e.role, voiceNotes: voice.get(e.id) ?? null })) });
}

/** Names for pickers in other apps (e.g. Promo Analyzer's publisher/product/guru fields). */
export async function getPickerOptions(organizationId: string, brandId: string): Promise<{ publications: { code: string; name: string }[]; editors: string[] }> {
  const [pubs, editors] = await Promise.all([
    tenantDb(organizationId).calendarPublication.findMany({ where: { brandId, deletedAt: null, active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { code: true, name: true } }),
    tenantDb(organizationId).pubEditor.findMany({ where: { brandId, deletedAt: null, status: "active" }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { name: true } }),
  ]);
  return { publications: pubs, editors: editors.map((e) => e.name) };
}
