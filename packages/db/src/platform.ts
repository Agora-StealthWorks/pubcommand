import type { Prisma } from "@prisma/client";
import { validateSlug } from "@pubcommand/core";
import { getPrisma, rawPrisma } from "./client";

export async function appendPlatformAudit(entry: {
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Prisma.InputJsonValue;
}): Promise<void> {
  await getPrisma().platformAuditLog.create({
    data: {
      actorId: entry.actorId ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      metadata: entry.metadata,
    },
  });
}

export type ResolvedOrganization = {
  id: string;
  name: string;
  slug: string;
  suspendedAt: Date | null;
  redirected: boolean;
};

export async function resolveOrgBySlug(slug: string): Promise<ResolvedOrganization | null> {
  const rows = await rawPrisma().$queryRaw<
    Array<{ id: string; name: string; slug: string; suspended_at: Date | null; redirected: boolean }>
  >`SELECT id, name, slug, suspended_at, redirected FROM public.resolve_org_slug(${slug})`;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    suspendedAt: row.suspended_at,
    redirected: row.redirected,
  };
}

export async function slugAvailability(input: string, currentOrganizationId?: string) {
  const parsed = validateSlug(input);
  if (!parsed.ok) return { slug: input.trim().toLowerCase(), available: false as const, reason: parsed.reason };
  const current = await rawPrisma().organization.findUnique({ where: { slug: parsed.slug } });
  if (current && current.id !== currentOrganizationId) {
    return { slug: parsed.slug, available: false as const, reason: "taken" as const };
  }
  const history = await rawPrisma().organizationSlugHistory.findUnique({ where: { slug: parsed.slug } });
  if (history) return { slug: parsed.slug, available: false as const, reason: "history" as const };
  if (current && current.id === currentOrganizationId) {
    return { slug: parsed.slug, available: true as const, reason: "unchanged" as const };
  }
  return { slug: parsed.slug, available: true as const, reason: "available" as const };
}

export async function changeOrganizationSlug(organizationId: string, nextSlug: string) {
  const parsed = validateSlug(nextSlug);
  if (!parsed.ok) throw new Error(parsed.reason === "reserved" ? "That slug is reserved." : "Enter 3-40 lowercase letters, numbers, or hyphens.");
  return rawPrisma().$transaction(async (tx) => {
    const organization = await tx.organization.findUnique({ where: { id: organizationId } });
    if (!organization) throw new Error("Organization not found.");
    if (organization.slug === parsed.slug) return organization;
    const taken = await tx.organization.findUnique({ where: { slug: parsed.slug } });
    if (taken) throw new Error("That slug is already in use.");
    const history = await tx.organizationSlugHistory.findUnique({ where: { slug: parsed.slug } });
    if (history) throw new Error("That slug was used before and still redirects.");
    await tx.organization.update({ where: { id: organizationId }, data: { slug: parsed.slug } });
    await tx.organizationSlugHistory.create({
      data: { organizationId, slug: organization.slug },
    });
    return tx.organization.findUniqueOrThrow({ where: { id: organizationId } });
  });
}
