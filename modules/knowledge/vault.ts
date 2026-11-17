/**
 * Markdown vault rules, shared by the in-app importer and the export script.
 * Pure: takes paths and text, returns decisions and a plan. No DB, no zip.
 */
import { normalizeFolder } from "./folders";
import { describeSecrets, findSecrets } from "./secrets";

/** A note bigger than this is skipped (the Brain is for notes, not data dumps). */
export const MAX_NOTE_CHARS = 1_000_000;

export type SkipReason =
  | "hidden"
  | "not-markdown"
  | "not-text"
  | "empty"
  | "too-large"
  | "secret"
  | "excluded-folder"
  | "personal"
  | "agent-instructions";

export const SKIP_LABELS: Record<SkipReason, string> = {
  hidden: "Hidden or system file",
  "not-markdown": "Not a Markdown file",
  "not-text": "Not readable text",
  empty: "Empty note",
  "too-large": "Too large",
  secret: "Looks like it contains a secret",
  "excluded-folder": "Excluded folder",
  personal: "Tagged personal or private",
  "agent-instructions": "AI agent instructions",
};

export type VaultNote = {
  path: string;
  sourceRef: string;
  title: string;
  folder: string | null;
  body: string;
};

export type VaultDecision =
  | { ok: true; note: VaultNote }
  | { ok: false; path: string; reason: SkipReason; detail?: string };

/** Clean a zip entry path; null for directories and paths that try to escape. */
export function normalizeVaultPath(path: string): string | null {
  const parts = path.replace(/\\/g, "/").split("/").filter((part) => part && part !== ".");
  if (parts.length === 0 || parts.some((part) => part === "..")) return null;
  if (path.endsWith("/")) return null;
  return parts.join("/");
}

/**
 * A zip made from the vault folder itself ("brain/Resources/...") has one top
 * folder holding `.obsidian/`. Return that prefix so paths start at the vault root.
 */
export function vaultRootPrefix(paths: readonly string[]): string {
  const firsts = new Set(paths.map((path) => path.split("/")[0] ?? ""));
  firsts.delete("__MACOSX");
  if (firsts.size !== 1) return "";
  const [root] = [...firsts];
  if (!root || root.startsWith(".")) return "";
  const prefix = `${root}/`;
  if (!paths.some((path) => path.startsWith(`${prefix}.obsidian/`))) return "";
  return paths.every((path) => path.startsWith(prefix) || path.startsWith("__MACOSX/")) ? prefix : "";
}

export function sourceRefForPath(path: string): string {
  return `vault:${path}`;
}

export function titleFromPath(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.md$/i, "").trim().slice(0, 200) || "Untitled";
}

export function folderFromPath(path: string): string | null {
  const parts = path.split("/");
  parts.pop();
  return normalizeFolder(parts.join("/"));
}

/** Minimal YAML front matter: `key: value`, `key: [a, b]` and `key:\n  - a`. */
export function parseFrontmatter(text: string): { data: Record<string, string | string[]>; body: string; raw: string | null } {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return { data: {}, body: text, raw: null };
  const data: Record<string, string | string[]> = {};
  let listKey: string | null = null;
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const item = /^\s+-\s*(.*)$/.exec(line);
    if (item && listKey) {
      const current = data[listKey];
      const list = Array.isArray(current) ? current : [];
      list.push(unquote(item[1] ?? ""));
      data[listKey] = list;
      continue;
    }
    const pair = /^([A-Za-z0-9_][\w -]*):\s*(.*)$/.exec(line);
    if (!pair) continue;
    const key = (pair[1] ?? "").trim();
    const value = (pair[2] ?? "").trim();
    listKey = null;
    if (!value) {
      data[key] = [];
      listKey = key;
    } else if (value.startsWith("[") && value.endsWith("]")) {
      data[key] = value
        .slice(1, -1)
        .split(",")
        .map((part) => unquote(part))
        .filter(Boolean);
    } else {
      data[key] = unquote(value);
    }
  }
  return { data, body: text.slice(match[0].length), raw: match[1] ?? "" };
}

function unquote(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "").trim();
}

/** Tags from front matter (`tags`, `tag`) plus inline #tags outside code. */
export function noteTags(text: string): string[] {
  const { data, body } = parseFrontmatter(text);
  const tags = new Set<string>();
  for (const key of ["tags", "tag"]) {
    const value = data[key];
    const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,\s]+/) : [];
    list.forEach((tag) => tag && tags.add(tag.replace(/^#/, "").toLowerCase()));
  }
  const withoutCode = body.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");
  for (const match of withoutCode.matchAll(/(?:^|[\s(])#([A-Za-z][\w/-]*)/g)) {
    tags.add((match[1] ?? "").toLowerCase());
  }
  return [...tags];
}

const PRIVATE_TAGS = new Set(["personal", "private"]);

export function isPersonalNote(text: string): boolean {
  return noteTags(text).some((tag) => PRIVATE_TAGS.has(tag) || PRIVATE_TAGS.has(tag.split("/")[0] ?? ""));
}

function isHiddenPath(path: string): boolean {
  return path.startsWith("__MACOSX/") || path.split("/").some((part) => part.startsWith(".") || part === "Thumbs.db");
}

/** Decide one file for the in-app importer. `text` is null when the bytes are not UTF-8. */
export function importDecision(path: string, text: string | null): VaultDecision {
  if (isHiddenPath(path)) return { ok: false, path, reason: "hidden" };
  if (!/\.md$/i.test(path)) return { ok: false, path, reason: "not-markdown" };
  if (text == null) return { ok: false, path, reason: "not-text" };
  if (!text.trim()) return { ok: false, path, reason: "empty" };
  if (text.length > MAX_NOTE_CHARS) return { ok: false, path, reason: "too-large", detail: `${Math.round(text.length / 1000)}k characters` };
  const secrets = findSecrets(text);
  if (secrets.length > 0) return { ok: false, path, reason: "secret", detail: describeSecrets(secrets) };
  return {
    ok: true,
    note: {
      path,
      sourceRef: sourceRefForPath(path),
      title: titleFromPath(path),
      folder: folderFromPath(path),
      body: text.replace(/\r\n/g, "\n"),
    },
  };
}

export type ExportRules = {
  /** Folder prefixes left out entirely, e.g. "Inbox", "AI/sessions". Case-insensitive. */
  excludeFolders: readonly string[];
  /** Any path segment with one of these names is left out, e.g. "personal". Case-insensitive. */
  excludeSegments: readonly string[];
  /** File names left out wherever they are, e.g. "CLAUDE.md". */
  excludeFiles: readonly string[];
};

/** What leaves the old MTA vault (approved by Stephen). */
export const MTA_EXPORT_RULES: ExportRules = {
  excludeFolders: ["Inbox", "AI/sessions", "Meetings", "Templates", "Archive", "attachments", "Projects/brain-map"],
  excludeSegments: ["personal", "work"],
  excludeFiles: ["CLAUDE.md", "AGENTS.md"],
};

/** Decide one file for an export zip: the importer's rules plus the folder and privacy rules. */
export function exportDecision(path: string, text: string | null, rules: ExportRules = MTA_EXPORT_RULES): VaultDecision {
  const lower = path.toLowerCase();
  const segments = lower.split("/");
  if (isHiddenPath(path)) return { ok: false, path, reason: "hidden" };
  const folder = rules.excludeFolders.find((prefix) => lower === prefix.toLowerCase() || lower.startsWith(`${prefix.toLowerCase()}/`));
  if (folder) return { ok: false, path, reason: "excluded-folder", detail: folder };
  const segment = segments.slice(0, -1).find((part) => rules.excludeSegments.some((name) => name.toLowerCase() === part));
  if (segment) return { ok: false, path, reason: "excluded-folder", detail: segment };
  const file = segments[segments.length - 1] ?? "";
  if (rules.excludeFiles.some((name) => name.toLowerCase() === file)) return { ok: false, path, reason: "agent-instructions" };
  const decision = importDecision(path, text);
  if (!decision.ok) return decision;
  if (isPersonalNote(decision.note.body)) return { ok: false, path, reason: "personal" };
  return decision;
}

export type ExistingNote = {
  id: string;
  brandId: string | null;
  title: string;
  body: string;
  folder: string | null;
  deletedAt: Date | string | null;
};

export type PlannedAction = "create" | "update" | "unchanged" | "conflict" | "deleted";

export type ImportPlanRow = { note: VaultNote; action: PlannedAction; existingId: string | null };

export type ImportReport = {
  files: number;
  notes: number;
  create: number;
  update: number;
  unchanged: number;
  /** Already imported into a different Brain. Never moved; skipped. */
  conflict: number;
  /** Deleted in the Brain since the last import. Left deleted. */
  deleted: number;
  skipped: Partial<Record<SkipReason, number>>;
  skippedFiles: { path: string; reason: SkipReason; detail?: string }[];
  conflictFiles: string[];
  folders: { folder: string; notes: number }[];
  truncated: boolean;
};

export const REPORT_FILE_LIMIT = 400;

/** Top-level folder ("Resources") or "(top level)" for the report. */
export function reportFolder(path: string, depth = 1): string {
  const parts = path.split("/");
  parts.pop();
  return parts.slice(0, depth).join("/") || "(top level)";
}

/**
 * Compare vault decisions with what is already in the organization. `existing`
 * is keyed by sourceRef. Re-importing the same vault into the same Brain
 * updates notes in place; a note already imported into another Brain is left alone.
 */
export function planVaultImport(
  decisions: readonly VaultDecision[],
  existing: ReadonlyMap<string, ExistingNote>,
  targetBrandId: string | null,
): { rows: ImportPlanRow[]; report: ImportReport } {
  const rows: ImportPlanRow[] = [];
  const report: ImportReport = {
    files: decisions.length,
    notes: 0,
    create: 0,
    update: 0,
    unchanged: 0,
    conflict: 0,
    deleted: 0,
    skipped: {},
    skippedFiles: [],
    conflictFiles: [],
    folders: [],
    truncated: false,
  };
  const folders = new Map<string, number>();
  const seen = new Set<string>();
  for (const decision of decisions) {
    if (!decision.ok) {
      report.skipped[decision.reason] = (report.skipped[decision.reason] ?? 0) + 1;
      if (decision.reason !== "hidden") {
        if (report.skippedFiles.length < REPORT_FILE_LIMIT) {
          report.skippedFiles.push({ path: decision.path, reason: decision.reason, ...(decision.detail ? { detail: decision.detail } : {}) });
        } else report.truncated = true;
      }
      continue;
    }
    const { note } = decision;
    if (seen.has(note.sourceRef)) continue;
    seen.add(note.sourceRef);
    const current = existing.get(note.sourceRef);
    let action: PlannedAction = "create";
    if (current) {
      if (current.brandId !== targetBrandId) action = "conflict";
      else if (current.deletedAt) action = "deleted";
      else if (current.title === note.title && current.body === note.body && (current.folder ?? null) === note.folder) action = "unchanged";
      else action = "update";
    }
    report[action] += 1;
    if (action === "conflict" && report.conflictFiles.length < REPORT_FILE_LIMIT) report.conflictFiles.push(note.path);
    if (action !== "conflict") {
      report.notes += 1;
      const key = reportFolder(note.path);
      folders.set(key, (folders.get(key) ?? 0) + 1);
    }
    rows.push({ note, action, existingId: current?.id ?? null });
  }
  report.folders = [...folders.entries()].map(([folder, notes]) => ({ folder, notes })).sort((a, b) => b.notes - a.notes || a.folder.localeCompare(b.folder));
  return { rows, report };
}

/** Decode bytes as UTF-8, or null when they are not valid text. */
export function decodeText(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text.includes("\u0000") ? null : text.replace(/^﻿/, "");
  } catch {
    return null;
  }
}
