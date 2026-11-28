"use server";

import { PLATFORM_PERMISSIONS, platformCan } from "@pubcommand/core";
import { appendPlatformAudit } from "@pubcommand/db";
import { redirect } from "next/navigation";
import { APP_CARD_IMAGE_MAX_BYTES, loadAppCardSettings, saveAppCard, saveAppCardOrder, sniffCardImage } from "@/features/app-cards/store";
import { cardableApps, sortByCardPosition } from "@/lib/apps";
import { readSession, readStaff, staffReady } from "@/lib/auth";

/** Admin → App cards: which apps have a dashboard card, their names, artwork and order. */

async function cardStaff() {
  const auth = await readSession();
  if (!auth.user || !auth.session?.mfaVerified) redirect("/2fa");
  const staff = await readStaff(auth.user.id);
  if (!staff || !staffReady(staff, auth.session) || !platformCan(staff.role, PLATFORM_PERMISSIONS.manageModules)) {
    redirect("/?error=You do not have permission.");
  }
  return { auth, staff };
}

function back(flash: { error?: string; notice?: string }, moduleId?: string): never {
  const params = new URLSearchParams();
  if (flash.error) params.set("error", flash.error);
  if (flash.notice) params.set("notice", flash.notice);
  redirect(`/app-cards?${params.toString()}${moduleId ? `#card-${moduleId}` : ""}`);
}

function readApp(formData: FormData) {
  const moduleId = String(formData.get("moduleId") ?? "");
  const app = cardableApps().find((item) => item.moduleId === moduleId);
  if (!app) back({ error: "Unknown app." });
  return app;
}

async function audit(actorId: string, moduleId: string, action: string, metadata: Record<string, string | boolean | number | null> = {}) {
  await appendPlatformAudit({ actorId, action, targetType: "app_card", targetId: moduleId, metadata });
}

export async function saveAppCardDetails(formData: FormData) {
  const { auth } = await cardStaff();
  const app = readApp(formData);
  const name = String(formData.get("name") ?? "").replace(/\s+/g, " ").trim();
  if (name.length > 60) back({ error: "Card names can be 60 characters at most." }, app.moduleId);
  const onDashboard = formData.get("onDashboard") === "on";
  await saveAppCard({ moduleId: app.moduleId, actorId: auth.user.id, data: { name: name && name !== app.name ? name : null, onDashboard } });
  await audit(auth.user.id, app.moduleId, "app_card.updated", { onDashboard, renamed: Boolean(name && name !== app.name) });
  back({ notice: `${name || app.name} saved. ${onDashboard ? "It shows on the dashboard of every organization that has the app." : "It is off the dashboards."}` }, app.moduleId);
}

export async function uploadAppCardImage(formData: FormData) {
  const { auth } = await cardStaff();
  const app = readApp(formData);
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) back({ error: "Choose an image to upload." }, app.moduleId);
  if (file.size > APP_CARD_IMAGE_MAX_BYTES) back({ error: "Card images can be 2 MB at most." }, app.moduleId);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffCardImage(bytes);
  if (!mime) back({ error: "Upload a PNG, JPEG or WebP image." }, app.moduleId);
  await saveAppCard({ moduleId: app.moduleId, actorId: auth.user.id, data: { imageMime: mime, imageData: bytes } });
  await audit(auth.user.id, app.moduleId, "app_card.image_uploaded", { mime, bytes: bytes.length });
  back({ notice: `New card image for ${app.name} saved.` }, app.moduleId);
}

export async function removeAppCardImage(formData: FormData) {
  const { auth } = await cardStaff();
  const app = readApp(formData);
  await saveAppCard({ moduleId: app.moduleId, actorId: auth.user.id, data: { imageMime: null, imageData: null } });
  await audit(auth.user.id, app.moduleId, "app_card.image_removed");
  back({ notice: `${app.name} is back to its default card image.` }, app.moduleId);
}

export async function moveAppCard(formData: FormData) {
  const { auth } = await cardStaff();
  const app = readApp(formData);
  const direction = String(formData.get("direction") ?? "");
  const settings = await loadAppCardSettings();
  const order = sortByCardPosition(cardableApps(), settings).map((item) => item.moduleId);
  const index = order.indexOf(app.moduleId);
  const target = direction === "up" ? index - 1 : direction === "down" ? index + 1 : -1;
  if (index === -1 || target < 0 || target >= order.length) back({}, app.moduleId);
  [order[index], order[target]] = [order[target]!, order[index]!];
  await saveAppCardOrder({ moduleIds: order, actorId: auth.user.id });
  await audit(auth.user.id, app.moduleId, "app_card.moved", { direction, position: target });
  back({}, app.moduleId);
}
