import { PLATFORM_PERMISSIONS, can, platformCan } from "@pubcommand/core";
import { slugAvailability } from "@pubcommand/db";
import { readSession, readStaff } from "@/lib/auth";
import { getOrgContext } from "@/lib/org";
import { currentRequest } from "@/lib/request";

export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("slug") ?? "";
  const auth = await readSession();
  if (!auth.user) return Response.json({ available: false, reason: "unauthorized" }, { status: 401 });
  const site = await currentRequest();
  if (site.site.kind === "org") {
    const ctx = await getOrgContext(site.site.slug);
    const allowed =
      ctx.kind === "ok" && can(ctx.subject, "settings.manage", { organizationId: ctx.resolved.id, brandId: ctx.scope.brandId });
    const staff = await readStaff(auth.user.id);
    if (!allowed && !(staff && platformCan(staff.role, PLATFORM_PERMISSIONS.manageDomains))) {
      return Response.json({ available: false, reason: "forbidden" }, { status: 403 });
    }
    const currentId = ctx.kind === "ok" ? ctx.resolved.id : undefined;
    return Response.json(await slugAvailability(slug, currentId));
  }
  const staff = await readStaff(auth.user.id);
  if (!staff || !platformCan(staff.role, PLATFORM_PERMISSIONS.manageDomains)) {
    return Response.json({ available: false, reason: "forbidden" }, { status: 403 });
  }
  return Response.json(await slugAvailability(slug));
}
