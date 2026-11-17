import { defineModule } from "@pubcommand/core";

export const manifest = defineModule({
  id: "wiki",
  slug: "wiki",
  name: "Wiki",
  description: "Every publication and editor, with branding, offers and approved testimonials. Read-only; Publication Setup is the source.",
  nav: [{ label: "Wiki", href: "/wiki", permission: "wiki.read" }],
  routes: [
    { path: "/wiki", title: "Wiki" },
    { path: "/wiki/publications", title: "Publications" },
    { path: "/wiki/publications/:ref", title: "Publication" },
    { path: "/wiki/editors", title: "Editors" },
    { path: "/wiki/editors/:ref", title: "Editor" },
  ],
  permissions: [{ key: "wiki.read", description: "Read the wiki (publications, editors, approved testimonials)" }],
  events: [],
  jobs: [],
  settingsSchema: { type: "object", additionalProperties: false, properties: {} },
  planEntitlement: "wiki",
});
