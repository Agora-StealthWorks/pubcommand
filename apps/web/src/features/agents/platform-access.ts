import { readSession, readStaff, staffReady } from "@/lib/auth";
import { ensureConsoleOrganization } from "@/lib/console-workspace";
import { currentRequest } from "@/lib/request";

/** The signed-in SUPER_ADMIN on the admin host (ready session, 2FA when required), or null. Platform agents are theirs only. */
export async function superAdminCtx() {
  const request = await currentRequest();
  if (request.site.kind !== "admin") return null;
  const auth = await readSession();
  if (!auth.user || !auth.session) return null;
  const staff = await readStaff(auth.user.id);
  if (!staff || staff.role !== "SUPER_ADMIN" || !staffReady(staff, auth.session)) return null;
  return { userId: auth.user.id, email: auth.user.email, request, consoleOrganizationId: await ensureConsoleOrganization() };
}

