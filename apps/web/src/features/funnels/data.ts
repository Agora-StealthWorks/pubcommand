import { tenantDb } from "@pubcommand/db";
import { contrastText, isHttpUrl, safeColor } from "../../../../../modules/funnels/checks";
import type { DayRules, FunnelRules } from "../../../../../modules/funnels/state";
import { CLOSE_MODES, FUNNEL_MODES, LIVE_OVERRIDES, PROGRESSIONS, TIMING_MODES } from "../../../../../modules/funnels/state";
import { aggregateFunnel, type FunnelStats } from "../../../../../modules/funnels/stats";
import { safeZone } from "../../../../../modules/funnels/time";
import { fallbackThumbnail, parseVideo, type VideoRef } from "../../../../../modules/funnels/video";
import { sanitizeRich } from "./sanitize";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Db = ReturnType<typeof tenantDb>;
export type FunnelRow = NonNullable<Awaited<ReturnType<Db["funnel"]["findFirst"]>>>;
export type DayRow = NonNullable<Awaited<ReturnType<Db["funnelDay"]["findFirst"]>>>;

function pick<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export async function orgTimezone(organizationId: string): Promise<string> {
  const settings = await tenantDb(organizationId).orgSettings.findUnique({ where: { organizationId }, select: { timezone: true } });
  return safeZone(settings?.timezone);
}

export function dayVideo(day: Pick<DayRow, "videoId" | "videoProvider">): VideoRef | null {
  return parseVideo(day.videoId, day.videoProvider);
}

export function funnelRules(funnel: FunnelRow): FunnelRules {
  return {
    mode: pick(funnel.mode, FUNNEL_MODES, "evergreen"),
    timing: pick(funnel.timing, TIMING_MODES, "fixed"),
    startAt: funnel.startAt,
    endAt: funnel.endAt,
    closeAfterHours: funnel.closeAfterHours,
    closeMode: pick(funnel.closeMode, CLOSE_MODES, "page"),
    progression: pick(funnel.progression, PROGRESSIONS, "all_open"),
    watchPercent: Math.max(1, Math.min(100, funnel.watchPercent)),
    livestreamUrl: isHttpUrl(funnel.livestreamUrl) ? funnel.livestreamUrl : null,
    waitlistEnabled: funnel.waitlistEnabled,
  };
}

export function dayRules(day: DayRow): DayRules {
  return {
    id: day.id,
    position: day.position,
    hasVideo: Boolean(dayVideo(day)),
    unlockOffsetHours: day.unlockOffsetHours,
    unlockAt: day.unlockAt,
    unlockKey: day.unlockKey,
    isLive: day.isLive,
    liveStartAt: day.liveStartAt,
    liveEndAt: day.liveEndAt,
    liveUrl: isHttpUrl(day.liveUrl) ? day.liveUrl : null,
    liveOverride: pick(day.liveOverride, LIVE_OVERRIDES, "auto"),
  };
}

export function dayLabel(day: Pick<DayRow, "position" | "navLabel">): string {
  return day.navLabel?.trim() || `Day ${day.position}`;
}

/** The thumbnail to show for a day. `open` false hides the automatic one (a YouTube thumbnail URL carries the video id). */
export function dayThumb(day: DayRow, base: string, open: boolean): string | null {
  if (day.thumbAssetId) return `${base}/thumb/${day.id}?v=${day.updatedAt.getTime()}`;
  if (day.thumbUrl && /^https:\/\//i.test(day.thumbUrl)) return day.thumbUrl;
  if (!open) return null;
  if (day.videoThumbUrl) return day.videoThumbUrl;
  const video = dayVideo(day);
  return video ? fallbackThumbnail(video) : null;
}

export type Branding = {
  brandName: string;
  logoSrc: string | null;
  logoHeight: number;
  headerBg: string;
  headerText: string;
  pageBg: string;
  textColor: string;
  accentColor: string;
  accentText: string;
  companyName: string;
  privacyUrl: string | null;
  termsUrl: string | null;
  footerHtml: string;
};

/** Funnel branding: its own, or borrowed from a Forms theme (logo, colours, privacy link). */
export async function funnelBranding(organizationId: string, funnel: FunnelRow, base: string): Promise<Branding> {
  const db = tenantDb(organizationId);
  const [brand, theme] = await Promise.all([
    db.brand.findFirst({ where: { id: funnel.brandId }, select: { name: true } }),
    funnel.formThemeId ? db.formTheme.findFirst({ where: { id: funnel.formThemeId, brandId: funnel.brandId, deletedAt: null } }) : null,
  ]);
  const brandName = brand?.name ?? funnel.name;
  const ownLogo = funnel.logoAssetId ? `${base}/logo?v=${funnel.updatedAt.getTime()}` : isHttpUrl(funnel.logoUrl) ? funnel.logoUrl : null;
  const themeLogo = theme?.logoFileId ? `${base}/logo?v=${theme.updatedAt.getTime()}` : theme && isHttpUrl(theme.logoUrl) ? theme.logoUrl : null;
  const headerBg = safeColor(theme ? theme.barColor : funnel.headerBg, "#111827");
  const accentColor = safeColor(theme ? theme.accentColor : funnel.accentColor, "#1d4ed8");
  return {
    brandName,
    logoSrc: theme ? themeLogo : ownLogo,
    logoHeight: Math.max(16, Math.min(120, theme?.logoHeight ?? funnel.logoHeight)),
    headerBg,
    headerText: contrastText(headerBg),
    pageBg: safeColor(funnel.pageBg, "#f5f6f8"),
    textColor: safeColor(funnel.textColor, "#1f2937"),
    accentColor,
    accentText: contrastText(accentColor),
    companyName: (theme?.companyName || funnel.companyName || brandName).trim(),
    privacyUrl: theme && isHttpUrl(theme.privacyPolicyUrl) ? theme.privacyPolicyUrl : isHttpUrl(funnel.privacyUrl) ? funnel.privacyUrl : null,
    termsUrl: isHttpUrl(funnel.termsUrl) ? funnel.termsUrl : null,
    footerHtml: sanitizeRich(funnel.footerHtml),
  };
}

export async function loadFunnelForBrand(organizationId: string, brandId: string, funnelId: string) {
  if (!UUID_RE.test(funnelId)) return null;
  const db = tenantDb(organizationId);
  const funnel = await db.funnel.findFirst({ where: { id: funnelId, brandId, deletedAt: null } });
  if (!funnel) return null;
  const days = await db.funnelDay.findMany({ where: { funnelId }, orderBy: { position: "asc" } });
  return { funnel, days };
}

export async function listFunnels(organizationId: string, brandId: string) {
  const db = tenantDb(organizationId);
  const funnels = await db.funnel.findMany({ where: { brandId, deletedAt: null }, orderBy: { updatedAt: "desc" } });
  const counts = await Promise.all(
    funnels.map(async (funnel) => ({
      id: funnel.id,
      days: await db.funnelDay.count({ where: { funnelId: funnel.id } }),
      optins: await db.funnelOptin.count({ where: { funnelId: funnel.id } }),
    })),
  );
  const byId = new Map(counts.map((row) => [row.id, row]));
  return funnels.map((funnel) => ({ ...funnel, dayCount: byId.get(funnel.id)?.days ?? 0, optinCount: byId.get(funnel.id)?.optins ?? 0 }));
}

export async function funnelStats(organizationId: string, funnel: FunnelRow, dayIds: string[]): Promise<FunnelStats> {
  const db = tenantDb(organizationId);
  const [events, watches, optins] = await Promise.all([
    db.funnelEvent.findMany({ where: { funnelId: funnel.id }, select: { dayId: true, kind: true, visitorId: true }, take: 200_000 }),
    db.funnelWatch.findMany({ where: { funnelId: funnel.id }, select: { dayId: true, percent: true }, take: 200_000 }),
    db.funnelOptin.count({ where: { funnelId: funnel.id } }),
  ]);
  return aggregateFunnel({ dayIds, events, watches, optins, completeAt: funnel.watchPercent });
}

/** The consent sentence under the waitlist email box. Stored with each email opt-in. */
export function emailConsent(funnel: Pick<FunnelRow, "name">, branding: Pick<Branding, "companyName">): string {
  return `By signing up you agree that ${branding.companyName} may email you about ${funnel.name} and related offers. Unsubscribe at any time.`;
}

export const STATUS_TONE = { draft: "neutral", published: "ok", archived: "warn", live: "ok", scheduled: "accent" } as const;
export const STATUS_LABEL = { draft: "Draft", published: "Published", archived: "Archived", live: "Live", scheduled: "Scheduled" } as const;
export function statusBadge(status: string): { tone: (typeof STATUS_TONE)[keyof typeof STATUS_TONE]; label: string } {
  const key = status as keyof typeof STATUS_TONE;
  return { tone: STATUS_TONE[key] ?? "neutral", label: STATUS_LABEL[key] ?? status };
}
