/**
 * A small RFC 5322 / MIME reader for competitor emails: .eml files, .mbox exports
 * and Gmail "raw" messages all come through here. Pure: no I/O, no network.
 *
 * It keeps what Intel needs (headers, the HTML and text bodies, inline images,
 * attachment names) and ignores the rest. Bodies are decoded from base64 or
 * quoted-printable and from their declared charset.
 */

export type EmailAddress = { name: string | null; address: string };

export type ParsedAttachment = { filename: string; contentType: string; size: number; contentId: string | null };

export type ParsedEmail = {
  subject: string;
  from: EmailAddress | null;
  to: string | null;
  date: Date | null;
  messageId: string | null;
  /** Lower-cased header name → first value (decoded). */
  headers: Record<string, string>;
  html: string | null;
  text: string;
  attachments: ParsedAttachment[];
};

type RawPart = { headers: [string, string][]; body: string };

const MAX_DEPTH = 12;
/** Inline images bigger than this stay out of the stored HTML. */
const MAX_INLINE_IMAGE_BYTES = 400 * 1024;

/** Bytes (or an already-decoded string) → a "binary string": one char per byte. */
function toBinary(raw: Uint8Array | string): string {
  if (typeof raw === "string") return Buffer.from(raw, "utf8").toString("latin1");
  return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString("latin1");
}

function binaryBytes(binary: string): Buffer {
  return Buffer.from(binary, "latin1");
}

function normalizeCharset(charset: string | null | undefined): string {
  const value = (charset ?? "").trim().toLowerCase().replace(/^"|"$/g, "");
  if (!value || value === "us-ascii" || value === "ascii" || value === "utf8" || value === "unicode-1-1-utf-8") return "utf-8";
  if (value === "latin1" || value === "latin-1") return "iso-8859-1";
  return value;
}

/** Decode bytes in a declared charset; unknown charsets fall back to UTF-8, then Latin-1. */
export function decodeCharset(bytes: Uint8Array, charset?: string | null): string {
  const label = normalizeCharset(charset);
  try {
    return new TextDecoder(label, { fatal: label === "utf-8" }).decode(bytes);
  } catch {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return new TextDecoder("windows-1252").decode(bytes);
    }
  }
}

export function decodeQuotedPrintable(binary: string): string {
  return binary
    .replace(/[ \t]+(?=\r?\n)/g, "")
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** RFC 2047 encoded words (=?utf-8?B?...?= / =?iso-8859-1?Q?...?=) in a header value. */
export function decodeEncodedWords(value: string): string {
  const pattern = /=\?([^?\s]+)\?([BbQq])\?([^?]*)\?=/g;
  // Whitespace between two adjacent encoded words is dropped (RFC 2047 §6.2).
  const joined = value.replace(/(=\?[^?\s]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, "$1");
  return joined.replace(pattern, (_match, charset: string, encoding: string, text: string) => {
    const binary =
      encoding.toUpperCase() === "B"
        ? Buffer.from(text, "base64").toString("latin1")
        : decodeQuotedPrintable(text.replace(/_/g, " "));
    return decodeCharset(binaryBytes(binary), charset.split("*")[0]);
  });
}

/** A raw header value (bytes as a binary string) → text. Unencoded 8-bit headers are usually UTF-8. */
function decodeHeader(binary: string): string {
  const text = /[\x80-\xff]/.test(binary) ? decodeCharset(binaryBytes(binary), "utf-8") : binary;
  return decodeEncodedWords(text).replace(/\s+/g, " ").trim();
}

function splitHead(binary: string): RawPart {
  const text = binary.replace(/\r\n/g, "\n");
  const index = text.search(/\n\n/);
  const head = index === -1 ? text : text.slice(0, index);
  const body = index === -1 ? "" : text.slice(index + 2);
  const headers: [string, string][] = [];
  for (const line of head.split("\n")) {
    if (/^[ \t]/.test(line) && headers.length > 0) {
      const last = headers[headers.length - 1]!;
      last[1] += ` ${line.trim()}`;
      continue;
    }
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    headers.push([line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()]);
  }
  return { headers, body };
}

function header(part: RawPart, name: string): string | null {
  return part.headers.find(([key]) => key === name)?.[1] ?? null;
}

/** "text/html; charset=utf-8; name*=UTF-8''a%20b.pdf" → { value, params }. */
export function parseHeaderParams(value: string): { value: string; params: Record<string, string> } {
  const segments: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of value) {
    if (char === '"') quoted = !quoted;
    if (char === ";" && !quoted) {
      segments.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  segments.push(current);
  const params: Record<string, string> = {};
  const continued: Record<string, string[]> = {};
  for (const segment of segments.slice(1)) {
    const eq = segment.indexOf("=");
    if (eq === -1) continue;
    const rawKey = segment.slice(0, eq).trim().toLowerCase();
    let val = segment.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1).replace(/\\(.)/g, "$1");
    // RFC 2231: name*=charset'lang'percent-encoded, name*0*=..., name*1*=...
    const match = /^([^*]+)\*(?:(\d+)\*?)?$/.exec(rawKey);
    if (match) {
      const key = match[1]!;
      (continued[key] ??= [])[Number(match[2] ?? 0)] = val;
      continue;
    }
    params[rawKey] = val;
  }
  for (const [key, pieces] of Object.entries(continued)) {
    const joined = pieces.join("");
    const ext = /^([^']*)'[^']*'(.*)$/.exec(joined);
    if (ext) {
      const bytes = Buffer.from(ext[2]!.replace(/%([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16))), "latin1");
      params[key] = decodeCharset(bytes, ext[1] || "utf-8");
    } else {
      params[key] = joined;
    }
  }
  return { value: segments[0]!.trim().toLowerCase(), params };
}

function decodeBody(part: RawPart): Buffer {
  const encoding = (header(part, "content-transfer-encoding") ?? "7bit").trim().toLowerCase();
  if (encoding === "base64") return Buffer.from(part.body.replace(/[^A-Za-z0-9+/=]/g, ""), "base64");
  if (encoding === "quoted-printable") return binaryBytes(decodeQuotedPrintable(part.body));
  return binaryBytes(part.body);
}

function splitMultipart(body: string, boundary: string): string[] {
  const delimiter = `--${boundary}`;
  const lines = body.split("\n");
  const parts: string[] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (trimmed === `${delimiter}--`) {
      if (current) parts.push(current.join("\n"));
      current = null;
      break;
    }
    if (trimmed === delimiter) {
      if (current) parts.push(current.join("\n"));
      current = [];
      continue;
    }
    current?.push(line);
  }
  if (current && current.length) parts.push(current.join("\n"));
  return parts;
}

type Collected = {
  html: string[];
  text: string[];
  attachments: ParsedAttachment[];
  inline: Map<string, string>;
};

function walk(part: RawPart, collected: Collected, depth: number): void {
  const type = parseHeaderParams(header(part, "content-type") ?? "text/plain");
  const disposition = parseHeaderParams(header(part, "content-disposition") ?? "");
  const filename = disposition.params.filename ?? type.params.name ?? null;
  if (type.value.startsWith("multipart/") && type.params.boundary && depth < MAX_DEPTH) {
    for (const child of splitMultipart(part.body, type.params.boundary)) walk(splitHead(child), collected, depth + 1);
    return;
  }
  const isAttachment = disposition.value === "attachment" || (Boolean(filename) && !type.value.startsWith("text/"));
  if (!isAttachment && (type.value === "text/html" || type.value === "text/plain")) {
    const text = decodeCharset(decodeBody(part), type.params.charset);
    (type.value === "text/html" ? collected.html : collected.text).push(text);
    return;
  }
  const data = decodeBody(part);
  const contentId = (header(part, "content-id") ?? "").replace(/^<|>$/g, "").trim() || null;
  if (contentId && type.value.startsWith("image/") && data.length <= MAX_INLINE_IMAGE_BYTES) {
    collected.inline.set(contentId.toLowerCase(), `data:${type.value};base64,${data.toString("base64")}`);
  }
  collected.attachments.push({
    filename: decodeHeader(filename ?? (contentId ? `inline-${contentId}` : "attachment")),
    contentType: type.value || "application/octet-stream",
    size: data.length,
    contentId,
  });
}

export function parseAddressList(value: string): EmailAddress[] {
  const out: EmailAddress[] = [];
  let current = "";
  let quoted = false;
  let angle = false;
  for (const char of value) {
    if (char === '"') quoted = !quoted;
    if (!quoted && char === "<") angle = true;
    if (!quoted && char === ">") angle = false;
    if (char === "," && !quoted && !angle) {
      const parsed = parseAddress(current);
      if (parsed) out.push(parsed);
      current = "";
      continue;
    }
    current += char;
  }
  const parsed = parseAddress(current);
  if (parsed) out.push(parsed);
  return out;
}

/** `"Jane Doe" <jane@x.com>`, `Jane <jane@x.com>`, `jane@x.com (Jane)`, `jane@x.com`. */
export function parseAddress(value: string): EmailAddress | null {
  const text = value.trim();
  if (!text) return null;
  const angle = /^(.*?)<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/.exec(text);
  if (angle) {
    const name = angle[1]!.trim().replace(/^"|"$/g, "").replace(/\\(.)/g, "$1").trim();
    return { name: name || null, address: angle[2]!.toLowerCase() };
  }
  const comment = /^([^\s()]+@[^\s()]+)\s*\((.*)\)\s*$/.exec(text);
  if (comment) return { name: comment[2]!.trim() || null, address: comment[1]!.toLowerCase() };
  const bare = /([^\s<>"]+@[^\s<>"]+)/.exec(text);
  return bare ? { name: null, address: bare[1]!.replace(/[;,]$/, "").toLowerCase() } : null;
}

export function parseEmailDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const cleaned = value.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  const date = new Date(cleaned);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Parse one RFC 5322 message. Never throws; a message with no headers still yields its text. */
export function parseEml(raw: Uint8Array | string): ParsedEmail {
  const root = splitHead(toBinary(raw));
  const collected: Collected = { html: [], text: [], attachments: [], inline: new Map() };
  walk(root, collected, 0);

  const headers: Record<string, string> = {};
  for (const [key, value] of root.headers) if (!(key in headers)) headers[key] = decodeHeader(value);

  let html = collected.html.length ? collected.html.join("\n<hr>\n") : null;
  if (html && collected.inline.size) {
    html = html.replace(/(["'(])cid:([^"')\s]+)/gi, (match, lead: string, id: string) => {
      const data = collected.inline.get(decodeURIComponent(id).toLowerCase());
      return data ? `${lead}${data}` : match;
    });
  }
  const plain = collected.text.join("\n\n").trim();
  return {
    subject: headers.subject || "(no subject)",
    from: parseAddress(headers.from ?? headers.sender ?? "") ?? null,
    to: headers.to ?? null,
    date: parseEmailDate(headers.date),
    messageId: (headers["message-id"] ?? "").replace(/^<|>$/g, "").trim() || null,
    headers,
    html,
    text: plain || (html ? htmlToText(html) : ""),
    attachments: collected.attachments,
  };
}

/**
 * Split an mbox export (Gmail Takeout, Thunderbird, Apple Mail) into messages.
 * Messages start at a "From " line that opens the file or follows a blank line;
 * mboxrd-escaped body lines (">From ") are un-escaped.
 */
export function splitMbox(raw: Uint8Array | string): string[] {
  const text = toBinary(raw).replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const messages: string[] = [];
  let current: string[] | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (/^From \S/.test(line) && (index === 0 || lines[index - 1] === "")) {
      if (current) messages.push(finishMboxMessage(current));
      current = [];
      continue;
    }
    if (current) current.push(/^>+From /.test(line) ? line.slice(1) : line);
  }
  if (current) messages.push(finishMboxMessage(current));
  return messages.filter((message) => message.trim().length > 0);
}

function finishMboxMessage(lines: string[]): string {
  // The blank line before the next "From " belongs to the separator.
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

/** True when the bytes look like an mbox export rather than a single message. */
export function looksLikeMbox(raw: Uint8Array | string): boolean {
  const head = toBinary(typeof raw === "string" ? raw.slice(0, 200) : raw.subarray(0, 200));
  return /^From \S/.test(head);
}

/** Message as a "binary string" (from splitMbox) → bytes, for storage. */
export function binaryToBytes(binary: string): Uint8Array {
  return new Uint8Array(binaryBytes(binary));
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", hellip: "…", copy: "©", reg: "®", trade: "™", zwnj: "", zwj: "", raquo: "»", laquo: "«", rsaquo: "›", lsaquo: "‹", middot: "·", bull: "•", euro: "€", pound: "£", cent: "¢", yen: "¥", deg: "°", times: "×", divide: "÷", frac12: "½", frac14: "¼", eacute: "é", egrave: "è", agrave: "à", aacute: "á", ccedil: "ç", ntilde: "ñ", oacute: "ó", uacute: "ú", iacute: "í", uuml: "ü", ouml: "ö", auml: "ä", szlig: "ß", shy: "" };

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1]?.toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Readable text from email HTML: blocks become lines, tags and hidden preheaders go. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(script|style|head|title)[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote|section|article)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ ​‌‍͏﻿]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A short one-line preview of the body. */
export function snippetOf(text: string, limit = 220): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}
