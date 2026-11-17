import { defineModule } from "@pubcommand/core";

export const manifest = defineModule({
  id: "research",
  slug: "research",
  name: "Research Extractor",
  description: "Turn articles, PDFs and videos into index cards, group them, and build an outline from them.",
  nav: [{ label: "Research Extractor", href: "/research", permission: "research.read" }],
  routes: [{ path: "/research", title: "Research Extractor" }],
  permissions: [
    { key: "research.read", description: "Open research projects you own or that are shared with you" },
    { key: "research.write", description: "Create research projects, add sources, and edit cards and outlines" },
  ],
  events: [{ name: "research.cards.extracted", description: "Index cards were extracted from a source" }],
  jobs: [
    { name: "research.extract", description: "Extract index cards from one source" },
    { name: "research.group", description: "Suggest topic groups for a project's cards" },
  ],
  settingsSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  planEntitlement: "research",
});
