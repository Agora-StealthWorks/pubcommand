/**
 * The old OxfordHub Promo Analyzer and Packager → PubCommand.
 *
 * Their saved reviews already hold a full analysis in the same sections
 * PubCommand writes (headline, outline, 16-word letter, CUB flags as JSON,
 * offer, tease, intel as JSON, scorecard lines), so a review becomes a stored
 * analysis without re-running the AI. Pure: mapping only, no database.
 */
import { LESSON_CATEGORIES, type LessonCategory } from "./lessons";
import { componentSpec } from "./packager";
import { normalizeCode } from "./performance";
import type { SectionKey } from "./sections";
import { isOrderForm } from "./vault-promos";

/** Old review section → PubCommand section. */
const SECTION_MAP: Record<string, SectionKey> = {
  headline: "HEADLINE",
  outline: "OUTLINE",
  evaldo: "SIXTEEN_WORD",
  cub: "CUB",
  offer: "OFFER",
  stockTease: "TEASE",
  promoIntel: "INTEL",
  effectiveness: "SCORECARD",
};

const ORDER: SectionKey[] = ["HEADLINE", "OUTLINE", "SIXTEEN_WORD", "CUB", "OFFER", "TEASE", "INTEL", "SCORECARD"];

/** The streamed-answer text (<<KEY>> … <</KEY>>) for an old review's sections. Older reviews kept the scorecard only as subScores. */
export function rawFromOldSections(sections: Record<string, unknown> | null | undefined, subScores?: readonly { dimension?: string; score?: number; rationale?: string }[] | null): string {
  const byKey = new Map<SectionKey, string>();
  for (const [oldKey, value] of Object.entries(sections ?? {})) {
    const key = SECTION_MAP[oldKey];
    if (!key || value == null) continue;
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    if (text.trim()) byKey.set(key, text.trim());
  }
  const hasCard = /\d+(?:\.\d+)?\s*\/\s*10/.test(byKey.get("SCORECARD") ?? "");
  if (!hasCard && subScores?.length) {
    const lines = subScores.filter((s) => s.dimension && typeof s.score === "number").map((s, i) => `${i + 1}. ${s.dimension}: ${s.score}/10 — ${(s.rationale ?? "").replace(/\s+/g, " ").trim()}`);
    if (lines.length) byKey.set("SCORECARD", [lines.join("\n"), byKey.get("SCORECARD") ?? ""].filter(Boolean).join("\n"));
  }
  return ORDER.filter((key) => byKey.has(key))
    .map((key) => `<<${key}>>\n${byKey.get(key)}\n<</${key}>>`)
    .join("\n\n");
}

/** The promo text from a vault "Promo Copy - …" note: everything after the header's "---". */
export function sourceCopyFromNote(markdown: string): string {
  let body = markdown.replace(/^﻿?---\n[\s\S]*?\n---\n/, "");
  const heading = body.search(/^# /m);
  if (heading >= 0) body = body.slice(heading);
  const rule = body.search(/^---\s*$/m);
  return (rule >= 0 ? body.slice(rule).replace(/^---\s*\n/, "") : body).trim();
}

export function reviewIdFromNote(markdown: string): string | null {
  return /^review_id:\s*"?([0-9a-f-]{36})"?\s*$/m.exec(markdown)?.[1] ?? null;
}

/** Old supplemental-file category → Packager component kind (null: kept as a file, not a training example). */
export function kindForOldCategory(category: string | null | undefined): string | null {
  const c = (category ?? "").toLowerCase().trim();
  if (!c) return null;
  const hotlist = c.startsWith("hotlist");
  if (hotlist) {
    if (c.includes("lift")) return "event-lift-notes";
    if (c.includes("space")) return "event-space-ads";
    if (c.includes("warm")) return "event-warmup-emails";
    if (c.includes("reminder")) return "event-reminder-emails";
    if (c.includes("text")) return "event-text-ads";
    return null;
  }
  if (c.includes("lift")) return "vsl-lift-notes";
  if (c.includes("order form") && !c.includes("exit")) return "order-form";
  if (c.includes("space")) return "space-ads";
  if (c.includes("exit")) return "exit-popup";
  if (c.includes("cart")) return "cart-abandon-emails";
  if (c.includes("upsell")) return "lifetime-upsell";
  if (c.includes("short text") || c === "text ads") return "short-text-ads";
  if (c.includes("youtube")) return "youtube-video-ads";
  if (c.includes("facebook video")) return "facebook-video-ads";
  if (c.includes("facebook text")) return "facebook-text-ads";
  if (c.includes("headline")) return "alternative-headlines";
  if (c.includes("editorial")) return "editorial-guide";
  return null;
}

/** Old Packager slug → PubCommand kind (the old "hotlist" set is PubCommand's "event" set). */
export function kindForOldSlug(slug: string): string | null {
  const kind = slug.startsWith("hotlist-") ? `event-${slug.slice("hotlist-".length)}` : slug;
  return componentSpec(kind) ? kind : null;
}

/** An old package component's items as PubCommand component content (### per item). */
export function componentContent(kind: string, items: readonly { text?: string | null }[]): string {
  const spec = componentSpec(kind);
  const texts = items.map((item) => (item.text ?? "").trim()).filter(Boolean);
  const many = texts.length > 1;
  return texts.map((text, index) => `### ${many ? `${spec?.itemName ?? "Item"} ${index + 1}` : (spec?.itemName ?? "Item")}\n\n${text}`).join("\n\n");
}

const LESSON_CATEGORY_MAP: Record<string, LessonCategory> = {
  hook: "hook",
  headline: "headline",
  emotional_pull: "hook",
  proof: "proof",
  credibility: "proof",
  believability: "proof",
  mechanism: "proof",
  offer: "offer",
  structure: "structure",
  guru: "voice",
  voice: "voice",
  audience: "audience",
  close: "close",
  compliance: "compliance",
};

/** An old learning-KB lesson as a Lessons entry. */
export function lessonFromOld(old: { lesson?: string; category?: string; guru?: string | null; publication?: string | null; promoType?: string | null; evidenceCount?: number; isGoldStandard?: boolean; performanceTier?: string | null; publisherReasoning?: string | null }): {
  title: string;
  body: string;
  category: LessonCategory;
  evidenceCount: number;
  fromResults: boolean;
} | null {
  const lesson = (old.lesson ?? "").replace(/\s+/g, " ").trim();
  if (!lesson) return null;
  const firstSentence = /^(.{20,160}?[.!?])(\s|$)/.exec(lesson)?.[1] ?? lesson;
  const title = firstSentence.length > 140 ? `${firstSentence.slice(0, 137).trimEnd()}…` : firstSentence;
  const context = [old.guru ? `Guru: ${old.guru}` : "", old.publication ? `Publication: ${old.publication}` : "", old.promoType ? `Type: ${old.promoType}` : "", old.performanceTier ? `Result: ${old.performanceTier.replace(/_/g, " ")}` : ""].filter(Boolean);
  const body = [lesson, context.length ? `\n${context.join(" · ")}` : "", old.publisherReasoning ? `\nPublisher's note: ${old.publisherReasoning.trim()}` : ""].join("").trim();
  const mapped = LESSON_CATEGORY_MAP[(old.category ?? "").toLowerCase()];
  return {
    title,
    body,
    category: mapped && (LESSON_CATEGORIES as readonly string[]).includes(mapped) ? mapped : "other",
    evidenceCount: Math.max(0, Math.round(old.evidenceCount ?? 1)),
    fromResults: Boolean(old.performanceTier) || Boolean(old.isGoldStandard),
  };
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** One old performance-sheet record (raw sheet columns) as PubCommand performance fields. */
export function performanceFromOld(record: { promoCode?: string | null; stats?: Record<string, unknown> | null; notes?: string | null }): {
  codeKey: string;
  promoCode: string;
  label: string | null;
  views: number | null;
  clicks: number | null;
  orders: number | null;
  revenue: number | null;
  extra: Record<string, unknown>;
} | null {
  const promoCode = (record.promoCode ?? "").trim();
  const codeKey = normalizeCode(promoCode);
  if (!codeKey) return null;
  const stats = record.stats ?? {};
  const pick = (...names: string[]) => {
    for (const name of names) {
      const key = Object.keys(stats).find((k) => k.toLowerCase() === name.toLowerCase());
      if (key) return num(stats[key]);
    }
    return null;
  };
  const label = [stats["Affiliate"], stats["Primary Item"]].filter((v) => typeof v === "string" && v.trim()).join(" · ") || null;
  return {
    codeKey,
    promoCode,
    label,
    views: pick("Total IRIS Promotion Views", "Promotion Views", "Views"),
    clicks: pick("Total IRIS Clicks to Order From", "Total IRIS Clicks to Order Form", "Clicks to Order Form", "Clicks"),
    orders: pick("Total Gross Orders", "Gross Orders", "Orders"),
    revenue: pick("Total Gross Revenue", "Gross Revenue", "Revenue"),
    extra: { ...stats, ...(record.notes ? { Notes: record.notes } : {}) },
  };
}

const GENERIC_TITLE_WORDS = new Set(["package", "script", "for", "video", "marked", "final", "to", "design", "legal", "edits", "page", "promo", "the", "a", "of", "and", "v1", "v2", "v3", "v4", "copy", "clean"]);

function titleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !GENERIC_TITLE_WORDS.has(word));
}

/**
 * The analyzed promo an old Packager package belongs to. Only packages that were
 * attached to a promo in OxfordHub (brief.reviewId) are matched: by that review
 * id, else by name (same publication code first, and every other significant
 * word of the package title in the promo's name). Null: no analyzed promo.
 */
export function matchPackagePromo(
  brief: { title?: string | null; reviewId?: string | null },
  promos: readonly { id: string; reviewId: string | null; names: readonly string[] }[],
): string | null {
  if (!brief.reviewId) return null;
  const byId = promos.find((p) => p.reviewId === brief.reviewId);
  if (byId) return byId.id;
  const want = titleTokens(brief.title ?? "");
  if (want.length < 2) return null;
  const [code, ...rest] = want;
  const hits = promos.filter((p) =>
    p.names.some((name) => {
      const have = titleTokens(name);
      return have[0] === code && rest.every((word) => have.includes(word));
    }),
  );
  return hits.length === 1 ? hits[0]!.id : null;
}

/**
 * The Packager component a document's name says it is ("SKI Infinite lifts" → lift
 * notes, "… Space Ads", "… Order Form"…), or null for a promo. The Promo Analyzer
 * holds promos only: Packager output (lift notes, ads, emails, order forms, upsells)
 * is Packager material, never a promo to analyze. Checks one name (title or file name).
 */
export function packagerKindFromName(name: string | null | undefined): string | null {
  const file = (name ?? "").split("/").pop() ?? "";
  const n = file
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/[_]+/g, " ")
    .toLowerCase();
  if (!n.trim()) return null;
  const event = /\b(hotlist|event|webinar)\b/.test(n);
  if (/\blift(?:s|\s*notes?|\s*emails?)?\b(?![\s-]*off)/.test(n) || /\binvit(?:e|ation)\s*emails?\b/.test(n)) return event ? "event-lift-notes" : "vsl-lift-notes";
  if (/\bwarm[\s-]*ups?(?:\s*emails?)?\b/.test(n)) return "event-warmup-emails";
  if (/\breminder\s*emails?\b/.test(n)) return "event-reminder-emails";
  if (/\bspace\s*ads?\b/.test(n)) return event ? "event-space-ads" : "space-ads";
  if (/\b(?:facebook|fb)\s*video\s*ads?\b/.test(n)) return "facebook-video-ads";
  if (/\b(?:youtube|yt)\s*(?:video\s*)?ads?\b/.test(n)) return "youtube-video-ads";
  if (/\b(?:facebook|fb)\s*(?:text\s*)?ads?\b/.test(n)) return "facebook-text-ads";
  if (/\b(?:short\s*)?(?:text|sms)\s*ads?\b/.test(n)) return event ? "event-text-ads" : "short-text-ads";
  if (/\bcart\s*(?:abandon(?:ment)?|recovery)\b/.test(n)) return "cart-abandon-emails";
  if (/\bexit\s*pop(?:[\s-]*up)?s?\b/.test(n)) return "exit-popup";
  if (/\bupsells?\b/.test(n)) return "lifetime-upsell";
  if (/\balt(?:ernative|\.)?\s*headlines\b/.test(n)) return "alternative-headlines";
  if (/\beditorial\s*guide\b/.test(n)) return "editorial-guide";
  if (isOrderForm(file)) return "order-form";
  return null;
}

/** The Packager kind of a promo whose title or file name marks it as Packager output, else null. */
export function packagerKindOfPromo(promo: { title?: string | null; filename?: string | null }): string | null {
  return packagerKindFromName(promo.title) ?? packagerKindFromName(promo.filename);
}
