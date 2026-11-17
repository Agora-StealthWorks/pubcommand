import { defineModule } from "@pubcommand/core";

export const manifest = defineModule({
  id: "knowledge",
  slug: "knowledge",
  name: "Brain",
  description: "Each brand's mini-brain plus the main Brain: notes, search, Ask the Brain and vault import.",
  nav: [{ label: "Brain", href: "/knowledge", permission: "knowledge.read" }],
  routes: [
    { path: "/knowledge", title: "Brain" },
    { path: "/knowledge/ask", title: "Ask the Brain" },
    { path: "/knowledge/import", title: "Import a vault" },
  ],
  permissions: [
    { key: "knowledge.read", description: "Read Brain notes" },
    { key: "knowledge.write", description: "Create, edit and import Brain notes" },
    { key: "knowledge.share", description: "Mark Brain notes Shared with every brand" },
  ],
  events: [{ name: "knowledge.entry.saved", description: "A Brain note was saved" }],
  jobs: [{ name: "knowledge.import", description: "Import a Markdown vault into a Brain" }],
  settingsSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  planEntitlement: "knowledge",
});
