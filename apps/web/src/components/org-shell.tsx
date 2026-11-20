import type { AccessSubject } from "@pubcommand/core";
import { brandProfile, can } from "@pubcommand/core";
import Link from "next/link";
import { appForPath, CATEGORY_ORDER, visibleApps } from "@/lib/apps";
import { canManagePublications } from "@/features/pubsetup/module";
import { stopImpersonation } from "@/server/platform-actions";
import { AppFrame } from "./app-frame";
import { BrandSwitcher } from "./brand-switcher";
import { CommandPalette } from "./command-palette";

type Brand = { id: string; name: string; niche?: string | null };

/**
 * Sidebar with the apps grouped by area, and one Settings link at the bottom.
 * Everything administrative lives under Settings.
 */
export function OrgShell({
  organization,
  brands,
  brand,
  subject,
  pathname,
  email,
  impersonating,
  children,
}: {
  organization: { id: string; name: string; slug: string };
  brands: Brand[];
  brand: Brand | null;
  subject: AccessSubject;
  pathname: string;
  email: string;
  impersonating: { targetEmail: string } | null;
  children: React.ReactNode;
}) {
  const scope = { organizationId: organization.id, brandId: subject.membershipBrandId ?? brand?.id ?? null };
  const apps = visibleApps(subject, scope, brandProfile({ name: brand?.name ?? "", niche: brand?.niche }).niche);
  const current = appForPath(apps, pathname);
  const inSettings = pathname === "/settings" || pathname.startsWith("/settings/");
  const canSettings = can(subject, "settings.manage", scope);
  // Publication Setup lives under Settings; publication admins without settings.manage land straight on it.
  const canPublications = subject.entitledModuleIds.includes("pubsetup") && canManagePublications(subject, scope);
  const settingsHref = canSettings ? "/settings" : "/settings/publication-setup";
  const showSettings = canSettings || canPublications;
  const groups = CATEGORY_ORDER.map((category) => ({ category, apps: apps.filter((app) => app.category === category) })).filter(
    (group) => group.apps.length > 0,
  );

  const sidebar = (
    <div className="flex min-h-full flex-col">
      <div className="space-y-3 px-4 py-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-sm font-bold text-white">P</span>
          <span className="text-base font-semibold">PubCommand</span>
        </Link>
        <div className="rounded-lg border border-line px-2 py-1.5">
          <p className="px-1 text-[11px] font-medium text-muted">Brand</p>
          <BrandSwitcher brands={brands} current={brand?.id ?? null} />
        </div>
      </div>
      <nav className="flex-1 px-2 pb-4" aria-label="Apps">
        <Link className={navClass(pathname === "/")} href="/">
          <span aria-hidden className="w-5 text-center">
            🏠
          </span>
          Dashboard
        </Link>
        {groups.map((group) => (
          <div key={group.category} className="mt-4">
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{group.category}</p>
            {group.apps.map((app) => (
              <Link key={app.moduleId} className={navClass(current?.moduleId === app.moduleId)} href={app.href}>
                <span aria-hidden className="w-5 text-center">
                  {app.icon}
                </span>
                {app.name}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="border-t border-line px-2 py-3">
        {showSettings ? (
          <Link className={navClass(inSettings)} href={settingsHref}>
            <span aria-hidden className="w-5 text-center">
              ⚙️
            </span>
            Settings
          </Link>
        ) : null}
        <div className="mt-2 flex items-center justify-between gap-2 px-3">
          <span className="truncate text-xs text-muted">{email}</span>
          <form action="/api/auth/logout" method="post">
            <button className="inline-flex min-h-9 items-center whitespace-nowrap text-xs font-semibold text-muted hover:text-ink">Sign out</button>
          </form>
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <AppFrame
        banner={
          impersonating ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#f9dbaf] bg-[#fffaeb] px-4 py-2 text-sm text-[#93370d]">
              <p className="pc-break min-w-0">Viewing as {impersonating.targetEmail}.</p>
              <form action={stopImpersonation}>
                <button className="inline-flex min-h-11 items-center font-semibold underline">Stop</button>
              </form>
            </div>
          ) : null
        }
        sidebar={sidebar}
        header={
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-semibold">
              {current ? current.name : inSettings ? "Settings" : "Dashboard"}
            </p>
            <span className="ml-auto hidden text-xs text-muted sm:inline">⌘K to jump</span>
          </div>
        }
      >
        {children}
      </AppFrame>
      <CommandPalette
        items={[
          { label: "Dashboard", href: "/" },
          ...apps.map((app) => ({ label: app.name, href: app.href })),
          ...(showSettings ? [{ label: "Settings", href: settingsHref }] : []),
          ...(canPublications ? [{ label: "Publication Setup", href: "/settings/publication-setup" }] : []),
        ]}
      />
    </div>
  );
}

function navClass(active: boolean) {
  return `flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-medium ${
    active ? "bg-[#e0e7ff] text-[#1e3a8a]" : "text-ink hover:bg-canvas"
  }`;
}
