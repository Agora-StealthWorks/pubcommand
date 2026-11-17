import { defineModule } from "@pubcommand/core";

export const manifest = defineModule({
  id: "support",
  slug: "support",
  name: "Support Knowledge",
  description: "What your customer support agents may say: customer-safe records, agent keys and guides, ElevenLabs sync and a gaps queue.",
  nav: [{ label: "Support Knowledge", href: "/support", permission: "support.read" }],
  routes: [
    { path: "/support", title: "Records" },
    { path: "/support/records/:id", title: "Record" },
    { path: "/support/sources", title: "Sources" },
    { path: "/support/agents", title: "Agents" },
    { path: "/support/agents/:id", title: "Agent" },
    { path: "/support/gaps", title: "Gaps" },
  ],
  permissions: [
    { key: "support.read", description: "Read support knowledge, agents and gaps" },
    { key: "support.write", description: "Draft support records, import sources and record gaps" },
    { key: "support.publish", description: "Publish support records, confirm prices and manage agent keys and platform sync" },
  ],
  events: [],
  jobs: [
    { name: "support.pubsetup-sync", description: "Keep publication and editor records in step with Publication Setup" },
    { name: "support.platform-sync", description: "Push changed knowledge to ElevenLabs agents and pull edits made there" },
    { name: "support.website-sheet", description: "Re-import the website directory from its linked sheet" },
  ],
  settingsSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  planEntitlement: "support",
});
