"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { currentRequest } from "@/lib/request";
import { runAiPreReview } from "./ai";
import { testimonialsAction, withMessage } from "./guard";
import {
  checkUpload,
  createCaptureLink,
  createTestimonial,
  deleteFile,
  deleteTestimonial,
  deleteView,
  reviewTestimonial,
  saveView,
  setCaptureLinkActive,
  submitPublicTestimonial,
  toUpload,
  updateTestimonial,
  type UploadFile,
} from "./server";
import { isUuid, parseTestimonialInput, staffConsent } from "../../../../../modules/testimonials/testimonials";

function text(formData: FormData, key: string, max = 2000): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function uploads(formData: FormData, back: string): Promise<UploadFile[]> {
  const out: UploadFile[] = [];
  for (const kind of ["photo", "screenshot"] as const) {
    const checked = checkUpload(formData.get(kind));
    if (!checked) continue;
    if (!checked.ok) redirect(withMessage(back, "error", checked.error));
    out.push(await toUpload(kind, checked.file));
  }
  return out;
}

export async function createTestimonialAction(formData: FormData) {
  const back = "/testimonials/new";
  const ctx = await testimonialsAction("testimonials.write", back);
  const parsed = parseTestimonialInput(formData);
  if (!parsed.ok) redirect(withMessage(back, "error", parsed.error));
  const files = await uploads(formData, back);
  const consent = staffConsent(formData.get("consent") === "yes", text(formData, "consentNote", 500), new Date());
  const created = await createTestimonial({ organizationId: ctx.resolved.id, brand: ctx.brand, values: parsed.values, consent, source: "manual", actorId: ctx.actorId, files });
  after(() => runAiPreReview(ctx.resolved.id, ctx.brand, created.id, ctx.actorId));
  redirect(withMessage(`/testimonials/${created.id}`, "notice", "Saved. It is pending review."));
}

export async function updateTestimonialAction(formData: FormData) {
  const id = text(formData, "id", 40);
  const back = `/testimonials/${id}`;
  const ctx = await testimonialsAction("testimonials.write", back);
  if (!isUuid(id)) redirect("/testimonials");
  const parsed = parseTestimonialInput(formData);
  if (!parsed.ok) redirect(withMessage(back, "error", parsed.error));
  const files = await uploads(formData, back);
  // Consent is only changed when staff record it here; a public-form consent is never overwritten.
  const consent = formData.get("recordConsent") === "yes" ? staffConsent(formData.get("consent") === "yes", text(formData, "consentNote", 500), new Date()) : null;
  const result = await updateTestimonial({ organizationId: ctx.resolved.id, brand: ctx.brand, id, values: parsed.values, consent, actorId: ctx.actorId, files });
  if (!result.ok) redirect(withMessage("/testimonials", "error", "That testimonial is gone."));
  after(() => runAiPreReview(ctx.resolved.id, ctx.brand, id, ctx.actorId));
  redirect(withMessage(back, "notice", result.reopened ? "Saved. The words changed, so it is back in review and off the wiki." : "Saved."));
}

export async function approveTestimonialAction(formData: FormData) {
  await review(formData, "approved");
}

export async function rejectTestimonialAction(formData: FormData) {
  await review(formData, "rejected");
}

export async function reopenTestimonialAction(formData: FormData) {
  await review(formData, "pending");
}

async function review(formData: FormData, decision: "approved" | "rejected" | "pending") {
  const id = text(formData, "id", 40);
  const back = `/testimonials/${id}`;
  const ctx = await testimonialsAction("testimonials.approve", back);
  if (!isUuid(id)) redirect("/testimonials");
  const result = await reviewTestimonial({
    organizationId: ctx.resolved.id,
    brand: ctx.brand,
    id,
    decision,
    reason: text(formData, "reason", 1000) || null,
    disclosure: text(formData, "disclosure", 500) || null,
    acknowledged: formData.get("acknowledged") === "yes",
    actorId: ctx.actorId,
  });
  if (!result.ok) redirect(withMessage(back, "error", result.error));
  const label = decision === "approved" ? "Approved. It now shows in the wiki." : decision === "rejected" ? "Rejected." : "Back in review.";
  redirect(withMessage(back, "notice", label));
}

export async function aiCheckAction(formData: FormData) {
  const id = text(formData, "id", 40);
  const back = `/testimonials/${id}`;
  const ctx = await testimonialsAction("testimonials.write", back);
  if (!isUuid(id)) redirect("/testimonials");
  after(() => runAiPreReview(ctx.resolved.id, ctx.brand, id, ctx.actorId));
  redirect(withMessage(back, "notice", "AI check started."));
}

export async function deleteTestimonialAction(formData: FormData) {
  const id = text(formData, "id", 40);
  const ctx = await testimonialsAction("testimonials.write", `/testimonials/${id}`);
  if (!isUuid(id)) redirect("/testimonials");
  if (text(formData, "confirm", 10) !== "yes") redirect(withMessage(`/testimonials/${id}`, "error", "Tick the box to confirm."));
  await deleteTestimonial(ctx.resolved.id, ctx.brand.id, id, ctx.actorId);
  redirect(withMessage("/testimonials", "notice", "Deleted."));
}

export async function deleteFileAction(formData: FormData) {
  const id = text(formData, "id", 40);
  const back = `/testimonials/${id}`;
  const ctx = await testimonialsAction("testimonials.write", back);
  await deleteFile(ctx.resolved.id, ctx.brand.id, id, text(formData, "fileId", 40), ctx.actorId);
  redirect(withMessage(back, "notice", "File removed."));
}

export async function saveViewAction(formData: FormData) {
  const query = text(formData, "query", 1000);
  const back = `/testimonials${query ? `?${query}` : ""}`;
  const ctx = await testimonialsAction("testimonials.write", back);
  const view = await saveView(ctx.resolved.id, ctx.brand.id, text(formData, "name", 80), query, ctx.actorId);
  if (!view) redirect(withMessage(back, "error", "Name the view."));
  redirect(withMessage(back, "notice", "View saved."));
}

export async function deleteViewAction(formData: FormData) {
  const ctx = await testimonialsAction("testimonials.write");
  await deleteView(ctx.resolved.id, ctx.brand.id, text(formData, "viewId", 40), ctx.actorId);
  redirect(withMessage("/testimonials", "notice", "View removed."));
}

export async function createCaptureLinkAction(formData: FormData) {
  const back = "/testimonials/capture";
  const ctx = await testimonialsAction("testimonials.approve", back);
  await createCaptureLink({
    organizationId: ctx.resolved.id,
    brand: ctx.brand,
    title: text(formData, "title", 120),
    intro: text(formData, "intro", 1000),
    consentText: text(formData, "consentText", 1500),
    publicationId: text(formData, "publicationId", 40) || null,
    actorId: ctx.actorId,
  });
  redirect(withMessage(back, "notice", "Link created. Share it with readers."));
}

export async function toggleCaptureLinkAction(formData: FormData) {
  const back = "/testimonials/capture";
  const ctx = await testimonialsAction("testimonials.approve", back);
  await setCaptureLinkActive(ctx.resolved.id, ctx.brand.id, text(formData, "linkId", 40), formData.get("active") === "yes", ctx.actorId);
  redirect(withMessage(back, "notice", formData.get("active") === "yes" ? "Link reopened." : "Link closed. It no longer accepts submissions."));
}

/** The public "share your story" form. No sign-in: the token and the host decide the brand. */
export async function submitPublicTestimonialAction(formData: FormData) {
  const request = await currentRequest();
  if (request.site.kind !== "org") redirect("/");
  const token = text(formData, "token", 60);
  const back = `/p/testimonial/${token}`;
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || h.get("x-real-ip") || null;
  const result = await submitPublicTestimonial({ orgSlug: request.site.slug, token, form: formData, ip });
  if (!result.ok) redirect(withMessage(back, "error", result.error));
  if (result.id) after(() => runAiPreReview(result.organizationId, result.brand, result.id, null));
  redirect(`${back}?done=1`);
}
