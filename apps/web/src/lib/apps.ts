import type { AccessScope, AccessSubject, Niche } from "@pubcommand/core";
import { can } from "@pubcommand/core";
import { moduleRegistry } from "@pubcommand/modules";

/** How each module shows up as an app card on the dashboard. */
type AppCard = {
  moduleId: string;
  name: string;
  description: string;
  icon: string;
  category: "Setup" | "Copy & Promos" | "Editorial" | "Research & Knowledge" | "Performance" | "Media & Audience";
  /** Only show for brands in these niches. Omit to show for every brand. */
  niches?: Niche[];
};

const CARDS: AppCard[] = [
  {
    moduleId: "pubsetup",
    name: "Publication Setup",
    description: "Your publications, editors and branding in one place. Every app uses it.",
    icon: "🏷️",
    category: "Setup",
  },
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
    description: "Events, editorial issues and send stats for every publication, on one calendar.",
    icon: "🗓️",
    category: "Editorial",
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
    name: "Intel",
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
    description: "Launch video funnels and microsites with waitlist opt-ins.",
    icon: "🚀",
    category: "Media & Audience",
  },
  {
    moduleId: "miniblog",
    name: "Mini-Blog",
    description: "Small public blogs with an archive and SMS subscribe page.",
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
  "Setup",
  "Copy & Promos",
  "Editorial",
  "Research & Knowledge",
  "Performance",
  "Media & Audience",
];

export type VisibleApp = AppCard & { href: string };

/** Apps this person can open in this organization and brand. */
export function visibleApps(subject: AccessSubject, scope: AccessScope, niche: Niche = "general"): VisibleApp[] {
  const manifests = new Map(moduleRegistry.all().map((manifest) => [manifest.id, manifest]));
  return CARDS.flatMap((card) => {
    if (card.niches && !card.niches.includes(niche)) return [];
    const manifest = manifests.get(card.moduleId);
    if (!manifest || !subject.entitledModuleIds.includes(manifest.planEntitlement)) return [];
    const entry = manifest.nav[0];
    if (!entry) return [];
    if (entry.permission && !can(subject, entry.permission, scope)) return [];
    return [{ ...card, href: entry.href }];
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
