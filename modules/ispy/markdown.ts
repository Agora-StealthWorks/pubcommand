/** The Brain note ISpy writes for one copy: email text + takeaways + offer + topics + sends. */
import { offerLine, type CopyExtraction } from "./extraction";
import { EMAIL_TYPE_LABELS, FEED_LABELS, isOneOf, EMAIL_TYPES, FEEDS } from "./types";

export type NoteSend = { date: Date; list: string | null; kind: string; subject: string };

const day = (d: Date) => d.toISOString().slice(0, 10);
const cell = (v: string) => v.replace(/\|/g, "/").replace(/\s+/g, " ").trim();

export function copyNote(input: {
  title: string;
  feed: string;
  emailType: string;
  publisher: string | null;
  advertiser: string | null;
  extraction: CopyExtraction | null;
  sends: readonly NoteSend[];
  text: string;
  maxTextChars?: number;
}): { title: string; body: string } {
  const sends = [...input.sends].sort((a, b) => a.date.getTime() - b.date.getTime());
  const first = sends[0];
  const lists = new Set(sends.map((s) => s.list).filter(Boolean));
  const affiliates = new Set(sends.filter((s) => s.kind === "AFFILIATE").map((s) => s.list).filter(Boolean));
  const feed = isOneOf(FEEDS, input.feed) ? FEED_LABELS[input.feed] : input.feed;
  const type = isOneOf(EMAIL_TYPES, input.emailType) ? EMAIL_TYPE_LABELS[input.emailType] : input.emailType;
  const lines: string[] = [];
  lines.push(`feed: ${feed} · type: ${type}${input.publisher ? ` · publisher: ${input.publisher}` : ""}${input.advertiser && input.advertiser !== input.publisher ? ` → advertiser: ${input.advertiser}` : ""}`);
  if (first) lines.push(`first sent: ${day(first.date)}${first.list ? ` (${first.list}, ${first.kind.toLowerCase()})` : ""} · sends: ${sends.length} · lists: ${lists.size}${affiliates.size ? ` · affiliates: ${[...affiliates].join(", ")}` : ""}`);
  const x = input.extraction;
  if (x?.takeaways.length) lines.push("", "## Key takeaways", ...x.takeaways.map((t) => `- ${t}`));
  const offer = x ? offerLine(x.offer) : null;
  if (offer) lines.push("", "## Offer", offer);
  if (x?.topics.length) lines.push("", "## Topics", x.topics.join(", "));
  if (x?.gurus.length) lines.push("", "## Gurus", x.gurus.join(", "));
  if (sends.length) {
    lines.push("", "## Sends", "| date | list | kind | subject |", "| --- | --- | --- | --- |");
    for (const s of sends.slice(-50)) lines.push(`| ${day(s.date)} | ${cell(s.list ?? "—")} | ${s.kind.toLowerCase()} | ${cell(s.subject)} |`);
  }
  const max = input.maxTextChars ?? 12_000;
  lines.push("", "## Copy", input.text.length > max ? `${input.text.slice(0, max)}\n\n[…cut]` : input.text);
  return { title: input.title.slice(0, 200), body: lines.join("\n") };
}
