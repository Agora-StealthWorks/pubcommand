import { appendOrgAudit, tenantDb } from "@pubcommand/db";
import { cubBrainNote } from "../../../../../modules/editorial/brain";
import { averageScores, CUB_SCORES, formatDeadline } from "../../../../../modules/editorial/cub";
import {
  cubMergeValues,
  effectiveTemplate,
  MAX_ATTACHMENT_BYTES,
  planCubTick,
  renderMerge,
  textToHtml,
  type CubEmailKind,
  type TemplateRow,
} from "../../../../../modules/editorial/emails";
import { sendEmail, type EmailResult } from "@/lib/email";
import { teachBrain } from "../brain/teach";

export type SendStatus = "sent" | "logged" | "failed" | "skipped";

export async function loadTemplate(organizationId: string, brandId: string, kind: CubEmailKind): Promise<TemplateRow> {
  const row = await tenantDb(organizationId).calendarEmailTemplate.findFirst({ where: { brandId, kind } });
  return effectiveTemplate(kind, row);
}

export async function loadTemplates(organizationId: string, brandId: string) {
  const rows = await tenantDb(organizationId).calendarEmailTemplate.findMany({ where: { brandId } });
  return new Map(rows.map((r) => [r.kind, r]));
}

function statusOf(result: EmailResult): SendStatus {
  return result.status;
}

/** Send one CUB email and log the outcome (recipient count only). Never throws. */
async function deliver(input: {
  organizationId: string;
  brandId: string;
  roundId: string;
  kind: CubEmailKind;
  to: string[];
  subject: string;
  text: string;
  attachment?: { filename: string; content: Uint8Array } | null;
}): Promise<{ status: SendStatus; reason?: string }> {
  const db = tenantDb(input.organizationId);
  let status: SendStatus;
  let reason: string | undefined;
  if (!input.to.length) {
    status = "skipped";
    reason = "No recipients.";
  } else {
    const result = await sendEmail({
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: textToHtml(input.text),
      attachments: input.attachment ? [input.attachment] : undefined,
    });
    status = statusOf(result);
    reason = result.status === "failed" ? result.reason : undefined;
  }
  await db.calendarEmailLog
    .create({ data: { organizationId: input.organizationId, brandId: input.brandId, kind: input.kind, roundId: input.roundId, recipients: input.to.length, status, error: reason?.slice(0, 300) ?? null } })
    .catch(() => undefined);
  return { status, reason };
}

async function roundFor(organizationId: string, roundId: string) {
  const db = tenantDb(organizationId);
  const round = await db.calendarCubRound.findFirst({ where: { id: roundId } });
  if (!round) return null;
  const brand = await db.brand.findFirst({ where: { id: round.brandId }, select: { name: true } });
  return { round, brandName: brand?.name ?? "" };
}

function links(round: { publicBase: string | null; reviewToken: string; ownerToken: string }) {
  const base = (round.publicBase ?? "").replace(/\/$/, "");
  return { review: `${base}/p/cub/r/${round.reviewToken}`, owner: `${base}/p/cub/o/${round.ownerToken}` };
}

function draftAttachment(round: { draftFilename: string; draftSize: number; draftData: Uint8Array }) {
  return round.draftSize <= MAX_ATTACHMENT_BYTES ? { filename: round.draftFilename, content: round.draftData } : null;
}

/**
 * Start-of-round emails: the request to the reviewers (draft attached) and the
 * confirmation to whoever started it. The request may use an edited subject and
 * body; both are still merged, so {{reviewLink}} fills in.
 */
export async function sendRoundStart(input: {
  organizationId: string;
  roundId: string;
  subject?: string | null;
  body?: string | null;
}): Promise<{ request: SendStatus; confirm: SendStatus; reasons: string[] }> {
  const found = await roundFor(input.organizationId, input.roundId);
  if (!found) return { request: "skipped", confirm: "skipped", reasons: ["Round not found."] };
  const { round, brandName } = found;
  const link = links(round);
  const deadline = formatDeadline(round.dueAt);
  const reasons: string[] = [];

  const requestTpl = await loadTemplate(input.organizationId, round.brandId, "cub-request");
  let request: SendStatus = "skipped";
  if (!requestTpl.enabled) reasons.push("The review request email is turned off in Setup.");
  else {
    const values = cubMergeValues({ promoName: round.promoName, brandName, initiatorName: round.initiatorName, deadline, reviewLink: link.review, instructions: round.instructions });
    const subject = renderMerge(input.subject?.trim() || requestTpl.subject, values);
    const text = renderMerge(input.body?.trim() || requestTpl.body, values);
    const attachment = draftAttachment(round);
    const sent = await deliver({
      organizationId: input.organizationId,
      brandId: round.brandId,
      roundId: round.id,
      kind: "cub-request",
      to: round.reviewerEmails,
      subject,
      text: attachment ? text : `${text}\n\nThe draft is too large to attach. Download it from the review link.`,
      attachment,
    });
    request = sent.status;
    if (sent.reason) reasons.push(`Review request: ${sent.reason}`);
  }

  const confirmTpl = await loadTemplate(input.organizationId, round.brandId, "cub-owner-confirm");
  let confirm: SendStatus = "skipped";
  if (confirmTpl.enabled && round.initiatorEmail) {
    const values = cubMergeValues({ promoName: round.promoName, deadline, ownerLink: link.owner, reviewerCount: round.reviewerEmails.length });
    const sent = await deliver({
      organizationId: input.organizationId,
      brandId: round.brandId,
      roundId: round.id,
      kind: "cub-owner-confirm",
      to: [round.initiatorEmail],
      subject: renderMerge(confirmTpl.subject, values),
      text: renderMerge(confirmTpl.body, values),
    });
    confirm = sent.status;
    if (sent.reason) reasons.push(`Confirmation: ${sent.reason}`);
  }
  if (request === "sent" || request === "logged") {
    await tenantDb(input.organizationId).calendarCubRound.updateMany({ where: { id: round.id }, data: { requestSentAt: new Date() } });
  }
  return { request, confirm, reasons };
}

/** Teach the brand's Brain the averaged, anonymous scores of a finished round. Soft-fails. */
export async function teachCubRound(organizationId: string, roundId: string): Promise<void> {
  try {
    const db = tenantDb(organizationId);
    const round = await db.calendarCubRound.findFirst({ where: { id: roundId }, select: { id: true, brandId: true, promoName: true, dueAt: true, createdById: true } });
    if (!round) return;
    const reviews = await db.calendarCubReview.findMany({ where: { roundId }, select: { scoreHeadline: true, scoreStory: true, scoreOffer: true, scoreOverall: true } });
    const avg = averageScores(reviews);
    const note = cubBrainNote({
      promoName: round.promoName,
      dueAt: formatDeadline(round.dueAt),
      count: avg.count,
      averages: CUB_SCORES.map((s) => ({ label: s.label, value: avg[s.key] })),
      overall: avg.overall,
    });
    await teachBrain({ organizationId, brandId: round.brandId, sourceRef: `calendar-cub:${round.id}`, title: note.title, body: note.body, folder: "Marketing Calendar", source: "marketing-calendar", actorId: null });
  } catch (error) {
    console.error("[calendar] could not teach the Brain about a CUB round", error);
  }
}

/**
 * One tick for one organization: due reminders and "revisions ready" emails.
 * Each round is stamped before its email goes out (a conditional update on the
 * still-empty stamp), so two overlapping runs can never both send it.
 */
export async function runCubTickForOrg(organizationId: string, now: Date) {
  const db = tenantDb(organizationId);
  const rounds = await db.calendarCubRound.findMany({
    where: { OR: [{ deadlineNotifiedAt: null }, { reminderSentAt: null, dueAt: { gt: now } }] },
    select: { id: true, createdAt: true, dueAt: true, closedAt: true, requestSentAt: true, reminderSentAt: true, deadlineNotifiedAt: true },
    take: 500,
  });
  const plan = planCubTick(rounds, now);
  const counts = { reminders: 0, completions: 0, skipped: 0, failed: 0 };

  for (const id of plan.skipReminder) {
    const claimed = await db.calendarCubRound.updateMany({ where: { id, reminderSentAt: null }, data: { reminderSentAt: now } });
    if (claimed.count) counts.skipped += 1;
  }

  for (const id of plan.remind) {
    const claimed = await db.calendarCubRound.updateMany({ where: { id, reminderSentAt: null }, data: { reminderSentAt: now } });
    if (!claimed.count) continue;
    const found = await roundFor(organizationId, id);
    if (!found) continue;
    const { round, brandName } = found;
    const tpl = await loadTemplate(organizationId, round.brandId, "cub-reminder");
    if (!tpl.enabled) {
      counts.skipped += 1;
      continue;
    }
    const values = cubMergeValues({ promoName: round.promoName, brandName, initiatorName: round.initiatorName, deadline: formatDeadline(round.dueAt), reviewLink: links(round).review, instructions: round.instructions });
    const sent = await deliver({
      organizationId,
      brandId: round.brandId,
      roundId: round.id,
      kind: "cub-reminder",
      to: round.reviewerEmails,
      subject: renderMerge(tpl.subject, values),
      text: renderMerge(tpl.body, values),
      attachment: draftAttachment(round),
    });
    if (sent.status === "failed") counts.failed += 1;
    else counts.reminders += 1;
  }

  for (const id of plan.complete) {
    const claimed = await db.calendarCubRound.updateMany({ where: { id, deadlineNotifiedAt: null }, data: { deadlineNotifiedAt: now } });
    if (!claimed.count) continue;
    const found = await roundFor(organizationId, id);
    if (!found) continue;
    const { round } = found;
    const tpl = await loadTemplate(organizationId, round.brandId, "cub-complete");
    if (tpl.enabled && round.initiatorEmail) {
      const submissionCount = await db.calendarCubReview.count({ where: { roundId: round.id } });
      const values = cubMergeValues({ promoName: round.promoName, ownerLink: links(round).owner, submissionCount });
      const sent = await deliver({
        organizationId,
        brandId: round.brandId,
        roundId: round.id,
        kind: "cub-complete",
        to: [round.initiatorEmail],
        subject: renderMerge(tpl.subject, values),
        text: renderMerge(tpl.body, values),
      });
      if (sent.status === "failed") counts.failed += 1;
      else counts.completions += 1;
    } else counts.skipped += 1;
    await appendOrgAudit(organizationId, { actorId: null, action: "calendar.cub.deadline_passed", targetType: "calendar_cub_round", targetId: round.id });
    await teachCubRound(organizationId, round.id);
  }
  return counts;
}
