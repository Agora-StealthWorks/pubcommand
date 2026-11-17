"use server";

import { appendOrgAudit, tenantDb } from "@pubcommand/db";
import { redirect } from "next/navigation";
import { CUB_SCORES, parseScore, safeFilename, zonedToUtc } from "../../../../../modules/editorial/cub";
import { currentRequest } from "@/lib/request";
import { calendarAction, field, UUID, withMessage } from "./context";
import { MAX_CUB_FILE_BYTES, newToken, roundByToken } from "./cub";

const TEAM_TZ = "America/New_York";

export async function createCubRoundAction(formData: FormData) {
  const ctx = await calendarAction("editorial.write", "/editorial/cub");
  const promoName = field(formData, "promoName", 200);
  const file = formData.get("draft");
  if (!promoName) redirect(withMessage("/editorial/cub", "error", "Name the promo."));
  if (!(file instanceof File) || file.size === 0) redirect(withMessage("/editorial/cub", "error", "Upload the draft."));
  if (file.size > MAX_CUB_FILE_BYTES) redirect(withMessage("/editorial/cub", "error", "The draft is over 50 MB."));
  const due = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(field(formData, "dueAt", 16));
  if (!due) redirect(withMessage("/editorial/cub", "error", "Set a deadline."));
  const round = await tenantDb(ctx.resolved.id).calendarCubRound.create({
    data: {
      organizationId: ctx.resolved.id,
      brandId: ctx.brand.id,
      promoName,
      instructions: field(formData, "instructions", 4000) || null,
      draftFilename: safeFilename(file.name, "draft"),
      draftMime: file.type || "application/octet-stream",
      draftSize: file.size,
      draftData: new Uint8Array(await file.arrayBuffer()),
      dueAt: zonedToUtc(due[1]!, due[2]!, TEAM_TZ),
      reviewToken: newToken(),
      ownerToken: newToken(),
      createdById: ctx.actorId,
    },
    select: { id: true },
  });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: "calendar.cub.created", targetType: "calendar_cub_round", targetId: round.id });
  redirect(withMessage(`/editorial/cub/${round.id}`, "notice", "Round created. Send the reviewer link to your reviewers."));
}

export async function closeCubRoundAction(formData: FormData) {
  const ctx = await calendarAction("editorial.write", "/editorial/cub");
  const id = field(formData, "roundId", 40);
  if (!UUID.test(id)) redirect("/editorial/cub");
  const reopen = formData.get("reopen") === "1";
  await tenantDb(ctx.resolved.id).calendarCubRound.updateMany({ where: { id, brandId: ctx.brand.id }, data: { closedAt: reopen ? null : new Date() } });
  await appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action: reopen ? "calendar.cub.reopened" : "calendar.cub.closed", targetType: "calendar_cub_round", targetId: id });
  redirect(withMessage(`/editorial/cub/${id}`, "notice", reopen ? "Round reopened." : "Round closed. The reviewer link no longer accepts revisions."));
}

export async function deleteCubRoundAction(formData: FormData) {
  const ctx = await calendarAction("editorial.write", "/editorial/cub");
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
