import { PLATFORM_PERMISSIONS, platformCan } from "@pubcommand/core";
import { rawPrisma } from "@pubcommand/db";
import { redirect } from "next/navigation";
import { NewOrganizationForm } from "@/components/organizations-console";
import { Flash } from "@/components/ui";
import { readSession, readStaff, rootDomain } from "@/lib/auth";
import { createOrganization } from "@/server/platform-actions";

export default async function NewOrganizationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const query = await searchParams;
  const auth = await readSession();
  const staff = auth.user ? await readStaff(auth.user.id) : null;
  if (!staff || !platformCan(staff.role, PLATFORM_PERMISSIONS.manageOrgs)) {
    redirect("/orgs?error=You do not have permission.");
  }
  const plans = await rawPrisma().plan.findMany({ orderBy: { seatLimit: "asc" }, select: { id: true, name: true } });
  return (
    <div>
      <Flash error={query.error} notice={query.notice} />
      <NewOrganizationForm action={createOrganization} plans={plans} rootDomain={rootDomain()} />
    </div>
  );
}
