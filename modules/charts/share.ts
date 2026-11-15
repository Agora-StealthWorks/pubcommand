import { createHmac, timingSafeEqual } from "node:crypto";
import { parseCsv } from "./csv";
import { ANNOTATION_LIMIT, CSV_LIMIT, asChartDraft, type ChartDraft } from "./draft";
import { normalizeAccent } from "./svg";

export type ChartShare = {
  organizationId: string;
  csv: string;
  annotation: string;
  accent: string;
};

type TokenResult = { ok: true; token: string } | { ok: false; error: string };

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function createChartShareToken(draft: ChartDraft, organizationId: string, secret: string): TokenResult {
  const input = asChartDraft(draft);
  if (secret.length < 16) return { ok: false, error: "Share links are unavailable." };
  if (!organizationId) return { ok: false, error: "Share links are unavailable." };
  if (input.csv.length > CSV_LIMIT) return { ok: false, error: "CSV is too long to share." };
  if (input.annotation.trim().length > ANNOTATION_LIMIT) return { ok: false, error: "Annotation is too long." };
  const parsed = parseCsv(input.csv);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const payload: ChartShare & { v: 1 } = {
    v: 1,
    organizationId,
    csv: input.csv,
    annotation: input.annotation.trim(),
    accent: normalizeAccent(input.accent),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { ok: true, token: `${body}.${sign(body, secret)}` };
}

export function readChartShare(token: string, secret: string, organizationId: string): ChartShare | null {
  if (secret.length < 16 || !organizationId) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return null;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(body, secret);
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<ChartShare> & { v?: number };
    if (parsed.v !== 1) return null;
    if (parsed.organizationId !== organizationId) return null;
    if (typeof parsed.csv !== "string" || typeof parsed.annotation !== "string" || typeof parsed.accent !== "string") {
      return null;
    }
    return {
      organizationId: parsed.organizationId,
      csv: parsed.csv,
      annotation: parsed.annotation,
      accent: normalizeAccent(parsed.accent),
    };
  } catch {
    return null;
  }
}

export function chartShareSearch(token: string): string {
  return `?share=${encodeURIComponent(token)}`;
}
