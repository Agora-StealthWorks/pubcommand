import { resolveOrgBySlug, tenantDb, type Prisma } from "@pubcommand/db";
import { after } from "next/server";
import { randomBytes } from "node:crypto";
import { FILE_TYPES, fieldSpec, sniffImage, type FileValue, type SignatureValue } from "../../../../../modules/forms/fields";
import { checkSubmission, cleanEndRules, resolveEnding } from "../../../../../modules/forms/logic";
import { asNotifyMode } from "../../../../../modules/forms/notify";
import { pollResults } from "../../../../../modules/forms/poll";
import { acceptingResponses, resolveTheme, spamVerdict } from "../../../../../modules/forms/theme";
import type { AnswerMap, PublicForm, ResolvedTheme } from "../../../../../modules/forms/types";
import { asLayout, formsEnabled, rowToField, themeInput, toPublicForm } from "./data";
import { mirrorResponse } from "./mirror";
import { notifyTeam, sendConfirmation } from "./notify";
import { clientIp, hashIp, rateLimited } from "./server";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export type PublicFormLoad =
  | { kind: "missing" }
  | { kind: "closed"; title: string; message: string; theme: ResolvedTheme }
  | {
      kind: "open";
      organizationId: string;
      form: PublicForm;
      theme: ResolvedTheme;
      formRow: {
        id: string;
        layout: string;
        status: string;
        opensAt: Date | null;
        closesAt: Date | null;
        responseLimit: number | null;
        endRules: Prisma.JsonValue;
        notifyMode: string;
        confirmEmailEnabled: boolean;
      };
    };

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
  const publicForm = toPublicForm(form, fieldRows.map(rowToField));
  publicForm.resultsUrl = form.publicResultsEnabled ? `/f/${form.slug}/results` : null;
  return { kind: "open", organizationId: org.id, form: publicForm, theme: resolved, formRow: form };
}

/** The theme logo for a public form. Logos are not secret; any published (non-draft) form's logo is served, so closed forms and results pages show it too. */
export async function publicLogo(orgSlug: string, formSlug: string) {
  if (!/^[a-z0-9-]{1,63}$/.test(orgSlug) || !/^[a-z0-9-]{1,60}$/.test(formSlug)) return null;
  const org = await resolveOrgBySlug(orgSlug);
  if (!org || org.suspendedAt || !(await formsEnabled(org.id))) return null;
  const db = tenantDb(org.id);
  const form = await db.form.findFirst({ where: { slug: formSlug, deletedAt: null, status: { not: "DRAFT" } }, select: { themeId: true } });
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
    if (!FILE_TYPES.has(field.type)) continue;
    // A file answer only counts when the file itself arrived with this request.
    delete answers[field.id];
    const file = body.get(`file:${field.id}`);
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_UPLOAD_BYTES) return json({ ok: false, errors: { [field.id]: "That file is too large." } }, 422);
      let mimeType = file.type || "application/octet-stream";
      if (field.type === "image_upload") {
        // The real type comes from the bytes; the browser's claim is ignored. Anything else fails validation.
        mimeType = sniffImage(new Uint8Array(await file.slice(0, 16).arrayBuffer())) ?? "application/octet-stream";
      }
      uploads.set(field.id, file);
      answers[field.id] = { filename: file.name, size: file.size, mimeType } satisfies FileValue;
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
  const mirror = spamReason ? null : await db.formMirror.findFirst({ where: { formId: form.id, enabled: true }, select: { id: true } });
  const mirrorState = mirror ? { mirrorStatus: "pending", mirrorTriedAt: new Date(now) } : {};
  const partial = payload.resumeToken ? await db.formResponse.findFirst({ where: { formId: form.id, resumeToken: payload.resumeToken, status: "PARTIAL" }, select: { id: true } }) : null;
  let responseId: string;
  if (partial) {
    await db.formResponse.updateMany({ where: { id: partial.id }, data: { ...base, ...mirrorState, answers: {}, startedAt } });
    responseId = partial.id;
  } else {
    const created = await db.formResponse.create({ data: { ...base, ...mirrorState, organizationId, formId: form.id, resumeToken: newToken(), answers: {}, startedAt } });
    responseId = created.id;
  }
  for (const [fieldId, file] of uploads) {
    if (!(fieldId in stored)) continue;
    const row = await db.formFile.create({
      data: { organizationId, formId: form.id, responseId, fieldId, kind: "upload", filename: file.name.slice(0, 200), mimeType: (stored[fieldId] as FileValue).mimeType, size: file.size, data: new Uint8Array(await file.arrayBuffer()) },
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

  // The ending is decided here, from the answers just stored, never by the browser.
  const ending = resolveEnding(fields, check.answers, cleanEndRules(fields, loaded.formRow.endRules), {
    title: form.confirmTitle,
    message: form.confirmMessage,
    redirectUrl: form.redirectUrl,
  });
  if (!spamReason) {
    const notifyEach = asNotifyMode(loaded.formRow.notifyMode) === "each";
    const confirm = loaded.formRow.confirmEmailEnabled;
    after(async () => {
      // Each step is independent and soft-fails: the jobs retry notifications and mirrors.
      if (notifyEach) await notifyTeam(organizationId, form.id, [responseId]).catch(() => undefined);
      if (confirm) await sendConfirmation(organizationId, form.id, responseId).catch(() => undefined);
      if (mirror) await mirrorResponse(organizationId, responseId).catch(() => undefined);
    });
  }
  return json({ ok: true, ending: { title: ending.title, message: ending.message, redirectUrl: ending.redirectUrl } });
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
    if (spec?.captures && !FILE_TYPES.has(field.type) && field.type !== "signature" && field.id in payload.answers) raw[field.id] = payload.answers[field.id];
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


/**
 * The public live results of a form, when its author turned them on.
 * Aggregates of closed questions only (modules/forms/poll.ts). Works for a
 * closed form too (a finished poll), never for a draft or a deleted form.
 */
export async function loadPublicResults(orgSlug: string, formSlug: string) {
  if (!/^[a-z0-9-]{1,63}$/.test(orgSlug) || !/^[a-z0-9-]{1,60}$/.test(formSlug)) return null;
  const org = await resolveOrgBySlug(orgSlug);
  if (!org || org.suspendedAt || !(await formsEnabled(org.id))) return null;
  const db = tenantDb(org.id);
  const form = await db.form.findFirst({ where: { slug: formSlug, deletedAt: null, status: { not: "DRAFT" }, publicResultsEnabled: true } });
  if (!form) return null;
  const [brand, theme, fieldRows, rows] = await Promise.all([
    db.brand.findFirst({ where: { id: form.brandId }, select: { name: true } }),
    form.themeId ? db.formTheme.findFirst({ where: { id: form.themeId, deletedAt: null } }) : null,
    db.formField.findMany({ where: { formId: form.id }, orderBy: { position: "asc" } }),
    // Only what the tally needs: no ids, times or metadata leave this function.
    db.formResponse.findMany({ where: { formId: form.id, status: "COMPLETE", spamReason: null }, select: { answers: true }, take: 50000 }),
  ]);
  const logoSrc = theme?.logoFileId ? `/f/${form.slug}/logo?v=${theme.updatedAt.getTime()}` : theme?.logoUrl && /^https?:\/\//i.test(theme.logoUrl) ? theme.logoUrl : null;
  const fields = fieldRows.map(rowToField);
  const responses = rows.map((row, index) => ({
    id: String(index),
    status: "COMPLETE" as const,
    answers: (row.answers && typeof row.answers === "object" && !Array.isArray(row.answers) ? row.answers : {}) as AnswerMap,
    startedAt: new Date(0),
    completedAt: new Date(0),
    durationMs: null,
    lastPageIndex: 0,
    utm: null,
    spamReason: null,
  }));
  return {
    title: form.title,
    open: form.status === "OPEN",
    theme: resolveTheme(themeInput(theme, logoSrc), brand?.name ?? org.name),
    results: pollResults({ enabled: true, minResponses: form.publicResultsMin, fields, responses }),
  };
}
