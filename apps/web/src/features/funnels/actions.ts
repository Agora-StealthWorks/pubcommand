"use server";

import { can } from "@pubcommand/core";
import { appendOrgAudit, tenantDb, type Prisma } from "@pubcommand/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { starterBlocks } from "../../../../../modules/funnels/blocks";
import { checkFunnel, isValidSlug, newUnlockKey, normalizeSlug, parseResources } from "../../../../../modules/funnels/checks";
import { DEADLINE_PAGES, DEADLINE_TARGETS, normalizeDeadlineButtonUrl, normalizeDeadlinePages } from "../../../../../modules/funnels/deadline";
import { CLOSE_MODES, CTA_REVEALS, FUNNEL_MODES, LIVE_OVERRIDES, PROGRESSIONS, SITE_TYPES, TIMING_MODES } from "../../../../../modules/funnels/state";
import { isValidEmail } from "../../../../../modules/funnels/sms";
import { parseVideo } from "../../../../../modules/funnels/video";
import { teachFunnel } from "./brain";
import { UUID_RE, orgTimezone } from "./data";
import { bool, color, int, optional, optionalInt, pickOne, storeImage, text, url, zoned } from "./form-input";
import { funnelCheckInput, homeBlocks } from "./site-data";
import { funnelAction, funnelsAction, withMessage, type FunnelsCtx } from "./guard";
import { refreshVideoMeta } from "./oembed";
import { richFromInput } from "./sanitize";
import { ownSmsFormId } from "./sms-data";

function audit(ctx: FunnelsCtx, action: string, targetType: string, targetId: string, metadata?: Prisma.InputJsonValue) {
  return appendOrgAudit(ctx.resolved.id, { actorId: ctx.actorId, action, targetType, targetId, metadata });
}

async function ownFunnel(ctx: FunnelsCtx, funnelId: string) {
  const funnel = UUID_RE.test(funnelId) ? await tenantDb(ctx.resolved.id).funnel.findFirst({ where: { id: funnelId, brandId: ctx.brand.id, deletedAt: null } }) : null;
  if (!funnel) redirect(withMessage("/funnels", "error", "That funnel no longer exists."));
  return funnel;
}

async function uniqueSlug(organizationId: string, wanted: string, exceptId?: string): Promise<string> {
  const base = normalizeSlug(wanted) || "launch";
  const db = tenantDb(organizationId);
  let slug = base;
  for (let n = 2; await db.funnel.count({ where: { slug, ...(exceptId ? { id: { not: exceptId } } : {}) } }); n += 1) slug = `${base.slice(0, 55)}-${n}`;
  return slug;
}

function builder(funnelId: string, tab: string) {
  return `/funnels/${funnelId}?tab=${tab}`;
}

export async function createFunnel(formData: FormData) {
  const ctx = await funnelsAction("/funnels", "funnels.write");
  const db = tenantDb(ctx.resolved.id);
  const siteType = pickOne(formData, "siteType", SITE_TYPES, "launch");
  const name = text(formData, "name", 120) || (siteType === "microsite" ? "New microsite" : "New launch");
  const mode = pickOne(formData, "mode", FUNNEL_MODES, "evergreen");
  const dayCount = int(formData, "days", 3, siteType === "microsite" ? 0 : 1, 10);
  const themes = await db.formTheme.findMany({ where: { brandId: ctx.brand.id, deletedAt: null }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], select: { id: true }, take: 1 });
  const funnel = await db.funnel.create({
    data: {
      organizationId: ctx.resolved.id,
      brandId: ctx.brand.id,
      name,
      slug: await uniqueSlug(ctx.resolved.id, name),
      mode,
      siteType,
      homeBlocks: siteType === "microsite" ? (JSON.parse(JSON.stringify(starterBlocks(name))) as Prisma.InputJsonValue) : [],
      formThemeId: themes[0]?.id ?? null,
      companyName: ctx.brand.name,
      createdById: ctx.actorId,
    },
  });
  for (let position = 1; position <= dayCount; position += 1) {
    await db.funnelDay.create({
      data: { organizationId: ctx.resolved.id, funnelId: funnel.id, position, title: "", unlockKey: newUnlockKey(), unlockOffsetHours: (position - 1) * 24, isLive: mode === "live" },
    });
  }
  await audit(ctx, "funnels.funnel.created", "funnel", funnel.id);
  redirect(builder(funnel.id, "setup"));
}

/** Save one tab of the builder. Only the fields of that tab are touched. */
export async function saveFunnel(formData: FormData) {
  const funnelId = text(formData, "funnelId", 40);
  const section = text(formData, "section", 20);
  const back = builder(funnelId, section || "setup");
  const ctx = await funnelAction(back, funnelId, "funnels.write");
  const funnel = await ownFunnel(ctx, funnelId);
  const db = tenantDb(ctx.resolved.id);
  const timeZone = await orgTimezone(ctx.resolved.id);
  let data: Prisma.FunnelUpdateManyMutationInput = {};

  if (section === "setup") {
    const wantedSlug = normalizeSlug(text(formData, "slug", 80));
    if (!isValidSlug(wantedSlug)) redirect(withMessage(back, "error", "The link name must be lowercase letters, numbers and dashes."));
    const slug = await uniqueSlug(ctx.resolved.id, wantedSlug, funnel.id);
    const siteType = pickOne(formData, "siteType", SITE_TYPES, "launch");
    // Switching to a microsite with an empty home page starts it from the starter layout.
    const seedHome = siteType === "microsite" && homeBlocks(funnel).length === 0;
    data = {
      name: text(formData, "name", 120) || funnel.name,
      slug,
      siteType,
      ...(seedHome ? { homeBlocks: JSON.parse(JSON.stringify(starterBlocks(funnel.name))) as Prisma.InputJsonValue } : {}),
      mode: pickOne(formData, "mode", FUNNEL_MODES, "evergreen"),
      timing: pickOne(formData, "timing", TIMING_MODES, "fixed"),
      startAt: zoned(formData, "startAt", timeZone),
      endAt: zoned(formData, "endAt", timeZone),
      closeAfterHours: optionalInt(formData, "closeAfterHours", 1, 24 * 365),
      livestreamUrl: url(formData, "livestreamUrl"),
      progression: pickOne(formData, "progression", PROGRESSIONS, "all_open"),
      watchPercent: int(formData, "watchPercent", 80, 1, 100),
      buildMode: pickOne(formData, "buildMode", ["as_you_go", "prebuilt"] as const, "as_you_go"),
      brainSyncEnabled: bool(formData, "brainSyncEnabled"),
    };
  } else if (section === "waitlist") {
    const optinMode = pickOne(formData, "optinMode", ["none", "email", "form", "sms"] as const, "none");
    const formSlug = text(formData, "optinFormSlug", 80);
    const form = optinMode === "form" && formSlug ? await db.form.findFirst({ where: { slug: formSlug, brandId: ctx.brand.id, deletedAt: null }, select: { slug: true } }) : null;
    const smsFormId = optinMode === "sms" ? await ownSmsFormId(ctx.resolved.id, funnel.id, text(formData, "optinSmsFormId", 40)) : null;
    if (optinMode === "sms" && !smsFormId) redirect(withMessage(back, "error", "Pick one of this funnel's SMS forms (SMS forms tab)."));
    data = {
      optinSmsFormId: smsFormId,
      waitlistEnabled: bool(formData, "waitlistEnabled"),
      waitlistHeadline: text(formData, "waitlistHeadline", 160),
      waitlistSubheadline: text(formData, "waitlistSubheadline", 400),
      agendaTitle: text(formData, "agendaTitle", 120) || "Agenda",
      optinMode,
      optinFormSlug: form?.slug ?? null,
      optinHeadline: text(formData, "optinHeadline", 160),
      optinButtonText: text(formData, "optinButtonText", 40) || "Remind me",
    };
  } else if (section === "hosts") {
    data = { hostsEnabled: bool(formData, "hostsEnabled"), hostsTitle: text(formData, "hostsTitle", 120) || "Meet your hosts" };
  } else if (section === "deadline") {
    data = {
      deadlineBarEnabled: bool(formData, "deadlineBarEnabled"),
      deadlineBarTarget: pickOne(formData, "deadlineBarTarget", DEADLINE_TARGETS, "end"),
      deadlineBarAt: zoned(formData, "deadlineBarAt", timeZone),
      deadlineBarPosition: pickOne(formData, "deadlineBarPosition", ["top", "bottom"] as const, "bottom"),
      deadlineBarSticky: bool(formData, "deadlineBarSticky"),
      deadlineBarText: text(formData, "deadlineBarText", 200) || "This offer ends in",
      deadlineBarBg: color(formData, "deadlineBarBg", "#b42318"),
      deadlineBarColor: color(formData, "deadlineBarColor", "#ffffff"),
      deadlineBarWithinHours: int(formData, "deadlineBarWithinHours", 0, 0, 24 * 60),
      deadlineBarPages: normalizeDeadlinePages(formData.getAll("deadlineBarPages").map(String)).filter((page) => (DEADLINE_PAGES as readonly string[]).includes(page)),
      deadlineBarButtonText: text(formData, "deadlineBarButtonText", 40),
      deadlineBarButtonUrl: normalizeDeadlineButtonUrl(text(formData, "deadlineBarButtonUrl", 500)),
      deadlineBarDismiss: bool(formData, "deadlineBarDismiss"),
    };
    if (data.deadlineBarButtonText && !data.deadlineBarButtonUrl) redirect(withMessage(back, "error", "The bar button needs a web address (https://…) or a module (module:1)."));
  } else if (section === "emails") {
    const replyTo = text(formData, "emailReplyTo", 254).toLowerCase();
    if (replyTo && !isValidEmail(replyTo)) redirect(withMessage(back, "error", "The reply-to address is not a valid email."));
    data = { emailFromName: text(formData, "emailFromName", 80), emailReplyTo: replyTo || null };
  } else if (section === "advanced") {
    // Header/footer code runs on public pages: funnels.publish only, never delegates.
    if (!can(ctx.subject, "funnels.publish", ctx.scope)) redirect(withMessage(back, "error", "Header and footer code need the funnels.publish permission."));
    const favicon = await storeImage(ctx.resolved.id, funnel.id, "favicon", formData.get("favicon"));
    if (favicon && "error" in favicon) redirect(withMessage(back, "error", favicon.error));
    const faviconUrl = text(formData, "faviconUrl", 1000);
    if (faviconUrl && !/^https:\/\/[^\s"<>]+$/i.test(faviconUrl)) redirect(withMessage(back, "error", "The favicon link must start with https://."));
    data = {
      faviconUrl: faviconUrl || null,
      ...(favicon && "id" in favicon ? { faviconAssetId: favicon.id } : bool(formData, "removeFavicon") ? { faviconAssetId: null } : {}),
      headCode: String(formData.get("headCode") ?? "").slice(0, 50_000),
      footerCode: String(formData.get("footerCode") ?? "").slice(0, 50_000),
    };
  } else if (section === "close") {
    data = {
      closeMode: pickOne(formData, "closeMode", CLOSE_MODES, "page"),
      closeHeadline: text(formData, "closeHeadline", 160) || "This event has closed",
      closeMessageHtml: richFromInput(text(formData, "closeMessageHtml", 20_000)),
      closeButtonText: optional(formData, "closeButtonText", 60),
      closeButtonUrl: url(formData, "closeButtonUrl"),
      closeRedirectUrl: url(formData, "closeRedirectUrl"),
      lockedTitle: text(formData, "lockedTitle", 120) || "This video is locked",
      lockedScheduledMsg: text(formData, "lockedScheduledMsg", 300),
      lockedWatchMsg: text(formData, "lockedWatchMsg", 300),
      lockedKeyMsg: text(formData, "lockedKeyMsg", 300),
      lockedLiveMsg: text(formData, "lockedLiveMsg", 300),
      comingSoonTitle: text(formData, "comingSoonTitle", 120) || "Coming soon",
      comingSoonMessage: text(formData, "comingSoonMessage", 300),
      replayPendingTitle: text(formData, "replayPendingTitle", 120) || "The replay is on its way",
      replayPendingMessage: text(formData, "replayPendingMessage", 300),
      liveHeadline: text(formData, "liveHeadline", 120) || "We're live!",
      liveSubheadline: text(formData, "liveSubheadline", 200),
      nextButtonText: text(formData, "nextButtonText", 60) || "Watch the next day",
    };
  } else {
    redirect(withMessage(back, "error", "Unknown section."));
  }

  await db.funnel.updateMany({ where: { id: funnel.id }, data });
  await audit(ctx, section === "advanced" ? "funnels.code.updated" : "funnels.funnel.updated", "funnel", funnel.id, { section, ...(section === "advanced" ? { headCodeLength: String(formData.get("headCode") ?? "").length, footerCodeLength: String(formData.get("footerCode") ?? "").length } : {}) });
  if (funnel.status === "published") after(() => teachFunnel({ organizationId: ctx.resolved.id, funnelId: funnel.id, actorId: ctx.actorId }));
  redirect(withMessage(back, "notice", "Saved."));
}

export async function addDay(formData: FormData) {
  const funnelId = text(formData, "funnelId", 40);
  const ctx = await funnelAction(builder(funnelId, "days"), funnelId, "funnels.write");
  const funnel = await ownFunnel(ctx, funnelId);
  const db = tenantDb(ctx.resolved.id);
  const count = await db.funnelDay.count({ where: { funnelId: funnel.id } });
  if (count >= 30) redirect(withMessage(builder(funnel.id, "days"), "error", "A funnel can have at most 30 days."));
  const day = await db.funnelDay.create({
    data: { organizationId: ctx.resolved.id, funnelId: funnel.id, position: count + 1, unlockKey: newUnlockKey(), unlockOffsetHours: count * 24, isLive: funnel.mode === "live" },
  });
  await audit(ctx, "funnels.day.created", "funnel_day", day.id);
  redirect(`${builder(funnel.id, "days")}&day=${day.id}#day-${day.id}`);
}

export async function saveDay(formData: FormData) {
  const funnelId = text(formData, "funnelId", 40);
  const dayId = text(formData, "dayId", 40);
  const back = `${builder(funnelId, "days")}&day=${dayId}`;
  const ctx = await funnelAction(back, funnelId, "funnels.write");
  const funnel = await ownFunnel(ctx, funnelId);
  const db = tenantDb(ctx.resolved.id);
  const day = UUID_RE.test(dayId) ? await db.funnelDay.findFirst({ where: { id: dayId, funnelId: funnel.id } }) : null;
  if (!day) redirect(withMessage(builder(funnel.id, "days"), "error", "That day no longer exists."));
  const timeZone = await orgTimezone(ctx.resolved.id);
  const videoInput = text(formData, "video", 500);
  const video = parseVideo(videoInput, text(formData, "videoProvider", 10) || null);
  if (videoInput && !video) redirect(withMessage(back, "error", "That is not a Wistia or YouTube link or id."));
  const thumb = await storeImage(ctx.resolved.id, funnel.id, "thumb", formData.get("thumb"));
  if (thumb && "error" in thumb) redirect(withMessage(back, "error", thumb.error));
  const videoChanged = (video?.id ?? null) !== day.videoId;
  const unlockKey = normalizeSlug(text(formData, "unlockKey", 40), 40) || day.unlockKey || newUnlockKey();
  await db.funnelDay.updateMany({
    where: { id: day.id },
    data: {
      title: text(formData, "title", 160),
      navLabel: optional(formData, "navLabel", 40),
      topics: text(formData, "topics", 2000)
        .split("\n")
        .map((line) => line.replace(/^[-*•]\s*/, "").trim())
        .filter(Boolean)
        .slice(0, 12),
      bodyHtml: richFromInput(text(formData, "bodyHtml", 50_000)),
      videoProvider: video?.provider ?? null,
      videoId: video?.id ?? null,
      ...(videoChanged ? { videoTitle: null, videoThumbUrl: null, videoDuration: null } : {}),
      thumbUrl: url(formData, "thumbUrl"),
      ...(thumb && "id" in thumb ? { thumbAssetId: thumb.id } : bool(formData, "removeThumb") ? { thumbAssetId: null } : {}),
      unlockOffsetHours: int(formData, "unlockOffsetHours", 0, 0, 24 * 365),
      unlockAt: zoned(formData, "unlockAt", timeZone),
      unlockKey,
      isLive: bool(formData, "isLive"),
      liveStartAt: zoned(formData, "liveStartAt", timeZone),
      liveEndAt: zoned(formData, "liveEndAt", timeZone),
      liveUrl: url(formData, "liveUrl"),
      liveOverride: pickOne(formData, "liveOverride", LIVE_OVERRIDES, "auto"),
      resourcesHeading: text(formData, "resourcesHeading", 80) || "Resources",
      resources: parseResources(text(formData, "resources", 5000)) as unknown as Prisma.InputJsonValue,
      ctaReveal: pickOne(formData, "ctaReveal", CTA_REVEALS, "none"),
      ctaText: text(formData, "ctaText", 80),
      ctaUrl: url(formData, "ctaUrl") ?? "",
      ctaSeconds: int(formData, "ctaSeconds", 0, 0, 60 * 60 * 6),
      ctaAt: zoned(formData, "ctaAt", timeZone),
      ctaSubtext: text(formData, "ctaSubtext", 200),
      smsFormId: await ownSmsFormId(ctx.resolved.id, funnel.id, text(formData, "smsFormId", 40)),
    },
  });
  await db.funnel.updateMany({ where: { id: funnel.id }, data: { updatedAt: new Date() } });
  await audit(ctx, "funnels.day.updated", "funnel_day", day.id);
  if (video && (videoChanged || !day.videoThumbUrl)) after(() => refreshVideoMeta(ctx.resolved.id, day.id, video));
  redirect(withMessage(`${back}#day-${day.id}`, "notice", `Day ${day.position} saved.`));
}

async function renumber(organizationId: string, funnelId: string, orderedIds: string[]) {
  const db = tenantDb(organizationId);
  // Two passes so the positions never collide mid-way.
  for (const [index, id] of orderedIds.entries()) await db.funnelDay.updateMany({ where: { id, funnelId }, data: { position: 1000 + index } });
  for (const [index, id] of orderedIds.entries()) await db.funnelDay.updateMany({ where: { id, funnelId }, data: { position: index + 1 } });
}

export async function moveDay(formData: FormData) {
  const funnelId = text(formData, "funnelId", 40);
  const ctx = await funnelAction(builder(funnelId, "days"), funnelId, "funnels.write");
  const funnel = await ownFunnel(ctx, funnelId);
  const dayId = text(formData, "dayId", 40);
  const direction = text(formData, "direction", 6) === "up" ? -1 : 1;
  const days = await tenantDb(ctx.resolved.id).funnelDay.findMany({ where: { funnelId: funnel.id }, orderBy: { position: "asc" }, select: { id: true } });
  const ids = days.map((day) => day.id);
  const index = ids.indexOf(dayId);
  const target = index + direction;
  if (index >= 0 && target >= 0 && target < ids.length) {
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    await renumber(ctx.resolved.id, funnel.id, ids);
    await audit(ctx, "funnels.day.moved", "funnel_day", dayId);
  }
  redirect(builder(funnel.id, "days"));
}

export async function deleteDay(formData: FormData) {
  const funnelId = text(formData, "funnelId", 40);
  const ctx = await funnelAction(builder(funnelId, "days"), funnelId, "funnels.write");
  const funnel = await ownFunnel(ctx, funnelId);
  const dayId = text(formData, "dayId", 40);
  const db = tenantDb(ctx.resolved.id);
  if (!UUID_RE.test(dayId)) redirect(builder(funnel.id, "days"));
  const removed = await db.funnelDay.deleteMany({ where: { id: dayId, funnelId: funnel.id } });
  if (removed.count) {
    const rest = await db.funnelDay.findMany({ where: { funnelId: funnel.id }, orderBy: { position: "asc" }, select: { id: true } });
    await renumber(ctx.resolved.id, funnel.id, rest.map((day) => day.id));
    await audit(ctx, "funnels.day.deleted", "funnel_day", dayId);
  }
  redirect(withMessage(builder(funnel.id, "days"), "notice", "Day removed."));
}

export async function publishFunnel(formData: FormData) {
  const funnelId = text(formData, "funnelId", 40);
  const back = builder(funnelId, "publish");
  const ctx = await funnelsAction(back, "funnels.publish");
  const funnel = await ownFunnel(ctx, funnelId);
  const db = tenantDb(ctx.resolved.id);
  const intent = text(formData, "intent", 20);
  if (intent === "unpublish") {
    await db.funnel.updateMany({ where: { id: funnel.id }, data: { status: "draft" } });
    await audit(ctx, "funnels.funnel.unpublished", "funnel", funnel.id);
    redirect(withMessage(back, "notice", "Unpublished. The public link now shows “not found”."));
  }
  const [days, navItems] = await Promise.all([
    db.funnelDay.findMany({ where: { funnelId: funnel.id }, orderBy: { position: "asc" } }),
    db.funnelNavItem.findMany({ where: { funnelId: funnel.id }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] }),
  ]);
  const branding = funnel.formThemeId ? await db.formTheme.findFirst({ where: { id: funnel.formThemeId, deletedAt: null }, select: { privacyPolicyUrl: true } }) : null;
  const result = checkFunnel(funnelCheckInput(funnel, days, navItems, branding?.privacyPolicyUrl ?? null));
  if (result.errors.length) redirect(withMessage(back, "error", `Fix ${result.errors.length === 1 ? "this" : "these"} first: ${result.errors.join(" ")}`));
  await db.funnel.updateMany({ where: { id: funnel.id }, data: { status: "published", publishedAt: funnel.publishedAt ?? new Date() } });
  await audit(ctx, "funnels.funnel.published", "funnel", funnel.id);
  after(() => teachFunnel({ organizationId: ctx.resolved.id, funnelId: funnel.id, actorId: ctx.actorId }));
  redirect(withMessage(back, "notice", "Published. The public link is live."));
}

export async function deleteFunnel(formData: FormData) {
  const funnelId = text(formData, "funnelId", 40);
  const ctx = await funnelsAction(builder(funnelId, "publish"), "funnels.publish");
  const funnel = await ownFunnel(ctx, funnelId);
  if (text(formData, "confirm", 200) !== funnel.name) redirect(withMessage(builder(funnel.id, "publish"), "error", "Type the funnel name exactly to delete it."));
  await tenantDb(ctx.resolved.id).funnel.updateMany({ where: { id: funnel.id }, data: { deletedAt: new Date(), status: "archived", slug: `${funnel.slug.slice(0, 40)}-deleted-${Date.now().toString(36)}` } });
  await audit(ctx, "funnels.funnel.deleted", "funnel", funnel.id);
  redirect(withMessage("/funnels", "notice", "Funnel deleted."));
}

export async function refreshFunnelBrain(formData: FormData) {
  const funnelId = text(formData, "funnelId", 40);
  const ctx = await funnelAction(`/funnels/${funnelId}/stats`, funnelId, "funnels.write");
  const funnel = await ownFunnel(ctx, funnelId);
  if (funnel.status !== "published") redirect(withMessage(`/funnels/${funnel.id}/stats`, "error", "Publish the funnel first."));
  await teachFunnel({ organizationId: ctx.resolved.id, funnelId: funnel.id, actorId: ctx.actorId });
  redirect(withMessage(`/funnels/${funnel.id}/stats`, "notice", "The brand Brain has the latest figures."));
}
