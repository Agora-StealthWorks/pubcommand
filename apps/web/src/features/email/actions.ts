"use server";

import { can } from "@pubcommand/core";
import { tenantDb } from "@pubcommand/db";
import { redirect } from "next/navigation";
import { canManagePublications } from "@/features/pubsetup/module";
import { getOrgContext } from "@/lib/org";
import { currentRequest } from "@/lib/request";
import { connectResendKey, removeResendKey, saveDefaultSender, saveSender, sendTestEmail } from "./org-email";

const EMAIL_HREF = "/settings/email";

function back(href: string, kind: "error" | "notice", message: string, hash = ""): never {
  redirect(`${href}${href.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}${hash}`);
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length < 200 ? error.message : fallback;
}

async function orgContext() {
  const request = await currentRequest();
  if (request.site.kind !== "org") redirect("/");
  const ctx = await getOrgContext(request.site.slug);
  if (ctx.kind === "anonymous") redirect(`/login?next=${encodeURIComponent(request.pathname)}`);
  if (ctx.kind !== "ok") redirect("/?error=You do not have access to that organization.");
  return ctx;
}

/** Org admins (settings.manage). Connecting or removing the key is refused while viewing as someone else. */
async function settingsContext(options: { keyChange?: boolean } = {}) {
  const ctx = await orgContext();
  if (!can(ctx.subject, "settings.manage", { organizationId: ctx.resolved.id, brandId: null })) back(EMAIL_HREF, "error", "You do not have permission.");
  if (options.keyChange && ctx.impersonatingHere) back(EMAIL_HREF, "error", "Stop viewing as someone else before changing the email connection.");
  return ctx;
}

export async function connectResendKeyAction(formData: FormData) {
  const ctx = await settingsContext({ keyChange: true });
  try {
    await connectResendKey(ctx.resolved.id, ctx.auth.user.id, String(formData.get("apiKey") ?? ""));
  } catch (error) {
    back(EMAIL_HREF, "error", message(error, "Could not save the key."));
  }
  back(EMAIL_HREF, "notice", "Resend connected. Send a test email to check it.");
}

export async function removeResendKeyAction() {
  const ctx = await settingsContext({ keyChange: true });
  await removeResendKey(ctx.resolved.id, ctx.auth.user.id);
  back(EMAIL_HREF, "notice", "Resend key removed. Emails now go through PubCommand's address.");
}

export async function saveDefaultSenderAction(formData: FormData) {
  const ctx = await settingsContext();
  try {
    await saveDefaultSender(ctx.resolved.id, ctx.auth.user.id, {
      fromName: String(formData.get("fromName") ?? ""),
      fromAddress: String(formData.get("fromAddress") ?? ""),
      replyTo: String(formData.get("replyTo") ?? ""),
    });
  } catch (error) {
    back(EMAIL_HREF, "error", message(error, "Could not save the sender."));
  }
  back(EMAIL_HREF, "notice", "Default sender saved.");
}

export async function sendTestEmailAction() {
  const ctx = await settingsContext();
  const result = await sendTestEmail({ organizationId: ctx.resolved.id, organizationName: ctx.resolved.name, actorId: ctx.auth.user.id, to: ctx.auth.user.email });
  if (result.status === "sent") back(EMAIL_HREF, "notice", `Test email sent to ${ctx.auth.user.email}.`);
  back(EMAIL_HREF, "error", result.status === "failed" ? `Resend refused it: ${result.reason}` : "Not sent.");
}

function senderFields(formData: FormData) {
  return {
    fromName: String(formData.get("fromName") ?? ""),
    fromAddress: String(formData.get("fromAddress") ?? ""),
    replyTo: String(formData.get("replyTo") ?? ""),
  };
}

/** Settings → Brands → a brand's email sender. */
export async function saveBrandSenderAction(formData: FormData) {
  const ctx = await settingsContext();
  const brandId = String(formData.get("brandId") ?? "");
  const href = "/settings/brands";
  if (!ctx.brands.some((brand) => brand.id === brandId)) back(href, "error", "Unknown brand.");
  try {
    await saveSender(ctx.resolved.id, ctx.auth.user.id, "brand", brandId, senderFields(formData));
  } catch (error) {
    back(href, "error", message(error, "Could not save the sender."));
  }
  back(href, "notice", "Brand email sender saved.");
}

/** Publication Setup → a publication's email sender (optional). */
export async function savePublicationSenderAction(formData: FormData) {
  const ctx = await orgContext();
  const publicationId = String(formData.get("publicationId") ?? "");
  const href = /^[0-9a-f-]{36}$/i.test(publicationId) ? `/settings/publication-setup/publications/${publicationId}` : "/settings/publication-setup";
  const publication = /^[0-9a-f-]{36}$/i.test(publicationId)
    ? await tenantDb(ctx.resolved.id).calendarPublication.findFirst({ where: { id: publicationId }, select: { id: true, brandId: true } })
    : null;
  if (!publication) back("/settings/publication-setup", "error", "Unknown publication.");
  if (!canManagePublications(ctx.subject, { organizationId: ctx.resolved.id, brandId: publication.brandId })) back(href, "error", "You do not have permission.");
  try {
    await saveSender(ctx.resolved.id, ctx.auth.user.id, "publication", publication.id, senderFields(formData));
  } catch (error) {
    back(href, "error", message(error, "Could not save the sender."), "#email-sender");
  }
  back(href, "notice", "Email sender saved.", "#email-sender");
}
