import { defineModule } from "@pubcommand/core";

export const manifest = defineModule({
  id: "settings",
  slug: "settings",
  name: "Settings",
  description: "Organization settings, people, roles, entitlements, and the audit log.",
  nav: [
    { label: "Settings", href: "/settings", permission: "settings.manage" },
    { label: "Users", href: "/settings/users", permission: "settings.users.manage" },
    { label: "Roles", href: "/settings/roles", permission: "settings.roles.manage" },
    { label: "Modules", href: "/settings/modules", permission: "settings.modules.manage" },
    { label: "Audit", href: "/settings/audit", permission: "settings.audit.read" },
    { label: "Domains", href: "/settings/domains", permission: "domains.manage" },
  ],
  routes: [
    { path: "/settings", title: "Organization settings" },
    { path: "/settings/users", title: "Users" },
    { path: "/settings/roles", title: "Roles" },
    { path: "/settings/modules", title: "Modules" },
    { path: "/settings/audit", title: "Audit log" },
    { path: "/settings/domains", title: "Custom domains" },
  ],
  permissions: [
    { key: "settings.manage", description: "Update organization settings and the public slug", access: "admin" },
    { key: "settings.users.manage", description: "Invite and review organization users", access: "admin" },
    { key: "settings.roles.manage", description: "Build roles and grant permissions", access: "admin" },
    { key: "settings.modules.manage", description: "Enable modules the plan includes", access: "admin" },
    { key: "settings.audit.read", description: "Read the organization audit log", access: "admin" },
    {
      key: "domains.manage",
      description: "Buy domains (non-refundable charges), connect custom domains to public pages, and remove them",
      access: "admin",
    },
  ],
  events: [{ name: "settings.slug.changed", description: "The organization slug changed" }],
  jobs: [],
  settingsSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      displayName: { type: "string" },
      timezone: { type: "string" },
      supportEmail: { type: "string" },
    },
  },
  planEntitlement: "settings",
});
