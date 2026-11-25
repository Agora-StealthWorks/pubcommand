import { defineModule } from "@pubcommand/core";

export const manifest = defineModule({
  id: "miniblog",
  slug: "miniblog",
  name: "Mini-Blog",
  description: "Small public blogs (T-Letters) per brand: themes, latest post, archive, post pages, ad zones, a stat engine and a subscribe page for the medium (Email, SMS, Push Notification).",
  nav: [{ label: "Mini-Blog", href: "/mini-blog", permission: "miniblog.read" }],
  routes: [{ path: "/mini-blog", title: "Mini-Blogs" }],
  permissions: [
    { key: "miniblog.read", description: "See Mini-Blogs, their posts and subscriber counts" },
    { key: "miniblog.write", description: "Create and edit Mini-Blogs and write posts" },
    { key: "miniblog.publish", description: "Publish and unpublish posts" },
    { key: "miniblog.manage", description: "Take Mini-Blogs live, delete and restore them, edit ad codes and app settings (mediums) and export opt-ins", access: "admin" },
  ],
  events: [{ name: "miniblog.post.published", description: "A Mini-Blog post was published" }],
  jobs: [],
  settingsSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  planEntitlement: "miniblog",
});
