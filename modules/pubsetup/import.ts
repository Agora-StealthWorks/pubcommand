/**
 * Publication Setup import: a JSON file of publications, editors and who writes
 * what, with images as data URIs. Pure (no DB), so the dry run and the import
 * share one plan and the tests cover it.
 *
 * The rule is fill-only. A new code or editor is created; an existing one only
 * gets the fields it has left blank. Nothing an admin typed is ever overwritten,
 * so running the same file twice changes nothing the second time.
 */
import { EDITOR_FIELDS, EDITOR_ROLES, PUBLICATION_FIELDS, parseFields, slugify, type FieldDef, type FieldValue, type FieldValues, type FormLike } from "./fields";
import { slotForUpload, type LogoBackground } from "./logos";

export const IMPORT_FORMAT = "pubcommand.publication-setup/v1";
export const IMPORT_MAX_IMAGE_BYTES = 3 * 1024 * 1024;

export type ImportImage = { mime: string; data: Uint8Array<ArrayBuffer>; filename: string };

/**
 * Logos from a file: `logoLight` (for light backgrounds) and `logoDark` (for dark backgrounds)
 * go straight to their slot; `logo` is sorted by its artwork (placeLogos) into a slot the
 * file did not fill. Unsorted, it counts as the light-background logo.
 */
export type ImportLogos = { auto: ImportImage | null; light: ImportImage | null; dark: ImportImage | null };
export type ImportPublication = { values: FieldValues; logos: ImportLogos };
export type ImportEditor = { values: FieldValues; photo: ImportImage | null };
export type ImportLink = { code: string; editorSlug: string; role: string };

export type ParsedImport = {
  publications: ImportPublication[];
  editors: ImportEditor[];
  links: ImportLink[];
  brandLogos: ImportLogos;
  /** Problems with single records. Those records are left out; the rest still import. */
  warnings: string[];
  /** Publication fields the file replaces on existing records (see README). Everything else is fill-only. */
  replace: string[];
};

const IMAGE_MIME = /^image\/(png|jpeg|gif|webp|svg\+xml)$/;

export function decodeDataUri(raw: unknown, filename: string): ImportImage | null | "bad" {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") return "bad";
  const match = /^data:([a-z0-9.+/-]+);base64,([a-z0-9+/=\s]+)$/i.exec(raw);
  if (!match || !IMAGE_MIME.test(match[1]!.toLowerCase())) return "bad";
  const data = new Uint8Array(Buffer.from(match[2]!.replace(/\s+/g, ""), "base64"));
  if (data.length === 0 || data.length > IMPORT_MAX_IMAGE_BYTES) return "bad";
  const mime = match[1]!.toLowerCase();
  const ext = mime === "image/svg+xml" ? "svg" : mime.split("/")[1] === "jpeg" ? "jpg" : mime.split("/")[1];
  return { mime, data, filename: `${filename}.${ext}`.slice(0, 200) };
}

/** A JSON record as the form the editor would post, so the import validates exactly like the form. */
function recordForm(defs: readonly FieldDef[], record: Record<string, unknown>): FormLike {
  const entries = new Map<string, string>();
  for (const def of defs) {
    const value = record[def.key];
    if (value == null) continue;
    if (def.kind === "pairs") {
      if (!Array.isArray(value)) continue;
      value.slice(0, def.maxRows ?? 6).forEach((row, i) => {
        if (!row || typeof row !== "object") return;
        for (const column of def.columns ?? []) {
          const cell = (row as Record<string, unknown>)[column.key];
          if (typeof cell === "string" || typeof cell === "number") entries.set(`${def.key}.${i}.${column.key}`, String(cell));
        }
      });
    } else if (def.kind === "list") {
      entries.set(def.key, Array.isArray(value) ? value.filter((v) => typeof v === "string").join("\n") : String(value));
    } else if (typeof value === "string" || typeof value === "number") {
      entries.set(def.key, String(value));
    }
  }
  return { getAll: (name: string) => (entries.has(name) ? [entries.get(name)!] : []) };
}

function errorText(defs: readonly FieldDef[], errors: Record<string, string>): string {
  return Object.entries(errors)
    .map(([key, message]) => `${defs.find((d) => d.key === key)?.label ?? key}: ${message}`)
    .join("; ");
}

export function parseImport(text: string): { ok: true; file: ParsedImport } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file is not valid JSON." };
  }
  if (!raw || typeof raw !== "object" || (raw as { format?: unknown }).format !== IMPORT_FORMAT) {
    return { ok: false, error: `That is not a Publication Setup import file (expected format "${IMPORT_FORMAT}").` };
  }
  const body = raw as { publications?: unknown; editors?: unknown; brand?: unknown; replace?: unknown };
  const warnings: string[] = [];
  const replaceable = new Set(PUBLICATION_FIELDS.filter((d) => !d.required && !d.internal && d.kind !== "slug").map((d) => d.key));
  const replace = (Array.isArray(body.replace) ? body.replace : []).filter((key): key is string => typeof key === "string" && replaceable.has(key));
  const publications: ImportPublication[] = [];
  const editors: ImportEditor[] = [];
  const links: ImportLink[] = [];

  const editorRecords = Array.isArray(body.editors) ? body.editors.slice(0, 500) : [];
  for (const [i, record] of editorRecords.entries()) {
    if (!record || typeof record !== "object") continue;
    const rec: Record<string, unknown> = { status: "active", ...(record as Record<string, unknown>) };
    const parsed = parseFields(EDITOR_FIELDS, recordForm(EDITOR_FIELDS, rec));
    const label = typeof rec.name === "string" && rec.name ? rec.name : `Editor ${i + 1}`;
    if (!parsed.ok) {
      warnings.push(`${label} skipped. ${errorText(EDITOR_FIELDS, parsed.errors)}`);
      continue;
    }
    if (editors.some((e) => e.values.slug === parsed.values.slug)) {
      warnings.push(`${label} skipped. Another editor in the file has the URL name "${parsed.values.slug}".`);
      continue;
    }
    const photo = decodeDataUri(rec.photo, String(parsed.values.slug));
    if (photo === "bad") warnings.push(`${label}: the photo is not a PNG, JPG, GIF, WebP or SVG under 3 MB, so it was left out.`);
    editors.push({ values: parsed.values, photo: photo === "bad" ? null : photo });
  }

  const pubRecords = Array.isArray(body.publications) ? body.publications.slice(0, 500) : [];
  for (const [i, record] of pubRecords.entries()) {
    if (!record || typeof record !== "object") continue;
    const rec: Record<string, unknown> = { status: "active", color: "#7f77dd", ...(record as Record<string, unknown>) };
    const parsed = parseFields(PUBLICATION_FIELDS, recordForm(PUBLICATION_FIELDS, rec));
    const label = typeof rec.name === "string" && rec.name ? rec.name : `Publication ${i + 1}`;
    if (!parsed.ok) {
      warnings.push(`${label} skipped. ${errorText(PUBLICATION_FIELDS, parsed.errors)}`);
      continue;
    }
    const code = String(parsed.values.code);
    if (publications.some((p) => p.values.code === code)) {
      warnings.push(`${label} skipped. Code ${code} appears twice in the file.`);
      continue;
    }
    publications.push({ values: parsed.values, logos: readLogos(rec, code.toLowerCase(), label, warnings) });

    const refs = Array.isArray(rec.editors) ? rec.editors : [];
    for (const ref of refs) {
      const r = (typeof ref === "string" ? { editor: ref } : ref) as { editor?: unknown; slug?: unknown; role?: unknown } | null;
      const name = typeof r?.editor === "string" ? r.editor : typeof r?.slug === "string" ? r.slug : "";
      const editorSlug = slugify(name);
      if (!editorSlug) continue;
      if (!editors.some((e) => e.values.slug === editorSlug)) {
        warnings.push(`${label}: editor "${name}" is not in the file's editors list, so that link was left out.`);
        continue;
      }
      const role = typeof r?.role === "string" && (EDITOR_ROLES as readonly string[]).includes(r.role) ? r.role : "lead";
      if (!links.some((l) => l.code === code && l.editorSlug === editorSlug)) links.push({ code, editorSlug, role });
    }
  }

  const brand = body.brand && typeof body.brand === "object" ? (body.brand as Record<string, unknown>) : {};
  const brandLogos = readLogos(brand, "brand-logo", "The brand", warnings);

  if (publications.length === 0 && editors.length === 0) return { ok: false, error: warnings[0] ?? "The file has no publications or editors." };
  return { ok: true, file: { publications, editors, links, brandLogos, warnings, replace } };
}

const LOGO_KEYS = [
  ["logo", "auto", "the logo"],
  ["logoLight", "light", "the logo for light backgrounds"],
  ["logoDark", "dark", "the logo for dark backgrounds"],
] as const;

function readLogos(rec: Record<string, unknown>, base: string, label: string, warnings: string[]): ImportLogos {
  const out: ImportLogos = { auto: null, light: null, dark: null };
  for (const [key, slot, what] of LOGO_KEYS) {
    const image = decodeDataUri(rec[key], slot === "auto" ? base : `${base}-on-${slot}`);
    if (image === "bad") warnings.push(`${label}: ${what} is not a PNG, JPG, GIF, WebP or SVG under 3 MB, so it was left out.`);
    else out[slot] = image;
  }
  return out;
}

/**
 * Put an auto-sorted `logo` into its slot. A slot the file filled by name wins; when the
 * matching slot is taken the logo goes to the other one if that is free, else it is dropped.
 */
export function placeLogos(logos: ImportLogos, tone: LogoBackground | null): ImportLogos {
  if (!logos.auto) return logos;
  const want = slotForUpload(tone);
  const other: LogoBackground = want === "light" ? "dark" : "light";
  const slot = !logos[want] ? want : !logos[other] && tone === null ? other : null;
  return { auto: null, light: logos.light, dark: logos.dark, ...(slot ? { [slot]: logos.auto } : {}) };
}

/** The final light/dark images of a record (an unsorted `logo` counts as the light one). */
export function logoSlotsOf(logos: ImportLogos): { light: ImportImage | null; dark: ImportImage | null } {
  const placed = placeLogos(logos, null);
  return { light: placed.light, dark: placed.dark };
}

// ── Plan ───────────────────────────────────────────────────────────────────

function blank(value: unknown): boolean {
  if (value == null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** The imported fields an existing record has left blank. Required and layout fields are never touched. */
export function fillBlanks(defs: readonly FieldDef[], existing: Record<string, unknown>, incoming: FieldValues, skip: readonly string[] = [], replace: readonly string[] = []): FieldValues {
  const out: FieldValues = {};
  for (const def of defs) {
    if (def.required || def.internal || def.kind === "slug" || skip.includes(def.key)) continue;
    const value: FieldValue | undefined = incoming[def.key];
    if (replace.includes(def.key)) {
      // Replaced fields take the file's value, including clearing them, when it differs.
      const norm = (v: unknown) => JSON.stringify(blank(v) ? null : v);
      if (norm(value) !== norm(existing[def.key])) out[def.key] = value ?? (def.kind === "list" || def.kind === "pairs" ? [] : null);
      continue;
    }
    if (blank(value) || !blank(existing[def.key])) continue;
    out[def.key] = value!;
  }
  return out;
}

export type ExistingPublication = Record<string, unknown> & { id: string; code: string; slug: string | null; hasLogoLight: boolean; hasLogoDark: boolean };
export type ExistingEditor = Record<string, unknown> & { id: string; slug: string; name: string; hasPhoto: boolean };

export type PlanStep<T> = {
  action: "create" | "fill" | "same";
  label: string;
  record: T;
  existingId: string | null;
  fill: FieldValues;
  /** An image is added (editor photo, or any publication logo slot). */
  image: boolean;
  /** Publications only: which logo slots the import fills. */
  logoSlots?: { light: boolean; dark: boolean };
};

export type ImportPlan = {
  publications: PlanStep<ImportPublication>[];
  editors: PlanStep<ImportEditor>[];
  links: (ImportLink & { action: "create" | "same" })[];
  /** Brand logo slots the import fills (only empty ones). */
  brandLogos: { light: boolean; dark: boolean };
  brandLogo: boolean;
  counts: { create: number; fill: number; same: number; links: number };
};

function labelFill(defs: readonly FieldDef[], fill: FieldValues, images: string[], replace: readonly string[] = []): string {
  const label = (key: string) => defs.find((d) => d.key === key)?.label.toLowerCase() ?? key;
  const keys = Object.keys(fill);
  const added = [...keys.filter((k) => !replace.includes(k)).map(label), ...images];
  const replaced = keys.filter((k) => replace.includes(k)).map(label);
  const parts = [added.length ? `adds ${added.join(", ")}` : "", replaced.length ? `replaces ${replaced.join(", ")}` : ""].filter(Boolean);
  return parts.length ? parts.join("; ") : "already up to date";
}

export function planImport(
  file: ParsedImport,
  existing: { publications: ExistingPublication[]; editors: ExistingEditor[]; links: { code: string; editorSlug: string }[]; brandLogos: { light: boolean; dark: boolean } },
): ImportPlan {
  const editors = file.editors.map((record): PlanStep<ImportEditor> => {
    const slug = String(record.values.slug);
    const name = String(record.values.name).toLowerCase();
    const match = existing.editors.find((e) => e.slug === slug) ?? existing.editors.find((e) => e.name.toLowerCase() === name);
    if (!match) return { action: "create", label: "new", record, existingId: null, fill: {}, image: Boolean(record.photo) };
    const fill = fillBlanks(EDITOR_FIELDS, match, record.values, ["status"]);
    const image = Boolean(record.photo) && !match.hasPhoto;
    const action = Object.keys(fill).length || image ? "fill" : "same";
    return { action, label: labelFill(EDITOR_FIELDS, fill, image ? ["photo"] : []), record, existingId: match.id, fill, image };
  });

  const publications = file.publications.map((record): PlanStep<ImportPublication> => {
    const code = String(record.values.code);
    const match = existing.publications.find((p) => p.code === code);
    const slots = logoSlotsOf(record.logos);
    if (!match) {
      const logoSlots = { light: Boolean(slots.light), dark: Boolean(slots.dark) };
      return { action: "create", label: "new", record, existingId: null, fill: {}, image: logoSlots.light || logoSlots.dark, logoSlots };
    }
    const fill = fillBlanks(PUBLICATION_FIELDS, match, record.values, [], file.replace);
    const logoSlots = { light: Boolean(slots.light) && !match.hasLogoLight, dark: Boolean(slots.dark) && !match.hasLogoDark };
    const image = logoSlots.light || logoSlots.dark;
    const action = Object.keys(fill).length || image ? "fill" : "same";
    const images = [...(logoSlots.light ? ["logo for light backgrounds"] : []), ...(logoSlots.dark ? ["logo for dark backgrounds"] : [])];
    return { action, label: labelFill(PUBLICATION_FIELDS, fill, images, file.replace), record, existingId: match.id, fill, image, logoSlots };
  });

  // An imported editor may match an existing one under a different slug (same name).
  const slugFor = new Map(editors.map((step) => [String(step.record.values.slug), step.existingId ? (existing.editors.find((e) => e.id === step.existingId)?.slug ?? "") : String(step.record.values.slug)]));
  const links = file.links.map((link) => {
    const editorSlug = slugFor.get(link.editorSlug) ?? link.editorSlug;
    const have = existing.links.some((l) => l.code === link.code && l.editorSlug === editorSlug);
    return { ...link, action: have ? ("same" as const) : ("create" as const) };
  });

  const all = [...editors, ...publications];
  const brandSlots = logoSlotsOf(file.brandLogos);
  const brandLogos = { light: Boolean(brandSlots.light) && !existing.brandLogos.light, dark: Boolean(brandSlots.dark) && !existing.brandLogos.dark };
  return {
    publications,
    editors,
    links,
    brandLogos,
    brandLogo: brandLogos.light || brandLogos.dark,
    counts: {
      create: all.filter((s) => s.action === "create").length,
      fill: all.filter((s) => s.action === "fill").length,
      same: all.filter((s) => s.action === "same").length,
      links: links.filter((l) => l.action === "create").length,
    },
  };
}
