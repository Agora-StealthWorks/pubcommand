import { PLATFORM_PERMISSIONS, platformCan } from "@pubcommand/core";
import { redirect } from "next/navigation";
import { readSession, readStaff, staffReady } from "@/lib/auth";

export type IspyStaff = { userId: string; email: string; role: string };

/** For console pages: the signed-in staff member, if they may manage ISpy. */
export async function ispyStaff(): Promise<IspyStaff | null> {
  const auth = await readSession();
  if (!auth.user || !auth.session) return null;
  const staff = await readStaff(auth.user.id);
  if (!staff || !staffReady(staff, auth.session)) return null;
  if (!platformCan(staff.role, PLATFORM_PERMISSIONS.manageIspy)) return null;
  return { userId: auth.user.id, email: auth.user.email, role: staff.role };
}

/** For console server actions: same check, redirect when it fails. */
export async function requireIspyStaff(): Promise<IspyStaff> {
  const staff = await ispyStaff();
  if (!staff) redirect("/?error=You do not have permission to manage ISpy.");
  return staff;
}
