/**
 * Copy fingerprints: the same email body is the same "copy" whatever its subject,
 * greeting, tracking links or footer. Exact match by hash, near match by a 64-bit
 * SimHash over word shingles, confirmed with a shingle Jaccard score. Pure, no AI.
 */
import { createHash } from "node:crypto";

/** Words that personalise a send and must not split one copy into many. */
const GREETING = /^(dear|hi|hello|hey|good (morning|afternoon|evening)|greetings)\b[^\n.!?]{0,60}[,.!:\-—]?/i;
const FOOTER_START =
  /\b(to unsubscribe|unsubscribe|you are receiving this|you received this|manage (your )?(email )?preferences|update your preferences|privacy policy|this email was sent to|add us to your (address book|safe sender)|whitelist us|©|\(c\) ?20\d\d|copyright 20\d\d|all rights reserved|view (this|in) (email )?(in )?(your )?browser)\b/i;

/** Normalise an email's text body for fingerprinting. */
export function normalizeCopy(text: string): string {
  let body = text.replace(/\r\n?/g, "\n");
  // Drop everything from the first footer marker in the last 40% of the email.
  const cutFrom = Math.floor(body.length * 0.6);
  const tail = body.slice(cutFrom);
  const footer = tail.search(FOOTER_START);
  if (footer >= 0) body = body.slice(0, cutFrom + footer);
  body = body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  body = body.replace(GREETING, "");
  return body
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g, " ")
    .replace(/\b(mon|tues|wednes|thurs|fri|satur|sun)day\b/g, " ")
    .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2}(st|nd|rd|th)?,? (20\d\d)?/g, " ")
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, " ")
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9$%' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function copyHash(normalized: string): string {
  return createHash("sha256").update(normalized).digest("hex");
}

function shingles(normalized: string, size = 4): string[] {
  const words = normalized.split(" ").filter(Boolean);
  if (words.length <= size) return words.length ? [words.join(" ")] : [];
  const out: string[] = [];
  for (let i = 0; i + size <= words.length; i += 1) out.push(words.slice(i, i + size).join(" "));
  return out;
}

function hash64(value: string): bigint {
  return BigInt(`0x${createHash("md5").update(value).digest("hex").slice(0, 16)}`);
}

/** 64-bit SimHash as 16 hex characters. */
export function simhash(normalized: string): string {
  const weights = new Array<number>(64).fill(0);
  for (const shingle of shingles(normalized)) {
    const h = hash64(shingle);
    for (let bit = 0; bit < 64; bit += 1) weights[bit]! += (h >> BigInt(bit)) & 1n ? 1 : -1;
  }
  let out = 0n;
  for (let bit = 0; bit < 64; bit += 1) if (weights[bit]! > 0) out |= 1n << BigInt(bit);
  return out.toString(16).padStart(16, "0");
}

/** The four 16-bit bands of a SimHash. Two hashes within distance 3 share at least one band. */
export function simhashBands(hex: string): [number, number, number, number] {
  const padded = hex.padStart(16, "0");
  return [0, 1, 2, 3].map((i) => parseInt(padded.slice(i * 4, i * 4 + 4), 16)) as [number, number, number, number];
}

export function hammingDistance(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (x) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/** Jaccard similarity of 4-word shingles (0..1). */
export function shingleJaccard(a: string, b: string): number {
  const sa = new Set(shingles(a));
  const sb = new Set(shingles(b));
  if (!sa.size && !sb.size) return 1;
  let inter = 0;
  for (const s of sa) if (sb.has(s)) inter += 1;
  return inter / (sa.size + sb.size - inter);
}

/** Containment: how much of the smaller copy appears in the larger (catches an added ed note). */
export function shingleContainment(a: string, b: string): number {
  const sa = new Set(shingles(a));
  const sb = new Set(shingles(b));
  const small = sa.size <= sb.size ? sa : sb;
  const large = small === sa ? sb : sa;
  if (!small.size) return 0;
  let inter = 0;
  for (const s of small) if (large.has(s)) inter += 1;
  return inter / small.size;
}

export const NEAR_MATCH_DISTANCE = 3;
export const NEAR_MATCH_JACCARD = 0.85;
/** An ed note or P.S. added on top of the same body still counts as the same copy. */
export const NEAR_MATCH_CONTAINMENT = 0.92;
/** Copies shorter than this are too thin to fingerprint (a bare "click here" lift). */
export const MIN_COPY_WORDS = 25;

export type CopyFingerprint = { normalized: string; hash: string; simhash: string; bands: [number, number, number, number]; words: number };

export function fingerprintCopy(text: string): CopyFingerprint {
  const normalized = normalizeCopy(text);
  const sh = simhash(normalized);
  return { normalized, hash: copyHash(normalized), simhash: sh, bands: simhashBands(sh), words: normalized ? normalized.split(" ").length : 0 };
}

export type CopyCandidate = { id: string; copyHash: string; simhash: string; normalized: string };

export type CopyMatch = { id: string; how: "exact" | "near" | "campaign"; similarity: number } | null;

/**
 * Pick the existing copy this fingerprint belongs to. Candidates are the copies that
 * share the exact hash or one SimHash band, plus recent copies from the same publisher
 * (the caller loads them from the database).
 * A short body (under MIN_COPY_WORDS) only ever matches exactly.
 */
export function matchCopy(fp: CopyFingerprint, candidates: readonly CopyCandidate[], campaignCopyId?: string | null): CopyMatch {
  const exact = candidates.find((c) => c.copyHash === fp.hash);
  if (exact) return { id: exact.id, how: "exact", similarity: 1 };
  if (campaignCopyId) return { id: campaignCopyId, how: "campaign", similarity: 1 };
  if (fp.words < MIN_COPY_WORDS) return null;
  let best: { id: string; similarity: number } | null = null;
  for (const c of candidates) {
    const close = hammingDistance(fp.simhash, c.simhash) <= NEAR_MATCH_DISTANCE;
    const jaccard = shingleJaccard(fp.normalized, c.normalized);
    const contained = shingleContainment(fp.normalized, c.normalized) >= NEAR_MATCH_CONTAINMENT;
    if (!(jaccard >= NEAR_MATCH_JACCARD || (contained && (close || jaccard >= 0.5)))) continue;
    if (!best || jaccard > best.similarity) best = { id: c.id, similarity: jaccard };
  }
  return best ? { id: best.id, how: "near", similarity: best.similarity } : null;
}
