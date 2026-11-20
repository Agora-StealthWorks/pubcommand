import { defineModule } from "@pubcommand/core";

export const manifest = defineModule({
  id: "pubsetup",
  slug: "pubsetup",
  name: "Publication Setup",
  description: "Admins add each publication, its editors and its branding once; every other app reads it from here.",
  nav: [{ label: "Publication Setup", href: "/settings/publication-setup", permission: "pubsetup.manage" }],
  routes: [
    { path: "/settings/publication-setup", title: "Publications" },
    { path: "/settings/publication-setup/publications/:id", title: "Publication" },
    { path: "/settings/publication-setup/publications/:id/branding", title: "Publication branding" },
    { path: "/settings/publication-setup/editors", title: "Editors" },
    { path: "/settings/publication-setup/editors/:id", title: "Editor" },
    { path: "/settings/publication-setup/brand", title: "Brand defaults" },
  ],
  permissions: [{ key: "pubsetup.manage", description: "Add and edit publications, editors and branding (admins only)", access: "admin" }],
  events: [],
  jobs: [],
  settingsSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  planEntitlement: "pubsetup",
});
