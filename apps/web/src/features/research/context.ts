import { can } from "@pubcommand/core";
import { tenantDb } from "@pubcommand/db";
import { getOrgContext } from "@/lib/org";
import { currentRequest } from "@/lib/request";
import { canEdit, canManage, canView, projectAccess, type ProjectAccess } from "../../../../../modules/research/access";

export type ResearchViewer = {
  organizationId: string;
  brandId: string;
  brand: { id: string; name: string; niche: string | null; audience: string | null; complianceNotes: string | null };
  userId: string;
  actorId: string;
  email: string;
  /** Workspace admins (settings.manage) see and manage every project. */
  isAdmin: boolean;
  canWrite: boolean;
  origin: string;
};

export type ResearchContext = { ok: true; viewer: ResearchViewer } | { ok: false; error: string; status: 403 | 404 };

/**
 * Every page, action and route starts here: the org must be entitled to
 * `research`, the viewer needs research.read (and research.write to change
 * anything), and there must be a current brand.
 */
export async function researchContext(slug?: string): Promise<ResearchContext> {
  const request = await currentRequest();
  if (request.site.kind !== "org") return { ok: false, error: "Open Research Extractor from your organization.", status: 404 };
  const ctx = await getOrgContext(slug ?? request.site.slug);
  if (ctx.kind !== "ok") return { ok: false, error: "You are not signed in to this organization.", status: 404 };
  if (!ctx.subject.entitledModuleIds.includes("research")) return { ok: false, error: "Research Extractor is turned off for this organization.", status: 403 };
  if (!can(ctx.subject, "research.read", ctx.scope)) return { ok: false, error: "You do not have access to Research Extractor.", status: 403 };
  if (!ctx.brand) return { ok: false, error: "Add a brand in Settings first.", status: 403 };
  const membership = await tenantDb(ctx.resolved.id).membership.findFirst({
    where: { userId: ctx.effectiveUserId },
    select: { user: { select: { email: true } } },
  });
  return {
    ok: true,
    viewer: {
      organizationId: ctx.resolved.id,
      brandId: ctx.brand.id,
      brand: ctx.brand,
      userId: ctx.effectiveUserId,
      actorId: ctx.auth.user.id,
      email: membership?.user.email ?? ctx.auth.user.email,
      isAdmin: can(ctx.subject, "settings.manage", ctx.scope),
      canWrite: can(ctx.subject, "research.write", ctx.scope),
      origin: request.origin,
    },
  };
}

export type LoadedProject = NonNullable<Awaited<ReturnType<typeof findProject>>>;

async function findProject(viewer: ResearchViewer, projectId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return null;
  return tenantDb(viewer.organizationId).researchProject.findFirst({
    where: { id: projectId, brandId: viewer.brandId, deletedAt: null },
    include: { shares: { orderBy: { createdAt: "asc" } } },
  });
}

/** Load a project in the current brand with the viewer's access, or null when they may not see it. */
export async function projectFor(viewer: ResearchViewer, projectId: string): Promise<{ project: LoadedProject; access: ProjectAccess } | null> {
  const project = await findProject(viewer, projectId);
  if (!project) return null;
  const access = projectAccess({
    ownerId: project.ownerId,
    viewerId: viewer.userId,
    viewerEmail: viewer.email,
    isAdmin: viewer.isAdmin,
    canWrite: viewer.canWrite,
    shares: project.shares,
  });
  return canView(access) ? { project, access } : null;
}

export { canEdit, canManage, canView };
