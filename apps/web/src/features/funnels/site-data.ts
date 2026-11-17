import { isHttpUrl, type FunnelCheckInput } from "../../../../../modules/funnels/checks";
import { normalizeBlocks, type Block } from "../../../../../modules/funnels/blocks";
import { designCss, fontHref, normalizeDesign, type Design, type FooterLink } from "../../../../../modules/funnels/design";
import { assetSrc, funnelBranding, funnelDesign, funnelRules, type Branding, type DayRow, type FunnelRow, type NavItemRow } from "./data";
import { richFromInput } from "./sanitize";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What the Design tab's live preview saves while the admin types: the design
 * plus the few row fields the tab also edits. Never shown to visitors.
 */
export type DesignDraft = {
  design: Design;
  logoAssetId: string | null;
  logoUrl: string | null;
  companyName: string;
  privacyUrl: string | null;
  termsUrl: string | null;
  footerHtml: string;
  formThemeId: string | null;
};

/** The home page builder's unsaved state. */
export type HomeDraft = { blocks: Block[]; shell: boolean; title: string };

export function parseDesignDraft(raw: unknown, funnel: FunnelRow): DesignDraft {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const str = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  const uuid = (value: unknown) => (typeof value === "string" && UUID_RE.test(value) ? value.toLowerCase() : null);
  const http = (value: unknown) => (typeof value === "string" && isHttpUrl(value) ? value.trim().slice(0, 1000) : null);
  return {
    design: normalizeDesign(input.design, funnel),
    logoAssetId: "logoAssetId" in input ? uuid(input.logoAssetId) : funnel.logoAssetId,
    logoUrl: "logoUrl" in input ? http(input.logoUrl) : funnel.logoUrl,
    companyName: "companyName" in input ? str(input.companyName, 120) : funnel.companyName,
    privacyUrl: "privacyUrl" in input ? http(input.privacyUrl) : funnel.privacyUrl,
    termsUrl: "termsUrl" in input ? http(input.termsUrl) : funnel.termsUrl,
    footerHtml: "footerHtml" in input ? richFromInput(str(input.footerHtml, 20_000)) : funnel.footerHtml,
    formThemeId: "formThemeId" in input ? uuid(input.formThemeId) : funnel.formThemeId,
  };
}

export function parseHomeDraft(raw: unknown, funnel: Pick<FunnelRow, "homeBlocks" | "homeShell" | "homeTitle">): HomeDraft {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    blocks: normalizeBlocks("blocks" in input ? input.blocks : funnel.homeBlocks, { sanitizeRich: (html) => richFromInput(html) }),
    shell: typeof input.shell === "boolean" ? input.shell : funnel.homeShell,
    title: typeof input.title === "string" ? input.title.trim().slice(0, 160) : funnel.homeTitle,
  };
}

/** A stored preview draft: a non-empty object. Null or {} = none. */
export function hasDraft(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).length > 0;
}

/** The funnel row as the builder's live preview sees it: the unsaved design and home page laid over the saved ones. */
export function applyDesignDraft(funnel: FunnelRow): FunnelRow {
  let next = funnel;
  if (hasDraft(funnel.designDraft)) {
    const draft = parseDesignDraft(funnel.designDraft, funnel);
    next = { ...next, ...draft, design: draft.design as unknown as FunnelRow["design"] };
  }
  if (hasDraft(funnel.homeBlocksDraft)) {
    const draft = parseHomeDraft(funnel.homeBlocksDraft, funnel);
    next = { ...next, homeBlocks: draft.blocks as unknown as FunnelRow["homeBlocks"], homeShell: draft.shell, homeTitle: draft.title };
  }
  return next;
}

export function homeBlocks(funnel: Pick<FunnelRow, "homeBlocks">): Block[] {
  return normalizeBlocks(funnel.homeBlocks, { sanitizeRich: (html) => richFromInput(html) });
}

export type FunnelTheme = {
  branding: Branding;
  design: Design;
  css: string;
  fontHref: string | null;
  /** Where the header logo goes (null = not a link). */
  logoHref: string | null;
  footerLogoSrc: string | null;
  footerLogoHeight: number;
  footerLinks: FooterLink[];
};

/** Everything a public funnel page needs to look like its design. */
export async function funnelTheme(organizationId: string, funnel: FunnelRow, base: string, homeHref: string): Promise<FunnelTheme> {
  const branding = await funnelBranding(organizationId, funnel, base);
  const design = funnelDesign(funnel);
  const version = funnel.updatedAt;
  const header = design.header.imageAssetId ? assetSrc(funnel, design.header.imageAssetId, version) : design.header.imageUrl;
  const page = design.page.imageAssetId ? assetSrc(funnel, design.page.imageAssetId, version) : design.page.imageUrl;
  // A Forms theme supplies the header colour and accent; the rest of the design stays the funnel's own.
  const effective: Design = { ...design, header: { ...design.header, bg: branding.headerBg, logoHeight: branding.logoHeight }, page: { ...design.page, accent: branding.accentColor } };
  const footerLogo = design.footer.logoAssetId ? assetSrc(funnel, design.footer.logoAssetId, version) : design.footer.logoUrl ?? branding.logoSrc;
  return {
    branding,
    design: effective,
    css: designCss(effective, { header, page }),
    fontHref: fontHref(effective),
    logoHref: design.header.logoLink === "home" ? homeHref : design.header.logoLink === "url" ? design.header.logoLinkUrl : null,
    footerLogoSrc: design.footer.showLogo ? footerLogo : null,
    footerLogoHeight: design.footer.logoHeight ?? branding.logoHeight,
    footerLinks: design.footer.links,
  };
}

/** The public address of a custom page. On a custom domain (base "") the /l/<slug> prefix keeps /p/ from meaning a token page. */
export function pageHref(funnel: Pick<FunnelRow, "slug">, base: string, pageSlug: string, carry = ""): string {
  return `${base || `/l/${funnel.slug}`}/p/${pageSlug}${carry}`;
}

/** A nav item's thumbnail, if it has one. */
export function navItemThumb(funnel: Pick<FunnelRow, "slug">, item: NavItemRow): string | null {
  if (item.thumbAssetId) return assetSrc(funnel, item.thumbAssetId, item.updatedAt);
  return item.thumbUrl && /^https:\/\//i.test(item.thumbUrl) ? item.thumbUrl : null;
}

/** Does anything on this funnel collect plain email opt-ins (waitlist, a home block or a page)? */
export function acceptsEmailOptin(funnel: FunnelRow, navItems: NavItemRow[]): boolean {
  if (funnel.optinMode === "email") return true;
  if (navItems.some((item) => item.kind === "page" && item.optinMode === "email")) return true;
  return funnel.siteType === "microsite" && homeBlocks(funnel).some((block) => block.type === "optin" && block.mode === "email");
}

/** The publish-check input for a funnel (shared by the Publish tab and the publish action). */
export function funnelCheckInput(funnel: FunnelRow, days: DayRow[], navItems: NavItemRow[], themePrivacyUrl: string | null): FunnelCheckInput {
  const rules = funnelRules(funnel);
  return {
    name: funnel.name,
    slug: funnel.slug,
    mode: rules.mode,
    timing: rules.timing,
    startAt: funnel.startAt,
    endAt: funnel.endAt,
    closeAfterHours: funnel.closeAfterHours,
    closeMode: rules.closeMode,
    closeRedirectUrl: funnel.closeRedirectUrl,
    progression: rules.progression,
    buildMode: funnel.buildMode === "prebuilt" ? "prebuilt" : "as_you_go",
    livestreamUrl: funnel.livestreamUrl,
    privacyUrl: themePrivacyUrl ?? funnel.privacyUrl,
    optinMode: funnel.siteType === "microsite" ? "none" : funnel.optinMode === "email" || funnel.optinMode === "form" ? funnel.optinMode : "none",
    optinFormSlug: funnel.optinFormSlug,
    days,
    siteType: rules.siteType,
    homeBlockCount: homeBlocks(funnel).length,
    navItems,
    deadlineBar: { enabled: funnel.deadlineBarEnabled, target: funnel.deadlineBarTarget, at: funnel.deadlineBarAt },
  };
}
