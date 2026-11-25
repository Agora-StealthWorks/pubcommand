import { platformCan, PLATFORM_PERMISSIONS } from "@pubcommand/core";
import Link from "next/link";
import { Denied } from "@/components/ui";
import { readSession, readStaff } from "@/lib/auth";
import { currentRequest } from "@/lib/request";

/** Usage: the dashboard, plus Activity, Audit and Jobs as tabs (they used to be sidebar items). */
export default async function UsageLayout({ children }: { children: React.ReactNode }) {
  const auth = await readSession();
  const staff = auth.user ? await readStaff(auth.user.id) : null;
  if (!staff) return <Denied />;
  const { pathname } = await currentRequest();
  const tabs = [
    { href: "/usage", label: "Dashboard", show: platformCan(staff.role, PLATFORM_PERMISSIONS.viewAudit), active: pathname === "/usage" },
    { href: "/usage/activity", label: "Activity", show: platformCan(staff.role, PLATFORM_PERMISSIONS.viewAudit), active: pathname.startsWith("/usage/activity") },
    { href: "/usage/audit", label: "Audit", show: platformCan(staff.role, PLATFORM_PERMISSIONS.viewAudit), active: pathname.startsWith("/usage/audit") },
    { href: "/usage/jobs", label: "Jobs", show: platformCan(staff.role, PLATFORM_PERMISSIONS.manageJobs), active: pathname.startsWith("/usage/jobs") },
  ].filter((tab) => tab.show);
  const brain = platformCan(staff.role, PLATFORM_PERMISSIONS.manageBrain);
  return (
    <div className="min-w-0">
      <nav className="mb-5 flex flex-wrap items-center gap-1 border-b border-line pb-2" aria-label="Usage">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={tab.active ? "page" : undefined}
            className={`inline-flex min-h-9 items-center rounded-md px-3 text-sm font-medium ${tab.active ? "bg-[#eef2ff] text-[#1e3a8a]" : "text-ink hover:bg-canvas"}`}
          >
            {tab.label}
          </Link>
        ))}
        {brain ? (
          <Link href="/brain/ops" className="ml-auto inline-flex min-h-9 items-center rounded-md border border-line bg-white px-3 text-sm font-medium hover:bg-canvas">
            Operations Brain →
          </Link>
        ) : null}
      </nav>
      {children}
    </div>
  );
}
