import { defineModule } from "@pubcommand/core";

/**
 * Websites: a WordPress-style CMS for a brand's public website and its members-only site.
 * The first nav item is the app link in the sidebar; the rest are its sub-menu
 * (shown under the app while it is open).
 */
export const manifest = defineModule({
  id: "websites",
  slug: "websites",
  name: "Websites",
  description: "Public websites and members-only sites: posts, pages, media, categories, free sign-ups, members and access.",
  nav: [
    { label: "Websites", href: "/websites", permission: "websites.read" },
    { label: "Posts", href: "/websites/posts", permission: "websites.read" },
    { label: "Add new post", href: "/websites/posts/new", permission: "websites.write" },
    { label: "Pages", href: "/websites/pages", permission: "websites.read" },
    { label: "Media", href: "/websites/media", permission: "websites.read" },
    { label: "Categories & tags", href: "/websites/terms", permission: "websites.write" },
    { label: "Members", href: "/websites/members", permission: "websites.members" },
    { label: "Products & access", href: "/websites/products", permission: "websites.members" },
    { label: "Free sign-ups", href: "/websites/signups", permission: "websites.members" },
    { label: "Homepage", href: "/websites/homepage", permission: "websites.settings" },
    { label: "Menus", href: "/websites/menus", permission: "websites.settings" },
    { label: "Site settings", href: "/websites/settings", permission: "websites.settings" },
  ],
  routes: [{ path: "/websites", title: "Websites" }],
  permissions: [
    { key: "websites.read", description: "See websites, posts, pages and media" },
    { key: "websites.write", description: "Write and edit posts and pages, upload media, manage categories and tags" },
    { key: "websites.publish", description: "Publish, schedule and unpublish posts and pages" },
    { key: "websites.settings", description: "Create sites, change site settings, the homepage and menus, take a site live, and manage API keys", access: "admin" },
    { key: "websites.members", description: "Manage website members, products, access and free sign-ups (contains reader emails)" },
  ],
  events: [{ name: "websites.post.published", description: "A website post or page was published" }],
  jobs: [],
  settingsSchema: { type: "object", additionalProperties: false, properties: {} },
  planEntitlement: "websites",
});
