import type { Viewport } from "next";
import { brandMetadata, brandThemeColor } from "@/components/brand";
import { canAccessPlatformConsole } from "@pubcommand/core";
import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { readSession, readStaff, staffTwoFactorRequired } from "@/lib/auth";
import { currentRequest } from "@/lib/request";

export const dynamic = "force-dynamic";
/** PubCommand's favicon and icons on its own pages (public customer sites set their own). */
export const metadata = brandMetadata;
export const viewport: Viewport = { themeColor: brandThemeColor };


export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const request = await currentRequest();
  const auth = await readSession();
  if (!auth.user || !auth.session) redirect("/login");
  const staff = await readStaff(auth.user.id);
  if (!staff) {
    return (
      <main className="mx-auto max-w-lg px-6 py-20">
        <h1 className="text-2xl font-semibold">Platform staff only</h1>
        <p className="mt-2 text-sm text-muted">An organization role does not grant access to admin.{process.env.ROOT_DOMAIN}.</p>
      </main>
    );
  }
  const mfa = canAccessPlatformConsole({
    role: staff.role,
    disabled: false,
    totpConfirmed: staffTwoFactorRequired() ? Boolean(staff.totpConfirmedAt) : true,
    mfaVerified: auth.session.mfaVerified,
  });
  if (!mfa) {
    if (request.pathname !== "/2fa") redirect("/2fa");
    return <div className="min-h-screen bg-canvas">{children}</div>;
  }
  if (request.pathname === "/2fa") redirect("/");
  return (
    <AdminShell role={staff.role} email={auth.user.email} pathname={request.pathname}>
      {children}
    </AdminShell>
  );
}
