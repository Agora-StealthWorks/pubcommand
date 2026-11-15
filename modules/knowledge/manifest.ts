import { defineModule } from "@pubcommand/core";

export const manifest = defineModule({
  id: "knowledge",
  slug: "knowledge",
  name: "Knowledge",
  description: "Shared knowledge base. Not implemented in Phase 1.",
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
