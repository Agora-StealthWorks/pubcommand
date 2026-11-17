/** Turn uploads, pastes and Gmail messages into inbox rows. Pure. */
import { createHash } from "node:crypto";
import { extractLinks, guessLandingUrl, type EmailLink } from "./links";
import { binaryToBytes, htmlToText, looksLikeMbox, parseAddress, parseEml, parseEmailDate, snippetOf, splitMbox, type ParsedEmail } from "./mime";

/** One message bigger than this is skipped (its raw copy would bloat the database). */
export const MAX_MESSAGE_BYTES = 15 * 1024 * 1024;
/** At most this many messages from one upload. */
export const MAX_MESSAGES_PER_UPLOAD = 2000;

export type PreparedEmail = {
  dedupeKey: string;
  messageId: string | null;
  subject: string;
  fromName: string | null;
  fromAddress: string;
  toAddress: string | null;
  receivedAt: Date;
  htmlBody: string | null;
  textBody: string;
  snippet: string;
  links: EmailLink[];
  landingUrl: string | null;
  raw: Uint8Array;
  headers: Record<string, string>;
};

export function dedupeKeyFor(messageId: string | null, raw: Uint8Array): string {
  if (messageId) return `mid:${messageId.toLowerCase().slice(0, 400)}`;
  return `sha:${createHash("sha256").update(raw).digest("hex")}`;
}

export function prepareParsed(parsed: ParsedEmail, raw: Uint8Array, fallbackDate: Date): PreparedEmail {
  const links = extractLinks(parsed.html, parsed.text);
  return {
    dedupeKey: dedupeKeyFor(parsed.messageId, raw),
    messageId: parsed.messageId,
    subject: parsed.subject.slice(0, 500),
    fromName: parsed.from?.name?.slice(0, 200) ?? null,
    fromAddress: parsed.from?.address.slice(0, 320) ?? "unknown@unknown",
    toAddress: parsed.to?.slice(0, 500) ?? null,
    receivedAt: parsed.date ?? fallbackDate,
    htmlBody: parsed.html,
    textBody: parsed.text,
    snippet: snippetOf(parsed.text),
    links,
    landingUrl: guessLandingUrl(links),
    raw,
    headers: parsed.headers,
  };
}

export function prepareRaw(raw: Uint8Array, fallbackDate = new Date()): PreparedEmail {
  return prepareParsed(parseEml(raw), raw, fallbackDate);
}

export type UploadResult = { emails: PreparedEmail[]; skipped: { reason: string; count: number }[] };

/** An uploaded file: one .eml message, or an .mbox export of many. */
export function prepareUpload(bytes: Uint8Array, filename: string, now = new Date()): UploadResult {
  const skipped = new Map<string, number>();
  const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
  const emails: PreparedEmail[] = [];
  const mbox = /\.mbox$/i.test(filename) || looksLikeMbox(bytes);
  const messages = mbox ? splitMbox(bytes).map(binaryToBytes) : [bytes];
  for (const message of messages) {
    if (emails.length >= MAX_MESSAGES_PER_UPLOAD) {
      skip(`over the ${MAX_MESSAGES_PER_UPLOAD}-message limit per upload`);
      continue;
    }
    if (message.byteLength > MAX_MESSAGE_BYTES) {
      skip("over 15 MB");
      continue;
    }
    const prepared = prepareRaw(message, now);
    if (!prepared.textBody.trim() && !prepared.htmlBody) {
      skip("no body");
      continue;
    }
    emails.push(prepared);
  }
  return { emails, skipped: [...skipped.entries()].map(([reason, count]) => ({ reason, count })) };
}

/** True when pasted text is a full message source (headers, a blank line, then the body). */
export function looksLikeRawSource(text: string): boolean {
  const head = text.replace(/\r\n/g, "\n").split("\n\n")[0] ?? "";
  const lines = head.split("\n").filter((line) => /^[A-Za-z][A-Za-z0-9-]*:\s/.test(line));
  return lines.length >= 2 && /^(from|subject|date|received|return-path|delivered-to|mime-version|message-id):/im.test(head);
}

const HTML_HINT = /<(html|body|table|div|p|a|br|span|td|img)\b/i;

/**
 * A pasted email: either the full source ("Show original" in Gmail), or a body
 * plus the fields typed into the form. HTML bodies are kept as HTML.
 */
export function preparePaste(input: { source: string; subject: string; from: string; date: string }, now = new Date()): PreparedEmail | { error: string } {
  const source = input.source.trim();
  if (!source) return { error: "Paste the email." };
  if (looksLikeRawSource(source)) {
    const raw = new Uint8Array(Buffer.from(source, "utf8"));
    return prepareRaw(raw, now);
  }
  const from = parseAddress(input.from);
  if (!from) return { error: "Add the sender's email address, e.g. Jane Smith <jane@publisher.com>." };
  const html = HTML_HINT.test(source) ? source : null;
  const text = html ? htmlToText(html) : source;
  const subject = input.subject.trim().slice(0, 500) || "(no subject)";
  const date = parseEmailDate(input.date) ?? now;
  const raw = new Uint8Array(
    Buffer.from(
      [
        `From: ${from.name ? `"${from.name.replace(/"/g, "'")}" ` : ""}<${from.address}>`,
        `Subject: ${subject.replace(/[\r\n]+/g, " ")}`,
        `Date: ${date.toUTCString()}`,
        "MIME-Version: 1.0",
        `Content-Type: ${html ? "text/html" : "text/plain"}; charset=utf-8`,
        "Content-Transfer-Encoding: 8bit",
        "X-PubCommand-Intel: pasted",
        "",
        source,
      ].join("\r\n"),
      "utf8",
    ),
  );
  const parsed: ParsedEmail = {
    subject,
    from,
    to: null,
    date,
    messageId: null,
    headers: { from: input.from.trim(), subject, date: date.toUTCString() },
    html,
    text,
    attachments: [],
  };
  return prepareParsed(parsed, raw, now);
}
