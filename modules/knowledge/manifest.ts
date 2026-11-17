import { defineModule } from "@pubcommand/core";

export const manifest = defineModule({
  id: "knowledge",
  slug: "knowledge",
  name: "Brain",
  description: "Each brand's Brain: notes, search, graph, attachments, Ask the Brain and vault import.",
  nav: [{ label: "Brain", href: "/knowledge", permission: "knowledge.read" }],
  routes: [
    { path: "/knowledge", title: "Brain" },
    { path: "/knowledge/ask", title: "Ask the Brain" },
    { path: "/knowledge/import", title: "Import a vault" },
    { path: "/knowledge/graph", title: "Graph" },
  ],
  permissions: [
    { key: "knowledge.read", description: "Read Brain notes" },
    { key: "knowledge.write", description: "Create, edit and import Brain notes" },
    { key: "knowledge.share", description: "Mark Brain notes Shared with the organization's other brands" },
  ],
  events: [{ name: "knowledge.entry.saved", description: "A Brain note was saved" }],
  jobs: [
    { name: "knowledge.import", description: "Import a Markdown vault into a Brain" },
    { name: "knowledge.learn-up", description: "Platform learning from app-taught notes" },
    { name: "knowledge.push-down", description: "Keep best-practice notes in brand Brains up to date" },
  ],
  settingsSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  planEntitlement: "knowledge",
});
