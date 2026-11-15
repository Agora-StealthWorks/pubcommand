import { platformCan, PLATFORM_PERMISSIONS, type PlatformRole } from "@pubcommand/core";
import Link from "next/link";

const links: { href: string; label: string; permissions: string[] }[] = [
  { href: "/", label: "Overview", permissions: [PLATFORM_PERMISSIONS.viewOrgs] },
  { href: "/orgs", label: "Organizations", permissions: [PLATFORM_PERMISSIONS.viewOrgs] },
  { href: "/users", label: "Users", permissions: [PLATFORM_PERMISSIONS.viewUsers] },
  { href: "/plans", label: "Plans", permissions: [PLATFORM_PERMISSIONS.managePlans, PLATFORM_PERMISSIONS.manageModules] },
  { href: "/domains", label: "Domains", permissions: [PLATFORM_PERMISSIONS.manageDomains] },
  { href: "/staff", label: "Staff", permissions: [PLATFORM_PERMISSIONS.manageStaff] },
  { href: "/audit", label: "Audit", permissions: [PLATFORM_PERMISSIONS.viewAudit] },
];

export function AdminShell({
  role,
  email,
  pathname,
  children,
}: {
  role: PlatformRole;
  email: string;
  pathname: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-canvas text-ink md:grid md:grid-cols-[220px_1fr]">
      <aside className="border-r border-line bg-white px-3 py-4">
        <p className="px-2 text-xs font-semibold uppercase tracking-wide text-muted">Platform</p>
        <p className="px-2 text-lg font-semibold">PubCommand</p>
        <nav className="mt-4">
          {links.filter((link) => link.permissions.some((permission) => platformCan(role, permission))).map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`block rounded-md px-3 py-2 text-sm font-medium ${pathname === link.href ? "bg-[#dbe7ff] text-[#1e3a8a]" : "hover:bg-canvas"}`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div>
        <header className="flex h-14 items-center justify-between border-b border-line bg-white px-5 text-sm">
          <span className="font-semibold">admin console</span>
          <span className="text-muted">{email} · {role}</span>
        </header>
        <main className="px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
