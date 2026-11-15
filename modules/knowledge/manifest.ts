import { defineModule } from "@pubcommand/core";

export const manifest = defineModule({
  id: "knowledge",
  slug: "knowledge",
  name: "Knowledge",
  description: "Markdown pages for this organization, with keyword search and citations.",
  nav: [{ label: "Knowledge", href: "/knowledge", permission: "knowledge.read" }],
  routes: [{ path: "/knowledge", title: "Knowledge" }],
  permissions: [
    { key: "knowledge.read", description: "Read knowledge entries" },
    { key: "knowledge.write", description: "Create and edit knowledge entries" },
  ],
  events: [{ name: "knowledge.entry.saved", description: "A knowledge entry was saved" }],
  jobs: [{ name: "knowledge.reindex", description: "Rebuild the knowledge index" }],
  settingsSchema: {
    type: "object",
    additionalProperties: false,
    properties: { citationStyle: { type: "string" } },
  },
  planEntitlement: "knowledge",
});
