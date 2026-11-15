import { defineModule } from "@pubcommand/core";

export const manifest = defineModule({
  id: "forms",
  slug: "forms",
  name: "Forms",
  description: "Forms and funnels. Not implemented in Phase 1.",
  nav: [{ label: "Forms", href: "/forms", permission: "forms.read" }],
  routes: [{ path: "/forms", title: "Forms" }],
  permissions: [
    { key: "forms.read", description: "Read forms and responses" },
    { key: "forms.write", description: "Edit forms" },
    { key: "forms.export", description: "Export form responses" },
  ],
  events: [{ name: "forms.response.received", description: "A form response was received" }],
  jobs: [{ name: "forms.export", description: "Export form responses" }],
  settingsSchema: {
    type: "object",
    additionalProperties: false,
    properties: { doubleOptIn: { type: "boolean" } },
  },
  planEntitlement: "forms",
});
