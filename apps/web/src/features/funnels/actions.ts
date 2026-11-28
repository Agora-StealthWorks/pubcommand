"use server";

import { can } from "@pubcommand/core";
import { appendOrgAudit, tenantDb, type Prisma } from "@pubcommand/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { starterBlocks } from "../../../../../modules/funnels/blocks";
import { isPreset, presetBasics, presetColumns, presetDayResources, presetOfferBlocks } from "../../../../../modules/funnels/presets";
import { NEW_FUNNEL_COLUMNS, NEW_FUNNEL_DESIGN } from "../../../../../modules/funnels/design";
import { checkFunnel, isValidSlug, newUnlockKey, normalizeSlug } from "../../../../../modules/funnels/checks";
import { DEADLINE_PAGES, DEADLINE_POSITIONS, DEADLINE_TARGETS, normalizeDeadlineButtonUrl, normalizeDeadlinePages } from "../../../../../modules/funnels/deadline";
import { BETWEEN_SESSIONS, CLOSE_MODES, CTA_REVEALS, FUNNEL_MODES, LIVE_OVERRIDES, PROGRESSIONS, SITE_TYPES, TIMING_MODES } from "../../../../../modules/funnels/state";
import { parseReminders } from "../../../../../modules/funnels/calendar";
import { linkItemsFromForm } from "../../../../../modules/funnels/links";
import { isValidEmail } from "../../../../../modules/funnels/sms";
import { PROVIDER_LABELS, VIDEO_PROVIDERS, oembedUrl, parseDuration, parseVideo, type VideoProvider } from "../../../../../modules/funnels/video";
import { teachFunnel } from "./brain";
import { UUID_RE, orgTimezone } from "./data";
import { bool, color, int, optional, optionalColor, optionalInt, pickOne, storeImage, text, url, zoned } from "./form-input";
import { funnelCheckInput, homeBlocks } from "./site-data";
import { funnelAction, funnelsAction, withMessage, type FunnelsCtx } from "./guard";
import { fetchVideoMeta, refreshVideoMeta } from "./oembed";
import { richFromInput, sanitizeEmbed } from "./sanitize";
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
  // A preset picks type and mode (and starting settings); without one, the type / kind fields as before.
  const presetValue = text(formData, "preset", 20);
  const preset = isPreset(presetValue) ? presetValue : null;
  const basics = preset ? presetBasics(preset) : null;
  const siteType = basics?.siteType ?? pickOne(formData, "siteType", SITE_TYPES, "launch");
  const name = text(formData, "name", 120) || (siteType === "microsite" ? "New microsite" : "New launch");
  const mode = basics?.mode ?? pickOne(formData, "mode", FUNNEL_MODES, "evergreen");
  const dayCount = int(formData, "days", 4, siteType === "microsite" ? 0 : 1, 30);
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
      // New funnels start with the old app's look; existing ones keep theirs.
      design: JSON.parse(JSON.stringify(NEW_FUNNEL_DESIGN)) as Prisma.InputJsonValue,
      ...NEW_FUNNEL_COLUMNS,
      ...(preset ? (presetColumns(preset) as Prisma.FunnelCreateInput) : {}),
      ...(preset === "docuseries" ? { offerBlocks: JSON.parse(JSON.stringify(presetOfferBlocks(preset))) as Prisma.InputJsonValue } : {}),
      companyName: ctx.brand.name,
      createdById: ctx.actorId,
    },
  });
  for (let position = 1; position <= dayCount; position += 1) {
    await db.funnelDay.create({
      data: {
        organizationId: ctx.resolved.id,
        funnelId: funnel.id,
        position,
        title: "",
        unlockKey: newUnlockKey(),
        unlockOffsetHours: (position - 1) * 24,
        isLive: mode === "live",
        ...(preset === "docuseries" ? { navLabel: `Episode ${position}`, resources: JSON.parse(JSON.stringify(presetDayResources(preset))) as Prisma.InputJsonValue, resourcesHeading: "" } : {}),
      },
    });
  }
  await audit(ctx, "funnels.funnel.created", "funnel", funnel.id, preset ? { preset } : undefined);
  redirect(builder(funnel.id, "setup"));
}

/** Save one tab of the builder. Only the fields of that tab are touched. */
export async function saveFunnel(formData: FormData) {
  const funnelId = text(formData, "funnelId", 40);
  const section = text(formData, "section", 20);
  const back = builder(funnelId, section === "agenda" ? (/^[a-z]{2,20}$/.test(text(formData, "returnTab", 20)) ? text(formData, "returnTab", 20) : "waitlist") : section === "livendar" ? "days" : section || "setup");
  const ctx = await funnelAction(back, funnelId, "funnels.write");
  const funnel = await ownFunnel(ctx, funnelId);
  const db = tenantDb(ctx.resolved.id);
  const timeZone = await orgTimezone(ctx.resolved.id);
  let data: Prisma.FunnelUpdateManyMutationInput = {};

  const blankOrColor = (key: string) => {
    const value = text(formData, key, 7);
    return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : "";
  };
  if (section === "setup") {
    const wantedSlug = normalizeSlug(text(formData, "slug", 80));
    if (!isValidSlug(wantedSlug)) redirect(withMessage(back, "error", "The link name must be lowercase letters, numbers and dashes."));
    const slug = await uniqueSlug(ctx.resolved.id, wantedSlug, funnel.id);
    data = {
      name: text(formData, "name", 120) || funnel.name,
      slug,
      brainSyncEnabled: bool(formData, "brainSyncEnabled"),
    };
  } else if (section === "schedule") {
    const siteType = pickOne(formData, "siteType", SITE_TYPES, "launch");
    // Switching to a microsite with an empty home page starts it from the starter layout.
    const seedHome = siteType === "microsite" && homeBlocks(funnel).length === 0;
    const reminders = parseReminders(text(formData, "calReminders", 200));
    data = {
      siteType,
      ...(seedHome ? { homeBlocks: JSON.parse(JSON.stringify(starterBlocks(funnel.name))) as Prisma.InputJsonValue } : {}),
      mode: pickOne(formData, "mode", FUNNEL_MODES, "evergreen"),
      timing: pickOne(formData, "timing", TIMING_MODES, "fixed"),
      startAt: zoned(formData, "startAt", timeZone),
      endAt: zoned(formData, "endAt", timeZone),
      closeAfterHours: optionalInt(formData, "closeAfterHours", 1, 24 * 365),
      livestreamUrl: url(formData, "livestreamUrl"),
      closeMode: pickOne(formData, "closeMode", CLOSE_MODES, "page"),
      closeRedirectUrl: url(formData, "closeRedirectUrl"),
      calendarEnabled: bool(formData, "calendarEnabled"),
      calendarMode: pickOne(formData, "calendarMode", ["builtin", "url"] as const, "builtin"),
      calendarButtonText: text(formData, "calendarButtonText", 80) || "Add to calendar",
      calendarUrl: url(formData, "calendarUrl"),
      calInviteScope: pickOne(formData, "calInviteScope", ["individual", "series"] as const, "individual"),
      calInviteTitle: text(formData, "calInviteTitle", 300) || "{funnel}: {title}",
      calInviteDesc: String(formData.get("calInviteDesc") ?? "").replace(/\r\n?/g, "\n").trim().slice(0, 5000),
      calReminders: reminders.join(","),
      betweenSessions: pickOne(formData, "betweenSessions", BETWEEN_SESSIONS, "hybrid"),
      liveCountdown: bool(formData, "liveCountdown"),
      liveCountdownTitle: text(formData, "liveCountdownTitle", 200) || "We go live in…",
      todayTrainingEnabled: bool(formData, "todayTrainingEnabled"),
      todayTrainingText: text(formData, "todayTrainingText", 120) || "Join today's session",
      todayTrainingMsg: text(formData, "todayTrainingMsg", 500),
      todayTrainingLiveMsg: text(formData, "todayTrainingLiveMsg", 500),
      earlyJoinEnabled: bool(formData, "earlyJoinEnabled"),
      earlyJoinMinutes: int(formData, "earlyJoinMinutes", 15, 1, 24 * 60),
      earlyJoinText: text(formData, "earlyJoinText", 120) || "Join the room early",
      earlyJoinUrl: url(formData, "earlyJoinUrl"),
    };
    if (data.closeMode === "redirect" && !data.closeRedirectUrl) redirect(withMessage(back, "error", "Closing by redirect needs a web address (https://…)."));
  } else if (section === "progression") {
    data = {
      progression: pickOne(formData, "progression", PROGRESSIONS, "all_open"),
      lockFirstModule: bool(formData, "lockFirstModule"),
      keyForceUnlock: bool(formData, "keyForceUnlock"),
      lockPassedModules: bool(formData, "lockPassedModules"),
      hidePassedModules: bool(formData, "hidePassedModules"),
      unlockCountdownMode: pickOne(formData, "unlockCountdownMode", ["day_of", "always", "off"] as const, "day_of"),
      unlockCountdownTitle: text(formData, "unlockCountdownTitle", 200) || "Unlocks in…",
      watchPercent: int(formData, "watchPercent", 80, 1, 100),
      buildMode: pickOne(formData, "buildMode", ["as_you_go", "prebuilt"] as const, "as_you_go"),
      lockedTitle: text(formData, "lockedTitle", 120) || "This video is locked",
      lockedScheduledMsg: text(formData, "lockedScheduledMsg", 1000),
      lockedWatchMsg: text(formData, "lockedWatchMsg", 1000),
      lockedKeyMsg: text(formData, "lockedKeyMsg", 1000),
      lockedLiveMsg: text(formData, "lockedLiveMsg", 1000),
      lockedPassedMsg: text(formData, "lockedPassedMsg", 1000),
      lockedExpiredMsg: text(formData, "lockedExpiredMsg", 1000),
      accessHours: optionalInt(formData, "accessHours", 1, 24 * 365),
      comingSoonTitle: text(formData, "comingSoonTitle", 120) || "Coming soon",
      comingSoonMessage: text(formData, "comingSoonMessage", 1000),
      replayPendingTitle: text(formData, "replayPendingTitle", 120) || "The replay is on its way",
      replayPendingMessage: text(formData, "replayPendingMessage", 1000),
      liveHeadline: text(formData, "liveHeadline", 120) || "We're live!",
      liveSubheadline: text(formData, "liveSubheadline", 300),
      nextButtonText: text(formData, "nextButtonText", 80) || "Watch the next day",
      prevButtonText: text(formData, "prevButtonText", 80) || "Watch the previous day",
    };
  } else if (section === "waitlist") {
    const optinMode = pickOne(formData, "optinMode", ["none", "email", "form", "sms"] as const, "none");
    const formSlug = text(formData, "optinFormSlug", 80);
    const form = optinMode === "form" && formSlug ? await db.form.findFirst({ where: { slug: formSlug, brandId: ctx.brand.id, deletedAt: null }, select: { slug: true } }) : null;
    const smsFormId = optinMode === "sms" ? await ownSmsFormId(ctx.resolved.id, funnel.id, text(formData, "optinSmsFormId", 40)) : null;
    if (optinMode === "sms" && !smsFormId) redirect(withMessage(back, "error", "Pick one of this funnel's SMS forms (SMS forms tab)."));
    const imageUrl = text(formData, "waitlistBgImageUrl", 1000);
    if (imageUrl && !/^https:\/\/[^\s"'()<>\\]+$/i.test(imageUrl)) redirect(withMessage(back, "error", "The background image link must start with https://."));
    data = {
      optinSmsFormId: smsFormId,
      waitlistEnabled: bool(formData, "waitlistEnabled"),
      waitlistHeadline: text(formData, "waitlistHeadline", 300),
      waitlistSubheadline: text(formData, "waitlistSubheadline", 1000),
      waitlistBgImageUrl: imageUrl || null,
      waitlistBg: blankOrColor("waitlistBg"),
      waitlistText: blankOrColor("waitlistText"),
      countdownBoxBg: color(formData, "countdownBoxBg", "#ffffff"),
      countdownDigit: color(formData, "countdownDigit", "#111827"),
      homeworkEnabled: bool(formData, "homeworkEnabled"),
      homeworkTitle: text(formData, "homeworkTitle", 200),
      homeworkSubtitle: text(formData, "homeworkSubtitle", 1000),
      homeworkItems: linkItemsFromForm((key) => (formData.has(key) ? String(formData.get(key)) : null), "hw") as unknown as Prisma.InputJsonValue,
      optinMode,
      optinFormSlug: form?.slug ?? null,
      optinHeadline: text(formData, "optinHeadline", 160),
      optinButtonText: text(formData, "optinButtonText", 40) || "Remind me",
    };
  } else if (section === "agenda") {
    data = {
      agendaTitle: text(formData, "agendaTitle", 200),
      agendaLayout: pickOne(formData, "agendaLayout", ["list", "cards"] as const, "list"),
      agendaBg: blankOrColor("agendaBg"),
      agendaText: blankOrColor("agendaText"),
    };
  } else if (section === "livendar") {
    data = { livendarTitle: text(formData, "livendarTitle", 200), livendarHtml: sanitizeEmbed(String(formData.get("livendarHtml") ?? "")) };
  } else if (section === "hosts") {
    data = { hostsEnabled: bool(formData, "hostsEnabled"), hostsTitle: text(formData, "hostsTitle", 120), hostsBg: blankOrColor("hostsBg"), hostsTitleColor: blankOrColor("hostsTitleColor") };
  } else if (section === "deadline") {
    data = {
      deadlineBarEnabled: bool(formData, "deadlineBarEnabled"),
      deadlineBarTarget: pickOne(formData, "deadlineBarTarget", DEADLINE_TARGETS, "end"),
      deadlineBarAt: zoned(formData, "deadlineBarAt", timeZone),
      deadlineBarPosition: pickOne(formData, "deadlineBarPosition", DEADLINE_POSITIONS, "bottom"),
      deadlineBarSticky: bool(formData, "deadlineBarSticky"),
      deadlineBarText: text(formData, "deadlineBarText", 200) || "This offer ends in",
      deadlineBarBg: color(formData, "deadlineBarBg", "#b42318"),
      deadlineBarColor: color(formData, "deadlineBarColor", "#ffffff"),
      deadlineBarWithinHours: int(formData, "deadlineBarWithinHours", 0, 0, 24 * 60),
      deadlineBarPages: normalizeDeadlinePages(formData.getAll("deadlineBarPages").map(String)).filter((page) => (DEADLINE_PAGES as readonly string[]).includes(page)),
      deadlineBarButtonText: text(formData, "deadlineBarButtonText", 40),
      deadlineBarButtonUrl: normalizeDeadlineButtonUrl(text(formData, "deadlineBarButtonUrl", 500)),
      deadlineBarDismiss: bool(formData, "deadlineBarDismiss"),
      deadlineBarDigitColor: blankOrColor("deadlineBarDigitColor") || null,
      deadlineBarButtonBg: blankOrColor("deadlineBarButtonBg") || null,
      deadlineBarSpacing: pickOne(formData, "deadlineBarSpacing", ["narrow", "wide"] as const, "narrow"),
    };
    if (data.deadlineBarButtonText && !data.deadlineBarButtonUrl) redirect(withMessage(back, "error", "The bar button needs a web address (https://…) or a module (module:1)."));
  } else if (section === "episode") {
    data = {
      countdownStyle: pickOne(formData, "countdownStyle", ["boxes", "flip"] as const, "boxes"),
      countdownZero: pickOne(formData, "countdownZero", ["reload", "stay"] as const, "reload"),
      countdownBoxBg: color(formData, "countdownBoxBg", "#ffffff"),
      countdownDigit: color(formData, "countdownDigit", "#111827"),
      lockedBoxBg: blankOrColor("lockedBoxBg") || null,
      lockedBoxText: blankOrColor("lockedBoxText") || null,
      lockedBoxMinimal: bool(formData, "lockedBoxMinimal"),
      navLayout: pickOne(formData, "navLayout", ["strip", "sidebar"] as const, "strip"),
      navBlurLocked: bool(formData, "navBlurLocked"),
    };
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
      closeHeadline: text(formData, "closeHeadline", 300) || "This event has closed",
      closeMessageHtml: richFromInput(text(formData, "closeMessageHtml", 50_000)),
      closeButtonText: optional(formData, "closeButtonText", 120),
      closeButtonUrl: url(formData, "closeButtonUrl"),
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
  const kind = pickOne(formData, "kind", ["video", "text"] as const, "video");
  const videoInput = String(formData.get("video") ?? "").trim().slice(0, 20_000);
  const providerHint = pickOne(formData, "videoProvider", ["", ...VIDEO_PROVIDERS] as const, "");
  const video = parseVideo(videoInput, providerHint || null);
  if (videoInput && !video) {
    redirect(withMessage(back, "error", providerHint ? `That is not a ${PROVIDER_LABELS[providerHint as VideoProvider]} link, embed code or id.` : "That is not a Wistia, YouTube or Vidalytics link, embed code or id."));
  }
  const thumb = await storeImage(ctx.resolved.id, funnel.id, "thumb", formData.get("thumb"));
  if (thumb && "error" in thumb) redirect(withMessage(back, "error", thumb.error));
  const videoChanged = (video?.id ?? null) !== day.videoId || (video?.provider ?? null) !== day.videoProvider;
  // Automatic details whenever the video is new or changed (or has no thumbnail yet). A manual thumbnail always wins on the page.
  const meta = video && (videoChanged || !day.videoThumbUrl) ? await fetchVideoMeta(video) : null;
  const manualDuration = parseDuration(text(formData, "videoDuration", 12));
  const manualTitle = optional(formData, "videoTitle", 200);
  const unlockKey = normalizeSlug(text(formData, "unlockKey", 40), 40) || day.unlockKey || newUnlockKey();
  const unlockBy = text(formData, "unlockBy", 10);
  const resources = linkItemsFromForm((key) => (formData.has(key) ? String(formData.get(key)) : null), "res");
  await db.funnelDay.updateMany({
    where: { id: day.id },
    data: {
      kind,
      title: text(formData, "title", 300),
      navLabel: optional(formData, "navLabel", 60),
      topics: text(formData, "topics", 5000)
        .split("\n")
        .map((line) => line.replace(/^[-*•]\s*/, "").trim())
        .filter(Boolean)
        .slice(0, 30),
      bodyHtml: richFromInput(text(formData, "bodyHtml", 200_000), 200_000),
      videoProvider: video?.provider ?? null,
      videoId: video?.id ?? null,
      ...(videoChanged ? { videoTitle: null, videoThumbUrl: null, videoDuration: null } : {}),
      ...(meta ? { videoTitle: meta.title, videoThumbUrl: meta.thumbnailUrl, videoDuration: meta.durationSeconds } : {}),
      // Vidalytics has no public details: the title and length are typed in.
      ...(video?.provider === "vidalytics" ? { videoTitle: manualTitle, videoDuration: manualDuration } : manualDuration && !meta?.durationSeconds ? { videoDuration: manualDuration } : {}),
      thumbUrl: url(formData, "thumbUrl"),
      ...(thumb && "id" in thumb ? { thumbAssetId: thumb.id } : bool(formData, "removeThumb") ? { thumbAssetId: null } : {}),
      ...(formData.has("unlockOffsetHours") ? { unlockOffsetHours: int(formData, "unlockOffsetHours", 0, 0, 24 * 365) } : {}),
      ...(formData.has("unlockAt") || unlockBy ? { unlockAt: unlockBy === "offset" ? null : zoned(formData, "unlockAt", timeZone) } : {}),
      unlockKey,
      lockedMessage: optional(formData, "lockedMessage", 1000),
      accessHours: optionalInt(formData, "accessHours", 1, 24 * 365),
      showOffer: bool(formData, "showOffer"),
      isLive: bool(formData, "isLive"),
      liveStartAt: zoned(formData, "liveStartAt", timeZone),
      liveEndAt: zoned(formData, "liveEndAt", timeZone),
      liveUrl: url(formData, "liveUrl"),
      liveOverride: pickOne(formData, "liveOverride", LIVE_OVERRIDES, "auto"),
      calendarUrl: url(formData, "calendarUrl"),
      showAgenda: bool(formData, "showAgenda"),
      agendaScope: pickOne(formData, "agendaScope", ["full", "module"] as const, "full"),
      livendarMode: pickOne(formData, "livendarMode", ["default", "custom", "off"] as const, "default"),
      livendarHtml: sanitizeEmbed(String(formData.get("livendarHtml") ?? "")),
      resourcesHeading: text(formData, "resourcesHeading", 300),
      resources: resources as unknown as Prisma.InputJsonValue,
      ctaReveal: pickOne(formData, "ctaReveal", CTA_REVEALS, "none"),
      ctaText: text(formData, "ctaText", 200),
      ctaUrl: url(formData, "ctaUrl") ?? "",
      ctaSeconds: parseDuration(text(formData, "ctaSeconds", 12)) ?? 0,
      ctaAt: zoned(formData, "ctaAt", timeZone),
      ctaSubtext: text(formData, "ctaSubtext", 500),
      ctaBg: optionalColor(formData, "ctaBg"),
      ctaTextColor: optionalColor(formData, "ctaTextColor"),
      ctaNewTab: bool(formData, "ctaNewTab"),
      smsFormId: await ownSmsFormId(ctx.resolved.id, funnel.id, text(formData, "smsFormId", 40)),
    },
  });
  await db.funnel.updateMany({ where: { id: funnel.id }, data: { updatedAt: new Date() } });
  await audit(ctx, "funnels.day.updated", "funnel_day", day.id);
  const note = video && oembedUrl(video) && (videoChanged || !day.videoThumbUrl) && !meta ? ` ${PROVIDER_LABELS[video.provider]} didn't answer, so the title and thumbnail were not filled in. Save again later, or set a thumbnail by hand.` : "";
  if (note && video) after(() => refreshVideoMeta(ctx.resolved.id, day.id, video));
  redirect(withMessage(`${back}#day-${day.id}`, "notice", `${day.navLabel?.trim() || `Day ${day.position}`} saved.${note}`));
}

/** Show (or hide) the agenda box under every module's video. */
export async function setAgendaOnAllDays(formData: FormData) {
  const funnelId = text(formData, "funnelId", 40);
  const ctx = await funnelAction(builder(funnelId, "days"), funnelId, "funnels.write");
  const funnel = await ownFunnel(ctx, funnelId);
  const on = text(formData, "on", 5) === "1";
  await tenantDb(ctx.resolved.id).funnelDay.updateMany({ where: { funnelId: funnel.id }, data: { showAgenda: on } });
  await audit(ctx, "funnels.day.updated", "funnel", funnel.id, { showAgenda: on });
  redirect(withMessage(builder(funnel.id, "days"), "notice", on ? "The agenda now shows under every module." : "The agenda is off on every module."));
}

/** Copy a funnel as a new draft: settings, modules (with new unlock keys), pages, hosts and SMS forms. Opt-ins and stats are not copied. */
export async function duplicateFunnel(formData: FormData) {
  const funnelId = text(formData, "funnelId", 40);
  const ctx = await funnelsAction("/funnels", "funnels.write");
  const source = await ownFunnel(ctx, funnelId);
  const db = tenantDb(ctx.resolved.id);
  const [days, navItems, hosts, smsForms, emails] = await Promise.all([
    db.funnelDay.findMany({ where: { funnelId: source.id }, orderBy: { position: "asc" } }),
    db.funnelNavItem.findMany({ where: { funnelId: source.id } }),
    db.funnelHost.findMany({ where: { funnelId: source.id } }),
    db.funnelSmsForm.findMany({ where: { funnelId: source.id } }),
    db.funnelEmail.findMany({ where: { funnelId: source.id } }),
  ]);
  const strip = <T extends Record<string, unknown>>(row: T, drop: string[]) => Object.fromEntries(Object.entries(row).filter(([key]) => !drop.includes(key))) as Record<string, unknown>;
  const json = (value: unknown) => (value === null || value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue));
  const base = strip(source, ["id", "createdAt", "updatedAt", "publishedAt", "deletedAt", "status", "slug", "name", "createdById", "homeBlocks", "homeBlocksDraft", "design", "designDraft", "homeworkItems"]);
  const copy = await db.funnel.create({
    data: {
      ...(base as Prisma.FunnelUncheckedCreateInput),
      organizationId: ctx.resolved.id,
      brandId: source.brandId,
      name: `${source.name} (copy)`.slice(0, 120),
      slug: await uniqueSlug(ctx.resolved.id, `${source.slug}-copy`),
      status: "draft",
      createdById: ctx.actorId,
      homeBlocks: json(source.homeBlocks) ?? [],
      design: json(source.design) ?? {},
      homeworkItems: json(source.homeworkItems) ?? [],
    },
  });
  const smsMap = new Map<string, string>();
  for (const form of smsForms) {
    const created = await db.funnelSmsForm.create({ data: { ...(strip(form, ["id", "createdAt", "updatedAt", "funnelId"]) as Prisma.FunnelSmsFormUncheckedCreateInput), organizationId: ctx.resolved.id, funnelId: copy.id } });
    smsMap.set(form.id, created.id);
  }
  for (const day of days) {
    await db.funnelDay.create({
      data: { ...(strip(day, ["id", "createdAt", "updatedAt", "funnelId", "resources", "smsFormId", "unlockKey"]) as Prisma.FunnelDayUncheckedCreateInput), organizationId: ctx.resolved.id, funnelId: copy.id, unlockKey: newUnlockKey(), resources: json(day.resources) ?? [], smsFormId: day.smsFormId ? smsMap.get(day.smsFormId) ?? null : null },
    });
  }
  for (const item of navItems) {
    await db.funnelNavItem.create({ data: { ...(strip(item, ["id", "createdAt", "updatedAt", "funnelId", "smsFormId"]) as Prisma.FunnelNavItemUncheckedCreateInput), organizationId: ctx.resolved.id, funnelId: copy.id, smsFormId: item.smsFormId ? smsMap.get(item.smsFormId) ?? null : null } });
  }
  for (const host of hosts) {
    await db.funnelHost.create({ data: { ...(strip(host, ["id", "createdAt", "updatedAt", "funnelId"]) as Prisma.FunnelHostUncheckedCreateInput), organizationId: ctx.resolved.id, funnelId: copy.id } });
  }
  for (const email of emails) {
    await db.funnelEmail.create({ data: { ...(strip(email, ["id", "createdAt", "updatedAt", "funnelId"]) as Prisma.FunnelEmailUncheckedCreateInput), organizationId: ctx.resolved.id, funnelId: copy.id } });
  }
  await db.funnel.updateMany({ where: { id: copy.id }, data: { optinSmsFormId: source.optinSmsFormId ? smsMap.get(source.optinSmsFormId) ?? null : null } });
  await audit(ctx, "funnels.funnel.duplicated", "funnel", copy.id, { from: source.id });
  redirect(withMessage(builder(copy.id, "setup"), "notice", "Copied. The copy is a draft with new unlock links."));
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
