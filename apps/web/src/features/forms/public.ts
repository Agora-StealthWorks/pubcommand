import { resolveOrgBySlug, tenantDb, type Prisma } from "@pubcommand/db";
import { randomBytes } from "node:crypto";
import { fieldSpec, type FileValue, type SignatureValue } from "../../../../../modules/forms/fields";
import { checkSubmission } from "../../../../../modules/forms/logic";
import { acceptingResponses, resolveTheme, spamVerdict } from "../../../../../modules/forms/theme";
import type { AnswerMap, PublicForm, ResolvedTheme } from "../../../../../modules/forms/types";
import { asLayout, formsEnabled, rowToField, themeInput, toPublicForm } from "./data";
import { clientIp, hashIp, rateLimited } from "./server";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export type PublicFormLoad =
  | { kind: "missing" }
  | { kind: "closed"; title: string; message: string; theme: ResolvedTheme }
  | { kind: "open"; organizationId: string; form: PublicForm; theme: ResolvedTheme; formRow: { id: string; layout: string; status: string; opensAt: Date | null; closesAt: Date | null; responseLimit: number | null } };

/** Load a form for anonymous respondents by organization slug + form slug. Never returns responses. */
export async function loadPublicForm(orgSlug: string, formSlug: string, now = new Date()): Promise<PublicFormLoad> {
  if (!/^[a-z0-9-]{1,63}$/.test(orgSlug) || !/^[a-z0-9-]{1,60}$/.test(formSlug)) return { kind: "missing" };
  const org = await resolveOrgBySlug(orgSlug);
  if (!org || org.suspendedAt || !(await formsEnabled(org.id))) return { kind: "missing" };
  const db = tenantDb(org.id);
  const form = await db.form.findFirst({ where: { slug: formSlug, deletedAt: null, status: { not: "DRAFT" } } });
  if (!form) return { kind: "missing" };
  const [brand, theme, fieldRows, complete] = await Promise.all([
    db.brand.findFirst({ where: { id: form.brandId }, select: { name: true } }),
    form.themeId ? db.formTheme.findFirst({ where: { id: form.themeId, deletedAt: null } }) : null,
    db.formField.findMany({ where: { formId: form.id }, orderBy: { position: "asc" } }),
    db.formResponse.count({ where: { formId: form.id, status: "COMPLETE", spamReason: null } }),
  ]);
  const logoSrc = theme?.logoFileId ? `/f/${form.slug}/logo?v=${theme.updatedAt.getTime()}` : theme?.logoUrl && /^https?:\/\//i.test(theme.logoUrl) ? theme.logoUrl : null;
  const resolved = resolveTheme(themeInput(theme, logoSrc), brand?.name ?? org.name);
  const window = acceptingResponses(form, complete, now);
  if (!window.open || !resolved.privacyPolicyUrl) {
    return { kind: "closed", title: form.title, message: window.open ? "This form is not set up yet." : form.closedMessage || window.reason || "", theme: resolved };
  }
  return { kind: "open", organizationId: org.id, form: toPublicForm(form, fieldRows.map(rowToField)), theme: resolved, formRow: form };
}

/** The theme logo for a public form. Logos are not secret, but only an open form's logo is served here. */
export async function publicLogo(orgSlug: string, formSlug: string) {
  const loaded = await loadPublicForm(orgSlug, formSlug);
  if (loaded.kind !== "open") return null;
  const db = tenantDb(loaded.organizationId);
  const form = await db.form.findFirst({ where: { id: loaded.form.id }, select: { themeId: true } });
  const theme = form?.themeId ? await db.formTheme.findFirst({ where: { id: form.themeId }, select: { logoFileId: true } }) : null;
  if (!theme?.logoFileId) return null;
  return db.formFile.findFirst({ where: { id: theme.logoFileId, kind: "logo" } });
}

type Payload = {
  answers: AnswerMap;
  utm: Record<string, string>;
  startedAt: number | null;
  honeypot: string;
  resumeToken: string | null;
  lastPageIndex: number;
  referrer: string | null;
};

function parsePayload(raw: unknown): Payload {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const answers = source.answers && typeof source.answers === "object" && !Array.isArray(source.answers) ? (source.answers as AnswerMap) : {};
  const utm: Record<string, string> = {};
  if (source.utm && typeof source.utm === "object") {
    for (const [key, value] of Object.entries(source.utm as Record<string, unknown>).slice(0, 10)) {
      if (/^utm_[a-z]{1,10}$/.test(key) && typeof value === "string") utm[key] = value.slice(0, 200);
    }
  }
  const startedAt = typeof source.startedAt === "number" && Number.isFinite(source.startedAt) ? source.startedAt : null;
  const token = typeof source.resumeToken === "string" && /^[A-Za-z0-9_-]{20,64}$/.test(source.resumeToken) ? source.resumeToken : null;
  const page = Number(source.lastPageIndex);
  return {
    answers,
    utm,
    startedAt,
    honeypot: typeof source.honeypot === "string" ? source.honeypot : "",
    resumeToken: token,
    lastPageIndex: Number.isInteger(page) && page >= 0 && page < 1000 ? page : 0,
    referrer: typeof source.referrer === "string" ? source.referrer.slice(0, 500) : null,
  };
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return true;
  try {
    return new URL(origin).host === host.split(",")[0]!.trim();
  } catch {
    return false;
  }
}

/** POST /f/<slug>/submit: the server re-derives branching from raw answers (modules/forms/logic.ts) before storing anything. */
export async function handleSubmit(request: Request, orgSlug: string, formSlug: string): Promise<Response> {
  if (!sameOrigin(request)) return json({ ok: false, error: "Cross-site submissions are not accepted." }, 403);
  const loaded = await loadPublicForm(orgSlug, formSlug);
  if (loaded.kind !== "open") return json({ ok: false, error: loaded.kind === "closed" ? loaded.message : "This form does not exist." }, 404);
  let body: FormData;
  try {
    body = await request.formData();
  } catch {
    return json({ ok: false, error: "The submission could not be read." }, 400);
  }
  let payload: Payload;
  try {
    payload = parsePayload(JSON.parse(String(body.get("payload") ?? "{}")));
  } catch {
    return json({ ok: false, error: "The submission could not be read." }, 400);
  }
  const { form, organizationId } = loaded;
  const fields = form.fields;
  const answers: AnswerMap = { ...payload.answers };
  const uploads = new Map<string, File>();
  for (const field of fields) {
    if (field.type !== "file_upload") continue;
    // A file answer only counts when the file itself arrived with this request.
    delete answers[field.id];
    const file = body.get(`file:${field.id}`);
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_UPLOAD_BYTES) return json({ ok: false, errors: { [field.id]: "That file is too large." } }, 422);
      uploads.set(field.id, file);
      answers[field.id] = { filename: file.name, size: file.size, mimeType: file.type || "application/octet-stream" } satisfies FileValue;
    }
  }
  for (const field of fields) {
    if (field.type !== "signature") continue;
    const value = answers[field.id] as SignatureValue | undefined;
    if (value && typeof value === "object") delete value.fileId;
  }

  const check = checkSubmission(fields, form.layout, answers);
  if (!check.ok) return json({ ok: false, errors: check.errors }, 422);

  const ip = clientIp(request.headers);
  const ipHash = hashIp(ip);
  if (await rateLimited(organizationId, form.id, ipHash)) return json({ ok: false, error: "Too many submissions from this connection. Try again in a few minutes." }, 429);
  const now = Date.now();
  const spamReason = spamVerdict({ honeypot: payload.honeypot, startedAt: payload.startedAt, now });
  const db = tenantDb(organizationId);
  const stored: AnswerMap = { ...check.answers };
  const startedAt = payload.startedAt && payload.startedAt < now && now - payload.startedAt < 7 * 24 * 3600 * 1000 ? new Date(payload.startedAt) : new Date(now);
  const base = {
    status: "COMPLETE" as const,
    completedAt: new Date(now),
    durationMs: Math.min(now - startedAt.getTime(), 2_000_000_000),
    lastPageIndex: payload.lastPageIndex,
    ipHash,
    userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
    referrer: payload.referrer,
    utm: Object.keys(payload.utm).length ? payload.utm : undefined,
    spamReason,
  };
  const partial = payload.resumeToken ? await db.formResponse.findFirst({ where: { formId: form.id, resumeToken: payload.resumeToken, status: "PARTIAL" }, select: { id: true } }) : null;
  let responseId: string;
  if (partial) {
    await db.formResponse.updateMany({ where: { id: partial.id }, data: { ...base, answers: {}, startedAt } });
    responseId = partial.id;
  } else {
    const created = await db.formResponse.create({ data: { ...base, organizationId, formId: form.id, resumeToken: newToken(), answers: {}, startedAt } });
    responseId = created.id;
  }
  for (const [fieldId, file] of uploads) {
    if (!(fieldId in stored)) continue;
    const row = await db.formFile.create({
      data: { organizationId, formId: form.id, responseId, fieldId, kind: "upload", filename: file.name.slice(0, 200), mimeType: file.type || "application/octet-stream", size: file.size, data: new Uint8Array(await file.arrayBuffer()) },
    });
    stored[fieldId] = { ...(stored[fieldId] as FileValue), fileId: row.id };
  }
  for (const field of fields) {
    const value = stored[field.id] as SignatureValue | undefined;
    if (field.type !== "signature" || !value?.dataUrl) continue;
    const data = Buffer.from(value.dataUrl.slice("data:image/png;base64,".length), "base64");
    const row = await db.formFile.create({ data: { organizationId, formId: form.id, responseId, fieldId: field.id, kind: "signature", filename: "signature.png", mimeType: "image/png", size: data.length, data: new Uint8Array(data) } });
    stored[field.id] = { fileId: row.id, typedName: value.typedName, signedAt: new Date(now).toISOString() } satisfies SignatureValue;
  }
  await db.formResponse.updateMany({ where: { id: responseId }, data: { answers: stored as Prisma.InputJsonValue } });
  return json({ ok: true });
}

function newToken(): string {
  return randomBytes(24).toString("base64url");
}

/** POST /f/<slug>/progress: autosave a partial response (for drop-off figures). Files and signatures are never autosaved. */
export async function handleProgress(request: Request, orgSlug: string, formSlug: string): Promise<Response> {
  if (!sameOrigin(request)) return json({ ok: false }, 403);
  const loaded = await loadPublicForm(orgSlug, formSlug);
  if (loaded.kind !== "open") return json({ ok: false }, 404);
  let payload: Payload;
  try {
    payload = parsePayload(await request.json());
  } catch {
    return json({ ok: false }, 400);
  }
  const { form, organizationId } = loaded;
  const raw: AnswerMap = {};
  for (const field of form.fields) {
    const spec = fieldSpec(field.type);
    if (spec?.captures && field.type !== "file_upload" && field.type !== "signature" && field.id in payload.answers) raw[field.id] = payload.answers[field.id];
  }
  // Only answers that pass their checks and sit on the path are kept; missing required ones are fine for a partial.
  const answers = checkSubmission(form.fields, asLayout(form.layout), raw).answers;
  const db = tenantDb(organizationId);
  if (payload.resumeToken) {
    const updated = await db.formResponse.updateMany({
      where: { formId: form.id, resumeToken: payload.resumeToken, status: "PARTIAL" },
      data: { answers: answers as Prisma.InputJsonValue, lastPageIndex: payload.lastPageIndex },
    });
    if (updated.count) return json({ ok: true, resumeToken: payload.resumeToken });
  }
  const ipHash = hashIp(clientIp(request.headers));
  if (await rateLimited(organizationId, form.id, ipHash)) return json({ ok: false }, 429);
  const token = newToken();
  await db.formResponse.create({
    data: {
      organizationId,
      formId: form.id,
      resumeToken: token,
      answers: answers as Prisma.InputJsonValue,
      lastPageIndex: payload.lastPageIndex,
      ipHash,
      userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
      referrer: payload.referrer,
      utm: Object.keys(payload.utm).length ? payload.utm : undefined,
      spamReason: payload.honeypot.trim() ? "honeypot" : null,
    },
  });
  return json({ ok: true, resumeToken: token });
}

