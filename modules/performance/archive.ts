/**
 * Call archive rules (the Guru Time Machine idea). Pure.
 *
 * The archive home lists nothing until someone picks an expert or searches a ticker. Ticker search is the only
 * cross-expert list, and there the expert is the first column.
 */

export type ArchiveMode = { kind: "none" } | { kind: "expert"; expertId: string } | { kind: "ticker"; ticker: string };

export function archiveMode(query: { expert?: string | null; q?: string | null }): ArchiveMode {
  const ticker = normalizeTicker(query.q ?? "");
  if (ticker) return { kind: "ticker", ticker };
  const expertId = String(query.expert ?? "").trim();
  if (/^[0-9a-f-]{36}$/i.test(expertId)) return { kind: "expert", expertId };
  return { kind: "none" };
}

export function normalizeTicker(raw: string): string {
  return raw.trim().toUpperCase().replace(/^\$/, "").replace(/[^A-Z0-9.:\-^/]/g, "").slice(0, 24);
}

export const CALL_TYPES = ["Recommendation", "Prediction", "Interview", "Quote", "Other"] as const;
export type CallType = (typeof CALL_TYPES)[number];

export const GAIN_BASIS_LABELS = {
  TODAY: "Entry to today",
  PEAK: "Entry to peak",
  EXIT: "Entry to exit (frozen)",
  NONE: "No gain (not a trade)",
} as const;

export const FILE_ROLES = ["BACKUP", "GAIN_BACKUP", "PRICE_HISTORY", "SIGNOFF", "OTHER"] as const;
export type FileRole = (typeof FILE_ROLES)[number];
export const FILE_ROLE_LABELS: Record<FileRole, string> = {
  BACKUP: "Original backup",
  GAIN_BACKUP: "Gain backup",
  PRICE_HISTORY: "Price history",
  SIGNOFF: "Sign-off",
  OTHER: "Other",
};

/** Mime types the browser may show inline. Anything else downloads. */
export function inlineMime(mime: string): boolean {
  return /^image\/(png|jpe?g|gif|webp)$/.test(mime) || mime === "application/pdf" || /^video\/(mp4|webm)$/.test(mime);
}

export const CATEGORY_COLORS = ["#2563eb", "#0e7490", "#15803d", "#a16207", "#b42318", "#7e22ce", "#475467"] as const;

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "item";
}
