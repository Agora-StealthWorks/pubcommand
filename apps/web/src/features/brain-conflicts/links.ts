import { PLATFORM_PERMISSIONS, platformCan } from "@pubcommand/core";
import { rawPrisma } from "@pubcommand/db";
import { siteUrl } from "@/lib/request";

/**
 * Where an organization's admins fix a fact: the entity's page in Publication
 * Setup on the org host. The console never edits org data itself; staff who are
 * not members open it through the existing impersonation flow.
 */
export async function setupUrl(input: { organizationSlug: string; kind: string; id: string }): Promise<string> {
  const path = input.kind === "editor" ? `/settings/publication-setup/editors/${input.id}` : `/settings/publication-setup/publications/${input.id}`;
  return siteUrl({ kind: "org", slug: input.organizationSlug }, path);
}

/** Active members who can manage Publication Setup (owner/admin roles), for the impersonation picker. */
export async function setupAdmins(organizationId: string, staffRole: string): Promise<{ email: string; name: string | null; role: string }[] | null> {
  if (!platformCan(staffRole as Parameters<typeof platformCan>[0], PLATFORM_PERMISSIONS.impersonate)) return null;
  const rows = await rawPrisma().membership.findMany({
    where: { organizationId, status: "ACTIVE" },
    select: { user: { select: { email: true, name: true } }, role: { select: { name: true } } },
    take: 200,
  });
  return rows
    .map((row) => ({ email: row.user.email, name: row.user.name, role: row.role.name }))
    .sort((a, b) => Number(/owner|admin/i.test(b.role)) - Number(/owner|admin/i.test(a.role)) || a.email.localeCompare(b.email));
}
