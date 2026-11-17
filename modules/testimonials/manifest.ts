import { defineModule } from "@pubcommand/core";

export const manifest = defineModule({
  id: "testimonials",
  slug: "testimonials",
  name: "Testimonials",
  description: "Collect reader testimonials per publication, review them against the brand's compliance rules, and show approved ones in the wiki.",
  nav: [{ label: "Testimonials", href: "/testimonials", permission: "testimonials.read" }],
  routes: [
    { path: "/testimonials", title: "Testimonials" },
    { path: "/testimonials/new", title: "Add testimonial" },
    { path: "/testimonials/:id", title: "Testimonial" },
    { path: "/testimonials/publication/:ref", title: "Publication testimonials" },
    { path: "/testimonials/capture", title: "Capture links" },
  ],
  permissions: [
    { key: "testimonials.read", description: "See testimonials, saved views and exports" },
    { key: "testimonials.write", description: "Add and edit testimonials and saved views" },
    { key: "testimonials.approve", description: "Approve or reject testimonials and manage public capture links" },
  ],
  events: [],
  jobs: [],
  settingsSchema: { type: "object", additionalProperties: false, properties: {} },
  planEntitlement: "testimonials",
});
