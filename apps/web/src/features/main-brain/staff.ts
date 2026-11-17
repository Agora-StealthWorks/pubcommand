import { PLATFORM_PERMISSIONS, platformCan } from "@pubcommand/core";
import { redirect } from "next/navigation";
import { readSession, readStaff, staffReady } from "@/lib/auth";

export type BrainStaff = { userId: string; email: string; role: string };

/** For console pages: the signed-in staff member, if they may use the main Brain. */
export async function brainStaff(): Promise<BrainStaff | null> {
  const auth = await readSession();
  if (!auth.user || !auth.session) return null;
  const staff = await readStaff(auth.user.id);
  if (!staff || !staffReady(staff, auth.session)) return null;
  if (!platformCan(staff.role, PLATFORM_PERMISSIONS.manageBrain)) return null;
  return { userId: auth.user.id, email: auth.user.email, role: staff.role };
}

/** For console server actions and routes: same check, redirect when it fails. */
export async function requireBrainStaff(): Promise<BrainStaff> {
  const staff = await brainStaff();
  if (!staff) redirect("/?error=You do not have permission to use the main Brain.");
  return staff;
}
