import type { AccessScope, AccessSubject } from "@pubcommand/core";
import { can } from "@pubcommand/core";
import { moduleRegistry } from "@pubcommand/modules";

/** How each module shows up as an app card on the dashboard. */
type AppCard = {
  moduleId: string;
  name: string;
  description: string;
  icon: string;
  category: "Copy & Promos" | "Editorial" | "Research & Knowledge" | "Performance" | "Media & Audience";
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
    moduleId: "editorial",
    name: "Marketing Calendar",
    description: "Events, editorial issues and send stats for every publication, on one calendar.",
    icon: "🗓️",
    category: "Editorial",
  },
  {
    moduleId: "knowledge",
    name: "Brain",
    description: "This brand's knowledge, plus shared best practices from the main Brain.",
    icon: "🧠",
    category: "Research & Knowledge",
  },
  {
    moduleId: "intel",
    name: "Intel",
    description: "Competitor emails, promos and historical calls.",
    icon: "🔎",
    category: "Research & Knowledge",
  },
  {
    moduleId: "performance",
    name: "Track Record",
    description: "Recommendations, portfolios and gains from real prices.",
    icon: "📈",
    category: "Performance",
  },
  {
    moduleId: "charts",
    name: "ChartBuilder",
    description: "Stock charts for promos, social and publications.",
    icon: "📊",
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
  "Copy & Promos",
  "Editorial",
  "Research & Knowledge",
  "Performance",
  "Media & Audience",
];

export type VisibleApp = AppCard & { href: string };

/** Apps this person can open in this organization and brand. */
export function visibleApps(subject: AccessSubject, scope: AccessScope): VisibleApp[] {
  const manifests = new Map(moduleRegistry.all().map((manifest) => [manifest.id, manifest]));
  return CARDS.flatMap((card) => {
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

/** Every app card, in dashboard order, for the Settings › Apps page. */
export function appCatalog(): readonly AppCard[] {
  return CATEGORY_ORDER.flatMap((category) => CARDS.filter((card) => card.category === category));
}
