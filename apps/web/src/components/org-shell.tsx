import type { AccessSubject } from "@pubcommand/core";
import { can } from "@pubcommand/core";
import { Badge } from "@pubcommand/ui";
import { moduleRegistry } from "@pubcommand/modules";
import Link from "next/link";
import { stopImpersonation } from "@/server/platform-actions";
import { setBrand } from "@/server/org-actions";
import { AppFrame } from "./app-frame";
import { CommandPalette, SearchForm } from "./command-palette";

type Brand = { id: string; name: string };

export function OrgShell({
  organization,
  brands,
  brand,
  orgLinks,
  subject,
  pathname,
  email,
  impersonating,
  children,
}: {
  organization: { id: string; name: string; slug: string };
  brands: Brand[];
  brand: Brand | null;
  orgLinks: { name: string; href: string; current: boolean }[];
  subject: AccessSubject;
  pathname: string;
  email: string;
  impersonating: { targetEmail: string } | null;
  children: React.ReactNode;
}) {
  const links = moduleRegistry.all().flatMap((manifest) => {
    if (!subject.entitledModuleIds.includes(manifest.planEntitlement)) return [];
    return manifest.nav
      .filter((item) => !item.permission || can(subject, item.permission, { organizationId: organization.id, brandId: subject.membershipBrandId ?? brand?.id ?? null }))
      .map((item) => ({ href: item.href, label: item.label }));
  });

  return (
    <div>
      <AppFrame
        banner={
          impersonating ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#f9dbaf] bg-[#fffaeb] px-4 py-2 text-sm text-[#93370d]">
              <p className="pc-break min-w-0">
                Impersonating {impersonating.targetEmail}. Actions are written to the platform audit log.
              </p>
              <form action={stopImpersonation}>
                <button className="inline-flex min-h-11 items-center font-semibold underline">End impersonation</button>
              </form>
            </div>
          ) : null
        }
        sidebar={
          <>
            <div className="border-b border-line px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">PubCommand</p>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">Organization</p>
              <ul className="mt-2 space-y-1">
                {orgLinks.map((link) => (
                  <li key={link.href}>
                    <a href={link.href} className={`block break-all py-1 text-sm font-semibold ${link.current ? "text-ink" : "text-accent"}`}>
                      {link.name}
                    </a>
                  </li>
                ))}
              </ul>
              <form action={setBrand} className="mt-3">
                <label className="block text-xs font-semibold text-muted">
                  Brand
                  <select name="brandId" defaultValue={brand?.id ?? ""} className="pc-control mt-1 w-full">
                    {brands.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="mt-2 inline-flex min-h-11 w-full items-center text-sm font-semibold text-accent">Switch brand</button>
              </form>
            </div>
            <nav className="px-2 py-3">
              <Link className={navClass(pathname === "/")} href="/">
                Overview
              </Link>
              {links.map((link) => (
                <Link key={link.href} className={navClass(pathname === link.href)} href={link.href}>
                  {link.label}
                </Link>
              ))}
            </nav>
          </>
        }
        header={
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <SearchForm />
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm sm:ml-auto">
              <Badge className="pc-break max-w-full" tone="accent">
                {organization.slug}
              </Badge>
              <span className="pc-break min-w-0 text-muted">{email}</span>
              <form action="/api/auth/logout" method="post">
                <button className="inline-flex min-h-11 items-center font-semibold text-accent">Log out</button>
              </form>
            </div>
          </div>
        }
      >
        {children}
      </AppFrame>
      <CommandPalette items={[{ label: "Overview", href: "/" }, { label: "Search", href: "/search" }, ...links]} />
    </div>
  );
}

function navClass(active: boolean) {
  return `flex min-h-11 items-center rounded-md px-3 text-sm font-medium ${active ? "bg-[#dbe7ff] text-[#1e3a8a]" : "text-ink hover:bg-canvas"}`;
}
