import { createModuleRegistry } from "@pubcommand/core";
import { manifest as billing } from "../billing/manifest";
import { manifest as charts } from "../charts/manifest";
import { manifest as editorial } from "../editorial/manifest";
import { manifest as example } from "../example/manifest";
import { manifest as forms } from "../forms/manifest";
import { manifest as funnels } from "../funnels/manifest";
import { manifest as intel } from "../intel/manifest";
import { manifest as knowledge } from "../knowledge/manifest";
import { manifest as miniblog } from "../miniblog/manifest";
import { manifest as performance } from "../performance/manifest";
import { manifest as promoStudio } from "../promo-studio/manifest";
import { manifest as pubsetup } from "../pubsetup/manifest";
import { manifest as research } from "../research/manifest";
import { manifest as settings } from "../settings/manifest";
import { manifest as testimonials } from "../testimonials/manifest";
import { manifest as wiki } from "../wiki/manifest";
import { manifest as support } from "../support/manifest";

export const moduleManifests = [
  example,
  knowledge,
  editorial,
  performance,
  promoStudio,
  research,
  intel,
  forms,
  charts,
  funnels,
  miniblog,
  pubsetup,
  wiki,
  testimonials,
  support,
  billing,
  settings,
] as const;

export const moduleRegistry = createModuleRegistry(moduleManifests);

export const PRODUCT_MODULE_IDS = [
  "knowledge",
  "editorial",
  "performance",
  "promo-studio",
  "research",
  "intel",
  "forms",
  "charts",
  "funnels",
  "miniblog",
  "pubsetup",
  "wiki",
  "testimonials",
  "support",
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
  miniblog,
  performance,
  promoStudio,
  pubsetup,
  research,
  settings,
  testimonials,
  wiki,
  support,
};

