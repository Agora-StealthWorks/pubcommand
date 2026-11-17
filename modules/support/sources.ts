/**
 * Pure mapping from other apps' data to Support Knowledge record drafts.
 *
 * Publication Setup: public-safe fields only. Positioning, target audience, voice notes,
 * compliance notes, tier, internal email and editor track-record claims never come across.
 * Offers become a pricing record that always starts as a draft: a person confirms the
 * retail list price before an agent may say it.
 *
 * Brain notes: copied only after the gate passes and a person approves (features side).
 */
import { contentHash } from "./render";
import type { Category, RecordStatus } from "./taxonomy";

export type SourceDraft = {
  sourceRef: string;
  category: Category;
  audience: "public" | "member";
  status: RecordStatus;
  title: string;
  body: string;
  url: string | null;
  publicationCodes: string[];
  tags: string[];
  sourceHash: string;
};

export type PubInput = {
  id: string;
  code: string;
  name: string;
  tagline: string | null;
  pubType: string | null;
  frequency: string | null;
  status: string;
  description: string | null;
  longDescription: string | null;
  deliverables: string[];
  offers: { label: string; price: string; term: string }[];
  websiteUrl: string | null;
  signupUrl: string | null;
  archived: boolean;
  editors: { name: string; role: string; title: string | null }[];
};

export type EditorInput = {
  id: string;
  name: string;
  title: string | null;
  status: string;
  shortBio: string | null;
  longBio: string | null;
  credentials: string | null;
  specialties: string[];
  archived: boolean;
  publications: { code: string; name: string; role: string }[];
};

const ROLE: Record<string, string> = { lead: "lead editor", "co-editor": "co-editor", contributor: "contributor", analyst: "analyst", guest: "guest contributor" };

function finish(draft: Omit<SourceDraft, "sourceHash">): SourceDraft {
  return { ...draft, sourceHash: contentHash(JSON.stringify([draft.title, draft.body, draft.url, draft.status, draft.publicationCodes])) };
}

function lines(...parts: (string | null | undefined | false)[]): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join("\n\n");
}

export function publicationDraft(pub: PubInput): SourceDraft {
  const gone = pub.archived || pub.status === "retired";
  const kind = [pub.frequency, pub.pubType].filter(Boolean).join(" ").toLowerCase();
  const editors = pub.editors.map((e) => `${e.name}${e.title ? `, ${e.title}` : ""} (${ROLE[e.role] ?? e.role})`);
  const body = lines(
    `${pub.name} (${pub.code})${kind ? ` is a ${kind}` : ""}${pub.tagline ? `: ${pub.tagline}` : "."}`,
    pub.status === "paused" ? `${pub.name} is currently paused.` : null,
    pub.status === "launching" ? `${pub.name} is launching soon.` : null,
    pub.longDescription || pub.description,
    pub.deliverables.length ? `What members get:\n${pub.deliverables.map((d) => `- ${d}`).join("\n")}` : null,
    editors.length ? `Written by: ${editors.join("; ")}.` : null,
    pub.websiteUrl ? `Website: ${pub.websiteUrl}` : null,
  );
  return finish({
    sourceRef: `pubsetup:pub:${pub.id}`,
    category: "products",
    audience: "public",
    status: gone ? "archived" : "published",
    title: pub.name,
    body,
    url: pub.websiteUrl,
    publicationCodes: [pub.code.toUpperCase()],
    tags: [pub.code.toUpperCase(), ...(pub.pubType ? [pub.pubType] : [])],
  });
}

/** Retail list prices from the publication's offers. Always a draft until a person confirms it. */
export function pricingDraft(pub: PubInput): SourceDraft | null {
  const offers = pub.offers.filter((o) => o.price.trim());
  if (!offers.length && !pub.signupUrl) return null;
  const body = lines(
    offers.length ? `Retail list prices for ${pub.name} (${pub.code}):\n${offers.map((o) => `- ${[o.label, o.price, o.term].filter((x) => x.trim()).join(", ")}`).join("\n")}` : null,
    pub.signupUrl ? `How to join ${pub.name}: use the order page at ${pub.signupUrl}` : null,
  );
  return finish({
    sourceRef: `pubsetup:price:${pub.id}`,
    category: "pricing",
    audience: "public",
    status: pub.archived || pub.status === "retired" ? "archived" : "draft",
    title: `${pub.name}: price and how to join`,
    body,
    url: pub.signupUrl,
    publicationCodes: [pub.code.toUpperCase()],
    tags: [pub.code.toUpperCase(), "price"],
  });
}

export function editorDraft(editor: EditorInput): SourceDraft {
  const pubs = editor.publications.map((p) => `${p.name} (${ROLE[p.role] ?? p.role})`);
  const body = lines(
    `${editor.name}${editor.title ? `, ${editor.title}` : ""}.`,
    editor.longBio || editor.shortBio,
    editor.credentials ? `Background: ${editor.credentials}` : null,
    editor.specialties.length ? `Focus areas: ${editor.specialties.join(", ")}.` : null,
    pubs.length ? `Writes for: ${pubs.join("; ")}.` : null,
  );
  return finish({
    sourceRef: `pubsetup:editor:${editor.id}`,
    category: "editors",
    audience: "public",
    status: editor.archived || editor.status !== "active" ? "archived" : "published",
    title: editor.name,
    body,
    url: null,
    publicationCodes: editor.publications.map((p) => p.code.toUpperCase()),
    tags: editor.specialties.slice(0, 10),
  });
}

export type SyncAction = "create" | "update" | "skip-locked" | "unchanged";

/** What the Publication Setup sync does with one draft, given the record already there (if any). */
export function syncAction(existing: { sourceHash: string | null; locked: boolean } | null, draft: SourceDraft): SyncAction {
  if (!existing) return "create";
  if (existing.locked) return "skip-locked";
  return existing.sourceHash === draft.sourceHash ? "unchanged" : "update";
}

/** A Brain note as plain Markdown for a proposal: no frontmatter, no embeds, wikilinks as text. */
export function noteToText(body: string): string {
  return body
    .replace(/^---\n[\s\S]*?\n---\n?/, "")
    .replace(/!\[\[[^\]]*\]\]/g, "")
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
