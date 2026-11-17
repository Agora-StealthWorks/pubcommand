/**
 * Website directory: one record per post, article or report on the brand's website.
 * Rows arrive from a sheet/CSV import, from a WordPress-style ingest endpoint (with a key)
 * or by hand. Rows are matched by normalized URL. A page edited here is locked: imports
 * report it as skipped and never overwrite the edit.
 *
 * Classification fails safe: only an access level that clearly says the page is free is
 * public. Blank, unknown and mixed values are members only.
 */
import { checkContent } from "./gate";

export type SitePageInput = Record<string, unknown>;

export type PreparedPage = {
  url: string;
  title: string;
  summary: string;
  publishedAt: string | null;
  author: string;
  product: string;
  publicationCodes: string[];
  accessLevel: string;
  topics: string[];
  siteStatus: string;
  audience: "public" | "member";
  status: "published" | "draft" | "archived";
  notes: string[];
};

const s = (value: unknown, max = 2000): string => (typeof value === "string" ? value.trim().slice(0, max) : typeof value === "number" ? String(value) : "");

const PLACEHOLDER = /^(not found|none|n\/a|null|-|uncategori[sz]ed)$/i;
function list(value: unknown): string[] {
  const parts = Array.isArray(value) ? value.map((v) => s(v, 200)) : s(value, 4000).split(/[,;|\n]/);
  return [...new Set(parts.map((p) => p.trim()).filter((p) => p && !PLACEHOLDER.test(p)))].slice(0, 40);
}

/** Canonical URL used as the key: lowercase host, no fragment, no tracking params, no trailing slash. */
export function normalizeUrl(raw: unknown): string | null {
  const value = s(raw, 2000);
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || !url.hostname.includes(".")) return null;
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|mc_|_hs|ref$)/i.test(key)) url.searchParams.delete(key);
  let out = url.toString();
  if (url.pathname !== "/" && out.endsWith("/") && !url.search) out = out.slice(0, -1);
  return out;
}

const PUBLIC_LEVEL = /^(free|public|open|everyone|anyone|guest|no login|free to read)$/i;

/** Public or members only, from the website's access level. Anything unclear is members only. */
export function classifyAccess(level: string): { audience: "public" | "member"; note?: string } {
  const value = level.trim();
  if (!value) return { audience: "member", note: "No access level: treated as members only." };
  const parts = value.split(/[,;|/]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 0 && parts.every((p) => PUBLIC_LEVEL.test(p))) return { audience: "public" };
  if (parts.some((p) => PUBLIC_LEVEL.test(p))) return { audience: "member", note: `Mixed access level "${value}": treated as members only.` };
  return { audience: "member" };
}

/** The website's post status → whether agents may use the page. Unknown values stay hidden. */
export function mapSiteStatus(raw: string): { status: PreparedPage["status"]; note?: string } {
  const value = raw.trim().toLowerCase();
  if (!value || /^(publish(ed)?|live|active|public)$/.test(value)) return { status: "published" };
  if (/^(draft|pending|future|scheduled|auto-draft|private|review)$/.test(value)) return { status: "draft" };
  if (/^(trash(ed)?|deleted|archived?|unpublished|removed|inherit)$/.test(value)) return { status: "archived" };
  return { status: "draft", note: `Unknown status "${raw.trim()}": kept hidden from agents.` };
}

const bare = (value: string) =>
  value
    .toLowerCase()
    .replace(/[®™]/g, "")
    .replace(/\bw\//g, "with ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the\s+/, "");

/** Match free-text product names ("Daily Edge, Weekly Brief") to publication codes. */
export function matchProducts(raw: string, publications: readonly { code: string; name: string }[]): { codes: string[]; unmatched: string[] } {
  const codes = new Set<string>();
  const unmatched: string[] = [];
  for (const part of raw.split(/[,;|\n]/).map((p) => p.trim()).filter(Boolean)) {
    const b = bare(part);
    const exact = publications.find((p) => p.code.toUpperCase() === part.toUpperCase() || bare(p.name) === b);
    const inside = publications.filter((p) => bare(p.name) && b.includes(bare(p.name))).sort((x, y) => y.name.length - x.name.length)[0];
    const hit = exact ?? inside;
    if (hit) codes.add(hit.code.toUpperCase());
    else unmatched.push(part);
  }
  return { codes: [...codes], unmatched };
}

/** A date from ISO text, a US date or a spreadsheet serial number. */
export function parsePageDate(value: unknown): string | null {
  const t = s(value, 100);
  if (!t) return null;
  const d = /^\d{5}(\.\d+)?$/.test(t) ? new Date(Math.round((Number(t) - 25569) * 864e5)) : new Date(t);
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1990 || d.getUTCFullYear() > 2100) return null;
  return d.toISOString().slice(0, 10);
}

/** Header aliases a sheet or a WordPress plugin may send. */
const FIELD_ALIASES: Record<string, string[]> = {
  title: ["title", "post title", "name", "headline"],
  url: ["url", "link", "permalink", "page url"],
  date: ["date", "published", "publish date", "published at", "post date"],
  author: ["author", "by", "writer"],
  product: ["product", "publication", "products", "service"],
  accessLevel: ["access level", "access", "membership level", "level", "access_level"],
  categories: ["categories", "category"],
  tags: ["tags", "tag", "topics"],
  status: ["status", "post status", "wp status"],
  summary: ["summary", "excerpt", "description"],
};

export function fieldFor(header: string): string | null {
  const h = header.trim().toLowerCase().replace(/[_-]+/g, " ");
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) if (aliases.includes(h) || field.toLowerCase() === h.replace(/ /g, "")) return field;
  return null;
}

/** Validate and classify one incoming row. */
export function preparePage(row: SitePageInput, publications: readonly { code: string; name: string }[]): PreparedPage | { error: string } {
  const url = normalizeUrl(row.url);
  const title = s(row.title, 300);
  if (!url) return { error: "missing or invalid URL" };
  if (!title) return { error: "missing title" };
  const product = s(row.product, 300);
  const accessLevel = s(row.accessLevel ?? row.access_level, 200);
  const siteStatus = s(row.status, 40);
  const summary = s(row.summary, 2000);
  const { codes, unmatched } = matchProducts(product, publications);
  const access = classifyAccess(accessLevel);
  const mapped = mapSiteStatus(siteStatus);
  const notes = [access.note, mapped.note].filter((n): n is string => Boolean(n));
  let status = mapped.status;
  const gate = checkContent(`${title}\n${summary}`, ["competitor"]);
  if (!gate.ok && status === "published") {
    status = "draft";
    notes.push(`Contains internal content (${gate.blocking.map((h) => h.label).join(", ")}): kept hidden from agents.`);
  }
  if (product && unmatched.length) notes.push(`Product "${unmatched.join(", ")}" does not match a publication.`);
  const publishedAt = parsePageDate(row.date ?? row.publishedAt);
  if (!publishedAt) notes.push("No date.");
  const author = s(row.author, 200);
  return {
    url,
    title,
    summary,
    publishedAt,
    author: /^(admin|administrator|editor)$/i.test(author) ? "" : author,
    product,
    publicationCodes: codes,
    accessLevel,
    topics: [...new Set([...list(row.categories), ...list(row.tags)])].slice(0, 40),
    siteStatus,
    audience: access.audience,
    status,
    notes,
  };
}

/** The record body an agent reads for one page: what it is, when, for whom, and its link. */
export function pageBody(page: Pick<PreparedPage, "title" | "summary" | "publishedAt" | "author" | "product" | "publicationCodes" | "topics" | "url" | "audience">): string {
  const meta = [page.publishedAt && `Published ${page.publishedAt}`, page.author && `by ${page.author}`, (page.product || page.publicationCodes.length) && `for ${page.product || page.publicationCodes.join(", ")}`]
    .filter(Boolean)
    .join(" ");
  return [
    `${page.title}${meta ? `: ${meta}.` : ""}`,
    page.audience === "member" ? "Members-only page." : "",
    page.topics.length ? `Topics: ${page.topics.join(", ")}` : "",
    page.summary,
    `Link: ${page.url}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** RFC 4180-ish CSV: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** CSV text → row objects keyed by field name (unknown columns dropped). */
export function csvToPages(text: string): { rows: SitePageInput[]; unknownColumns: string[] } {
  const [header, ...body] = parseCsv(text);
  if (!header) return { rows: [], unknownColumns: [] };
  const fields = header.map(fieldFor);
  const unknownColumns = header.filter((_, i) => !fields[i]).map((h) => h.trim()).filter(Boolean);
  const rows = body.map((cells) => {
    const out: SitePageInput = {};
    fields.forEach((field, i) => {
      if (field && cells[i] !== undefined) out[field] = cells[i];
    });
    return out;
  });
  return { rows, unknownColumns };
}

/** A Google Sheets link → its CSV export URL (the sheet must be link-viewable). Only Google Sheets is fetched. */
export function sheetCsvUrl(raw: string): string | null {
  const value = raw.trim();
  const match = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(value);
  if (!match) return null;
  const gid = /[#&?]gid=(\d+)/.exec(value)?.[1];
  return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv${gid ? `&gid=${gid}` : ""}`;
}
