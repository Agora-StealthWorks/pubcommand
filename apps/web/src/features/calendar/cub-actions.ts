"use server";

import { appendOrgAudit, tenantDb } from "@pubcommand/db";
import { redirect } from "next/navigation";
import { CUB_SCORES, parseScore, safeFilename, zonedToUtc } from "../../../../../modules/editorial/cub";
import { parseEmails, TEMPLATES } from "../../../../../modules/editorial/emails";
import { currentRequest } from "@/lib/request";
import { calendarAction, field, UUID, withMessage } from "./context";
import { MAX_CUB_FILE_BYTES, newToken, roundByToken } from "./cub";
import { sendRoundStart, type SendStatus } from "./cub-emails";
import { CUB_COLLECTOR_ENABLED } from "../../../../../modules/editorial/features";
import { findPromo } from "./promos";

const TEAM_TZ = "America/New_York";

function emailNotice(result: { request: SendStatus; confirm: SendStatus; reasons: string[] }, reviewers: number, lead = "Round created."): string {
  if (result.request === "logged") return `${lead} Email is not set up yet, so nothing was sent: copy the reviewer link below into your own message.`;
  if (result.request === "sent") return `${lead} The request went to ${reviewers} reviewer${reviewers === 1 ? "" : "s"}.`;
  if (result.request === "failed") return `${lead} The request email failed (${result.reasons.join(" ")}). Copy the reviewer link below instead.`;
  return `${lead} ${result.reasons.join(" ") || "No reviewers were emailed."} Copy the reviewer link below.`;
}

export async function createCubRoundAction(formData: FormData) {
  const ctx = await calendarAction("editorial.write", "/editorial/cub");
  if (!CUB_COLLECTOR_ENABLED) redirect("/editorial");
  const promo = await findPromo(ctx.resolved.id, ctx.brand.id, field(formData, "calendarPromoId", 40));
  const promoName = field(formData, "promoName", 200) || promo?.name || "";
  const file = formData.get("draft");
  if (!promoName) redirect(withMessage("/editorial/cub", "error", "Pick a promo or type its name."));
  if (!(file instanceof File) || file.size === 0) redirect(withMessage("/editorial/cub", "error", "Upload the draft."));
  if (file.size > MAX_CUB_FILE_BYTES) redirect(withMessage("/editorial/cub", "error", "The draft is over 50 MB."));
  const due = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(field(formData, "dueAt", 16));
  if (!due) redirect(withMessage("/editorial/cub", "error", "Set a deadline."));
  const reviewers = parseEmails(field(formData, "reviewers", 5000));
  if (reviewers.invalid.length) redirect(withMessage("/editorial/cub", "error", `These do not look like email addresses: ${reviewers.invalid.slice(0, 5).join(", ")}.`));
  const db = tenantDb(ctx.resolved.id);
  const request = await currentRequest();
  const draftData = new Uint8Array(await file.arrayBuffer());
  const draftFilename = safeFilename(file.name, "draft");
  const round = await db.calendarCubRound.create({
    data: {
      organizationId: ctx.resolved.id,
      brandId: ctx.brand.id,
      calendarPromoId: promo?.id ?? null,
      promoName,
      instructions: field(formData, "instructions", 4000) || null,
      draftFilename,
      draftMime: file.type || "application/octet-stream",
      draftSize: file.size,
      draftData,
      dueAt: zonedToUtc(due[1]!, due[2]!, TEAM_TZ),
      reviewToken: newToken(),
      ownerToken: newToken(),
      initiatorEmail: ctx.auth.user.email,
      initiatorName: ctx.auth.user.name,
      reviewerEmails: reviewers.valid,
      publicBase: request.origin,
      createdById: ctx.actorId,
    },
    select: { id: true },
  });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "calendar.cub.created", targetType: "calendar_cub_round", targetId: round.id, metadata: { reviewers: reviewers.valid.length, calendarPromoId: promo?.id ?? null } });

  if (formData.get("saveGroup") === "1") {
    const existing = await db.calendarEmailTemplate.findFirst({ where: { brandId: ctx.brand.id, kind: "cub-request" } });
    if (existing) await db.calendarEmailTemplate.updateMany({ where: { id: existing.id }, data: { recipients: reviewers.valid, updatedById: ctx.actorId } });
    else {
      const spec = TEMPLATES["cub-request"];
      await db.calendarEmailTemplate.create({ data: { organizationId: ctx.resolved.id, brandId: ctx.brand.id, kind: "cub-request", subject: spec.subject, body: spec.body, recipients: reviewers.valid, updatedById: ctx.actorId } });
    }
  }

  // While CUB Collector was on, a round moved the promo to the CUB stage and kept the draft on it.
  // Calendar promos do not do that: people pick the CUB stage themselves.

  const result = await sendRoundStart({ organizationId: ctx.resolved.id, roundId: round.id, subject: field(formData, "emailSubject", 250), body: field(formData, "emailBody", 10000) });
  redirect(withMessage(`/editorial/cub/${round.id}`, result.request === "failed" ? "error" : "notice", emailNotice(result, reviewers.valid.length)));
}

/** Re-send the start emails for a round (for example after setting up email or fixing the reviewer list). */
export async function resendCubRequestAction(formData: FormData) {
  const ctx = await calendarAction("editorial.write", "/editorial/cub");
  if (!CUB_COLLECTOR_ENABLED) redirect("/editorial");
  const id = field(formData, "roundId", 40);
  if (!UUID.test(id)) redirect("/editorial/cub");
  const db = tenantDb(ctx.resolved.id);
  const round = await db.calendarCubRound.findFirst({ where: { id, brandId: ctx.brand.id }, select: { id: true, closedAt: true } });
  if (!round) redirect(withMessage("/editorial/cub", "error", "That round no longer exists."));
  const reviewers = parseEmails(field(formData, "reviewers", 5000));
  if (reviewers.invalid.length) redirect(withMessage(`/editorial/cub/${id}`, "error", `These do not look like email addresses: ${reviewers.invalid.slice(0, 5).join(", ")}.`));
  await db.calendarCubRound.updateMany({ where: { id }, data: { reviewerEmails: reviewers.valid } });
  const result = await sendRoundStart({ organizationId: ctx.resolved.id, roundId: id });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "calendar.cub.resent", targetType: "calendar_cub_round", targetId: id, metadata: { reviewers: reviewers.valid.length, status: result.request } });
  redirect(withMessage(`/editorial/cub/${id}`, result.request === "failed" ? "error" : "notice", emailNotice(result, reviewers.valid.length, "Sent again.")));
}

export async function closeCubRoundAction(formData: FormData) {
  const ctx = await calendarAction("editorial.write", "/editorial/cub");
  if (!CUB_COLLECTOR_ENABLED) redirect("/editorial");
  const id = field(formData, "roundId", 40);
  if (!UUID.test(id)) redirect("/editorial/cub");
  const reopen = formData.get("reopen") === "1";
  await tenantDb(ctx.resolved.id).calendarCubRound.updateMany({ where: { id, brandId: ctx.brand.id }, data: { closedAt: reopen ? null : new Date() } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: reopen ? "calendar.cub.reopened" : "calendar.cub.closed", targetType: "calendar_cub_round", targetId: id });
  redirect(withMessage(`/editorial/cub/${id}`, "notice", reopen ? "Round reopened." : "Round closed. The reviewer link no longer accepts revisions."));
}

export async function deleteCubRoundAction(formData: FormData) {
  const ctx = await calendarAction("editorial.write", "/editorial/cub");
  if (!CUB_COLLECTOR_ENABLED) redirect("/editorial");
  const id = field(formData, "roundId", 40);
  if (!UUID.test(id)) redirect("/editorial/cub");
  await tenantDb(ctx.resolved.id).calendarCubRound.deleteMany({ where: { id, brandId: ctx.brand.id } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "calendar.cub.deleted", targetType: "calendar_cub_round", targetId: id });
  redirect(withMessage("/editorial/cub", "notice", "Round deleted with its revisions."));
}

/**
 * Public, token-gated: a reviewer submits a marked-up file and four scores.
 * No sign-in. The token and the host's organization are the only credentials.
 */
export async function submitCubReviewAction(formData: FormData) {
  if (!CUB_COLLECTOR_ENABLED) redirect("/");
  const request = await currentRequest();
  const token = field(formData, "token", 40);
  if (request.site.kind !== "org") redirect("/");
  const back = `/p/cub/r/${token}`;
  const found = await roundByToken(request.site.slug, "review", token);
  if (!found) redirect(back);
  if (found.round.closedAt) redirect(withMessage(back, "error", "This review round is closed."));
  const name = field(formData, "reviewerName", 120);
  const file = formData.get("revision");
  const scores = Object.fromEntries(CUB_SCORES.map((s) => [s.key, parseScore(formData.get(s.key))]));
  if (!name) redirect(withMessage(back, "error", "Add your name so the writer knows whose revision this is."));
  if (Object.values(scores).some((v) => v == null)) redirect(withMessage(back, "error", "Score all four categories from 0 to 10."));
  if (!(file instanceof File) || file.size === 0) redirect(withMessage(back, "error", "Attach your marked-up file."));
  if (file.size > MAX_CUB_FILE_BYTES) redirect(withMessage(back, "error", "That file is over 50 MB."));
  await tenantDb(found.organization.id).calendarCubReview.create({
    data: {
      organizationId: found.organization.id,
      roundId: found.round.id,
      reviewerName: name,
      filename: safeFilename(file.name, "revision"),
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      data: new Uint8Array(await file.arrayBuffer()),
      scoreHeadline: scores.scoreHeadline!,
      scoreStory: scores.scoreStory!,
      scoreOffer: scores.scoreOffer!,
      scoreOverall: scores.scoreOverall!,
      comments: field(formData, "comments", 4000) || null,
    },
  });
  await appendOrgAudit(found.organization.id, { actorId: null, action: "calendar.cub.review_submitted", targetType: "calendar_cub_round", targetId: found.round.id });
  redirect(`${back}?done=1`);
}
