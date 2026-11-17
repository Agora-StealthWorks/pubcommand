import { createModuleRegistry } from "@pubcommand/core";
import { manifest as billing } from "../billing/manifest";
import { manifest as charts } from "../charts/manifest";
import { manifest as editorial } from "../editorial/manifest";
import { manifest as example } from "../example/manifest";
import { manifest as forms } from "../forms/manifest";
import { manifest as funnels } from "../funnels/manifest";
import { manifest as intel } from "../intel/manifest";
import { manifest as knowledge } from "../knowledge/manifest";
import { performanceHome } from "../performance/home";
import { manifest as performance } from "../performance/manifest";
import { manifest as promoStudio } from "../promo-studio/manifest";
import { manifest as settings } from "../settings/manifest";

export const moduleManifests = [
  example,
  knowledge,
  editorial,
  performance,
  promoStudio,
  intel,
  forms,
  charts,
  funnels,
  billing,
  settings,
] as const;

export const moduleRegistry = createModuleRegistry(moduleManifests);

export const PRODUCT_MODULE_IDS = [
  "knowledge",
  "editorial",
  "performance",
  "promo-studio",
  "intel",
  "forms",
  "charts",
  "funnels",
  "billing",
] as const;

export {
  billing,
  charts,
  editorial,
  example,
  forms,
  funnels,
  intel,
  knowledge,
  performance,
  promoStudio,
  settings,
};

export { performanceHome };
