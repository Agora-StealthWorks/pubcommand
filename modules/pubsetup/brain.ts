import { EDITOR_FIELDS, EDITOR_ROLE_LABELS, PUBLICATION_FIELDS, PUBLICATION_STATUS_LABELS, asPairs, type FieldDef, type FieldValue } from "./fields";
import type { ResolvedBranding } from "./branding";

/**
 * Facts: a flat field -> value snapshot of what people entered in Publication Setup.
 * A later conflict checker compares these with what the Brain believes. Shape (v1):
 *
 *   { version: 1, kind: "publication" | "editor", ref: "pub:<id>" | "editor:<id>",
 *     brand: "<brand name>", updatedAt: "<ISO>", fields: { [field]: string | string[] } }
 *
 * Only non-empty fields appear. Pair fields become "label: price term" strings.
 */
export type Facts = {
  version: 1;
  kind: "publication" | "editor";
  ref: string;
  brand: string;
  updatedAt: string;
  fields: Record<string, string | string[]>;
};

export type FactRecord = Record<string, unknown>;

function pairText(key: string, row: Record<string, string>): string {
  if (key === "offers") return [row.label, row.price, row.term].filter(Boolean).join(" · ");
  if (key === "sampleIssues") return [row.title, row.url].filter(Boolean).join(" ");
  return [row.label, row.url].filter(Boolean).join(": ");
}

function factValue(def: FieldDef, value: unknown): string | string[] | null {
  if (value == null) return null;
  if (def.kind === "pairs") {
    const rows = asPairs(value).map((row) => pairText(def.key, row)).filter(Boolean);
    return rows.length ? rows : null;
  }
  if (Array.isArray(value)) {
    const items = value.map(String).filter(Boolean);
    return items.length ? items : null;
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value as FieldValue).trim();
  return text ? text : null;
}

function collect(defs: readonly FieldDef[], record: FactRecord): Record<string, string | string[]> {
  const fields: Record<string, string | string[]> = {};
  for (const def of defs) {
    if (def.internal) continue;
    const value = factValue(def, record[def.key]);
    if (value != null) fields[def.key] = value;
  }
  return fields;
}

export function publicationFacts(input: {
  id: string;
  brandName: string;
  record: FactRecord;
  editors: readonly { name: string; role: string }[];
  branding?: ResolvedBranding | null;
  archived?: boolean;
  now?: Date;
}): Facts {
  const fields = collect(PUBLICATION_FIELDS, input.record);
  if (input.editors.length) fields.editors = input.editors.map((e) => `${e.name} (${EDITOR_ROLE_LABELS[e.role] ?? e.role})`);
  if (input.branding) {
    const b = input.branding.values;
    if (b.senderName) fields.senderName = b.senderName;
    if (b.senderEmail) fields.senderEmail = b.senderEmail;
  }
  if (input.archived) fields.archived = "yes";
  return { version: 1, kind: "publication", ref: `pub:${input.id}`, brand: input.brandName, updatedAt: (input.now ?? new Date()).toISOString(), fields };
}

export function editorFacts(input: {
  id: string;
  brandName: string;
  record: FactRecord;
  publications: readonly { name: string; code: string; role: string }[];
  archived?: boolean;
  now?: Date;
}): Facts {
  const fields = collect(EDITOR_FIELDS, input.record);
  delete fields.email;
  if (input.publications.length) fields.publications = input.publications.map((p) => `${p.name} (${p.code}, ${EDITOR_ROLE_LABELS[p.role] ?? p.role})`);
  if (input.archived) fields.archived = "yes";
  return { version: 1, kind: "editor", ref: `editor:${input.id}`, brand: input.brandName, updatedAt: (input.now ?? new Date()).toISOString(), fields };
}

function section(title: string, value: string | string[] | undefined): string[] {
  if (!value || (Array.isArray(value) && !value.length)) return [];
  return Array.isArray(value) ? ["", `## ${title}`, ...value.map((v) => `- ${v}`)] : ["", `## ${title}`, value];
}

function labelOf(defs: readonly FieldDef[], key: string): string {
  return defs.find((d) => d.key === key)?.label ?? key;
}

/** The Brain note for one publication (folder "Publications", sourceRef pub:<id>). */
export function publicationNote(facts: Facts): { title: string; body: string } {
  const f = facts.fields;
  const name = String(f.name ?? "Publication");
  const code = f.code ? ` (${String(f.code)})` : "";
  const status = PUBLICATION_STATUS_LABELS[String(f.status ?? "active")] ?? String(f.status ?? "");
  const line = [f.pubType, f.tier, f.frequency, status, f.launchDate ? `launched ${String(f.launchDate)}` : ""].filter(Boolean).join(" · ");
  const lines = [
    `${name}${code} is a ${facts.brand} publication.${f.archived ? " It is archived and no longer offered." : ""}`,
    line ? `${line}` : "",
    f.tagline ? `Tagline: ${String(f.tagline)}` : "",
    ...section("Short description", f.description),
    ...section("About", f.longDescription),
    ...section("Positioning", f.positioning),
    ...section("Audience", f.audience),
    ...section("What readers get", f.deliverables),
    ...section("Editors", f.editors),
    ...section("Price points and offers", f.offers),
    ...section("Voice and style", f.voiceNotes),
    ...section("Compliance notes", f.complianceNotes),
    ...section(
      "Links",
      (["websiteUrl", "signupUrl", "archiveUrl"] as const).flatMap((key) => (f[key] ? [`${labelOf(PUBLICATION_FIELDS, key)}: ${String(f[key])}`] : [])),
    ),
    ...section("Sample issues", f.sampleIssues),
    "",
    "Source: Publication Setup (entered by the publisher's admins). Treat these as the official facts about this publication.",
  ];
  return { title: `${name}${code}`, body: lines.filter((l, i, all) => l !== "" || (i > 0 && all[i - 1] !== "")).join("\n").trim() };
}

/** The Brain note for one editor (folder "Editors", sourceRef editor:<id>). */
export function editorNote(facts: Facts): { title: string; body: string } {
  const f = facts.fields;
  const name = String(f.name ?? "Editor");
  const lines = [
    `${name}${f.title ? `, ${String(f.title)}` : ""}, is an editor at ${facts.brand}.${f.archived || f.status === "inactive" ? " No longer active." : ""}`,
    ...section("Publications", f.publications),
    ...section("Short bio", f.shortBio),
    ...section("Bio", f.longBio),
    ...section("Credentials", f.credentials),
    ...section("Track record (as entered)", f.trackRecord),
    ...section("Specialties", f.specialties),
    ...section("Voice and style", f.voiceNotes),
    ...section("Links", f.socialLinks),
    "",
    "Source: Publication Setup (entered by the publisher's admins).",
  ];
  return { title: name, body: lines.filter((l, i, all) => l !== "" || (i > 0 && all[i - 1] !== "")).join("\n").trim() };
}

/** A prompt block about one publication, for AI drafts (Packager and others). Facts come from people. */
export function publicationPromptContext(input: {
  name: string;
  code: string;
  tagline?: string | null;
  description?: string | null;
  positioning?: string | null;
  audience?: string | null;
  voiceNotes?: string | null;
  complianceNotes?: string | null;
  editors?: readonly { name: string; role: string; voiceNotes?: string | null }[];
}): string {
  const parts = [
    `<publication>`,
    `Publication: ${input.name} (${input.code})${input.tagline ? ` · ${input.tagline}` : ""}`,
    input.description ? `About: ${input.description}` : "",
    input.positioning ? `Positioning: ${input.positioning}` : "",
    input.audience ? `Its reader: ${input.audience}` : "",
    input.voiceNotes ? `Voice and style: ${input.voiceNotes}` : "",
    ...(input.editors ?? []).map((e) => `Editor: ${e.name} (${EDITOR_ROLE_LABELS[e.role] ?? e.role})${e.voiceNotes ? `. Voice: ${e.voiceNotes}` : ""}`),
    input.complianceNotes
      ? `Publication compliance rules (follow them too):\n${input.complianceNotes
          .split("\n")
          .map((l) => l.replace(/^[-*•]\s*/, "").trim())
          .filter(Boolean)
          .map((l) => `- ${l}`)
          .join("\n")}`
      : "",
    `</publication>`,
  ];
  return parts.filter(Boolean).join("\n");
}

/** The publication a promo belongs to, from its free-text product field: code, slug or name. */
export function matchPublication<T extends { code: string; name: string; slug?: string | null }>(product: string | null | undefined, publications: readonly T[]): T | null {
  const wanted = (product ?? "").trim().toLowerCase();
  if (!wanted) return null;
  const exact = publications.find((p) => p.code.toLowerCase() === wanted || p.name.toLowerCase() === wanted || (p.slug ?? "").toLowerCase() === wanted);
  if (exact) return exact;
  const contained = publications
    .filter((p) => p.name.length >= 4 && wanted.includes(p.name.toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length);
  return contained[0] ?? null;
}
