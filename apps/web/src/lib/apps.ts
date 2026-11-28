import type { AccessScope, AccessSubject, Niche } from "@pubcommand/core";
import { can } from "@pubcommand/core";
import { moduleRegistry } from "@pubcommand/modules";

/** How each module shows up as an app card on the dashboard. */
type AppCard = {
  moduleId: string;
  name: string;
  description: string;
  icon: string;
  /** "Pinned" apps sit right under Dashboard in the sidebar, with no section heading. "More apps" holds apps staff added in Admin → App cards. */
  category: "Pinned" | "Copy & Promos" | "Research & Knowledge" | "Performance" | "Media & Audience" | "More apps";
  /** Only show for brands in these niches. Omit to show for every brand. */
  niches?: Niche[];
};

const CARDS: AppCard[] = [
  {
    moduleId: "promo-studio",
    name: "Promo Analyzer",
    description: "Upload promos, score them, and build the copy package from what works.",
    icon: "📣",
    category: "Copy & Promos",
  },
  {
    moduleId: "research",
    name: "Research Extractor",
    description: "Turn articles, PDFs and videos into index cards, then build an outline from them.",
    icon: "🗂️",
    category: "Copy & Promos",
  },
  {
    moduleId: "editorial",
    name: "Calendar",
    description: "Events, editorial issues and promos for every publication, on one calendar.",
    icon: "🗓️",
    category: "Pinned",
  },
  {
    moduleId: "knowledge",
    name: "Brain",
    description: "This brand's knowledge, with best practices to build on.",
    icon: "🧠",
    category: "Research & Knowledge",
  },
  {
    moduleId: "wiki",
    name: "Wiki",
    description: "Every publication and editor in one place, with offers, branding and approved testimonials.",
    icon: "📚",
    category: "Research & Knowledge",
  },
  {
    moduleId: "support",
    name: "Support Knowledge",
    description: "What your support agents may say: customer-safe answers, agent keys, ElevenLabs sync and unanswered questions.",
    icon: "🎧",
    category: "Research & Knowledge",
  },
  {
    moduleId: "intel",
    name: "iSpy",
    description: "Competitor emails and promos in your market.",
    icon: "🔎",
    category: "Research & Knowledge",
  },
  {
    moduleId: "performance",
    name: "Track Record",
    description: "Recommendations, portfolios and gains from real prices.",
    icon: "📈",
    category: "Performance",
    niches: ["finance"],
  },
  {
    moduleId: "charts",
    name: "ChartBuilder",
    description: "Stock charts for promos, social and publications.",
    icon: "📊",
    category: "Media & Audience",
    niches: ["finance"],
  },
  {
    moduleId: "funnels",
    name: "Funnels",
    description: "Launch video funnels and microsites.",
    icon: "🚀",
    category: "Media & Audience",
  },
  {
    moduleId: "websites",
    name: "Websites",
    description: "Your public website and members-only site: posts, pages, media, free sign-ups, members and access.",
    icon: "🌐",
    category: "Media & Audience",
  },
  {
    moduleId: "miniblog",
    name: "Mini-Blog",
    description: "Small public blogs (T-Letters) with themes, an archive, ad zones, stats and an email sign-up.",
    icon: "✍️",
    category: "Media & Audience",
  },
  {
    moduleId: "testimonials",
    name: "Testimonials",
    description: "Collect reader testimonials per publication, review them against your rules, and publish the approved ones.",
    icon: "💬",
    category: "Media & Audience",
  },
  {
    moduleId: "forms",
    name: "Forms",
    description: "Surveys and forms with branching and results.",
    icon: "📝",
    category: "Media & Audience",
  },
];

export const CATEGORY_ORDER: AppCard["category"][] = [
  "Pinned",
  "Copy & Promos",
  "Research & Knowledge",
  "Performance",
  "Media & Audience",
  "More apps",
];

/**
 * Staff settings for one app's dashboard card (Admin → App cards, table app_cards). Missing
 * fields keep the defaults: built-in apps are on the dashboard in built-in order; apps without a
 * built-in card are off until staff turn them on.
 */
export type AppCardSetting = {
  name: string | null;
  onDashboard: boolean | null;
  position: number | null;
  /** When an uploaded image exists: its version (updated time), for the image URL. */
  imageVersion: number | null;
};
export type AppCardSettings = Record<string, AppCardSetting>;

/** Card artwork shipped with the app (apps/web/public/brand/app-cards, static on every host), used until staff upload one. */
const DEFAULT_CARD_IMAGES: Record<string, string> = {
  editorial: "/brand/app-cards/calendar.svg",
  knowledge: "/brand/app-cards/brain.svg",
  wiki: "/brand/app-cards/wiki.svg",
  funnels: "/brand/app-cards/funnels.svg",
  miniblog: "/brand/app-cards/mini-blog.svg",
  forms: "/brand/app-cards/forms.svg",
  intel: "/brand/app-cards/ispy.svg",
  websites: "/brand/app-cards/websites.svg",
  testimonials: "/brand/app-cards/testimonials.svg",
  support: "/brand/app-cards/support-knowledge.svg",
};

/** Modules that are never dashboard apps (they live under Settings, or are examples). */
const NOT_APPS = new Set(["settings", "example", "pubsetup"]);

/** The card image for an app: staff upload, else bundled artwork, else null (the drawing is used). */
export function appCardImage(moduleId: string, setting?: AppCardSetting | null): string | null {
  if (setting?.imageVersion) return `/api/app-cards/${encodeURIComponent(moduleId)}?v=${setting.imageVersion}`;
  return DEFAULT_CARD_IMAGES[moduleId] ?? null;
}

/** Built-in dashboard position: category order, then the order in CARDS. */
function builtInPosition(moduleId: string): number {
  const index = appCatalog().findIndex((card) => card.moduleId === moduleId);
  return index === -1 ? 1000 : index;
}

/** Every app staff can give a card: the built-in ones, then modules with pages but no built-in card. */
export function cardableApps(): { moduleId: string; name: string; builtIn: boolean }[] {
  const builtIn = appCatalog().map((card) => ({ moduleId: card.moduleId, name: card.name, builtIn: true }));
  const known = new Set(builtIn.map((card) => card.moduleId));
  const extra = moduleRegistry
    .all()
    .filter((manifest) => !known.has(manifest.id) && !NOT_APPS.has(manifest.id) && manifest.nav.length > 0)
    .map((manifest) => ({ moduleId: manifest.id, name: manifest.name, builtIn: false }));
  return [...builtIn, ...extra];
}

/** True when the app's card is on dashboards (staff choice, else the default). */
export function cardOnDashboard(moduleId: string, setting?: AppCardSetting | null): boolean {
  if (typeof setting?.onDashboard === "boolean") return setting.onDashboard;
  return CARDS.some((card) => card.moduleId === moduleId);
}

/** Apps in dashboard order: staff positions first (lowest first), then built-in order. */
export function sortByCardPosition<T extends { moduleId: string }>(apps: T[], settings: AppCardSettings = {}): T[] {
  const key = (moduleId: string) => settings[moduleId]?.position ?? 10_000 + builtInPosition(moduleId);
  return [...apps].sort((a, b) => key(a.moduleId) - key(b.moduleId));
}

/** The cards on this person's dashboard: apps they can open whose card staff left on, in dashboard order. */
export function dashboardCards(apps: VisibleApp[], settings: AppCardSettings = {}): (VisibleApp & { image: string | null })[] {
  return sortByCardPosition(
    apps.filter((app) => cardOnDashboard(app.moduleId, settings[app.moduleId])),
    settings,
  ).map((app) => ({ ...app, image: appCardImage(app.moduleId, settings[app.moduleId]) }));
}

export type SubNavItem = { label: string; href: string };
export type VisibleApp = AppCard & { href: string; /** The app's own pages, shown under it in the sidebar while it is open. */ subnav: SubNavItem[] };

/**
 * Apps this person can open in this organization and brand: the built-in apps, plus apps staff
 * added in Admin → App cards (shown under "More apps"). Staff names replace the built-in ones.
 * The organization must have the app (plan and its own switch) and the person its permission.
 */
export function visibleApps(subject: AccessSubject, scope: AccessScope, niche: Niche = "general", settings: AppCardSettings = {}): VisibleApp[] {
  const manifests = new Map(moduleRegistry.all().map((manifest) => [manifest.id, manifest]));
  const added: AppCard[] = cardableApps()
    .filter((app) => !app.builtIn && settings[app.moduleId]?.onDashboard === true)
    .map((app) => ({ moduleId: app.moduleId, name: app.name, description: manifests.get(app.moduleId)?.description ?? "", icon: "🧩", category: "More apps" }));
  return [...CARDS, ...added].flatMap((base) => {
    const name = settings[base.moduleId]?.name?.trim();
    const card = name ? { ...base, name } : base;
    if (card.niches && !card.niches.includes(niche)) return [];
    const manifest = manifests.get(card.moduleId);
    if (!manifest || !subject.entitledModuleIds.includes(manifest.planEntitlement)) return [];
    const entry = manifest.nav[0];
    if (!entry) return [];
    if (entry.permission && !can(subject, entry.permission, scope)) return [];
    const subnav = manifest.nav.slice(1).filter((item) => !item.permission || can(subject, item.permission, scope)).map((item) => ({ label: item.label, href: item.href }));
    return [{ ...card, href: entry.href, subnav }];
  });
}

/** The app whose pages contain this path, for the top bar title. */
export function appForPath(apps: VisibleApp[], pathname: string): VisibleApp | null {
  return apps.find((app) => pathname === app.href || pathname.startsWith(`${app.href}/`)) ?? null;
}

/** True when an app makes sense for this niche (e.g. charts are finance only). */
export function appFitsNiche(moduleId: string, niche: Niche): boolean {
  const card = CARDS.find((item) => item.moduleId === moduleId);
  return !card?.niches || card.niches.includes(niche);
}

/** Every app card, in dashboard order, for the Settings › Apps page. */
export function appCatalog(): readonly AppCard[] {
  return CATEGORY_ORDER.flatMap((category) => CARDS.filter((card) => card.category === category));
}
