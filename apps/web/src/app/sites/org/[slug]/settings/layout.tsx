import Link from "next/link";
import { notFound } from "next/navigation";
import { readStaff, rootDomain } from "@/lib/auth";
import { getOrgContext } from "@/lib/org";
import { currentRequest } from "@/lib/request";
import { buildSiteUrl } from "@pubcommand/core";

const TABS = [
  { href: "/settings", label: "General" },
  { href: "/settings/users", label: "Users" },
  { href: "/settings/roles", label: "Roles & access" },
  { href: "/settings/brands", label: "Brands" },
  { href: "/settings/modules", label: "Apps" },
  { href: "/settings/audit", label: "Activity" },
];

export default async function SettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  const request = await currentRequest();
  const staff = await readStaff(ctx.auth.user.id);
  const consoleHref = staff
    ? buildSiteUrl({ rootDomain: rootDomain(), requestHost: request.host, site: { kind: "admin" }, pathname: "/" })
    : null;
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-line">
        <nav className="-mb-px flex flex-wrap gap-1" aria-label="Settings">
          {TABS.map((tab) => {
            const active = request.pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium ${
                  active ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
        {consoleHref ? (
          <a href={consoleHref} className="mb-2 text-sm font-medium text-muted hover:text-ink">
            Platform console ↗
          </a>
        ) : null}
      </div>
      {children}
    </div>
  );
}
