import { can } from "@pubcommand/core";
import Link from "next/link";
import { manifest } from "../../../../../../../../modules/websites/manifest";
import { getOrgContext } from "@/lib/org";
import { currentRequest } from "@/lib/request";

/** The Websites app's own menu, on every Websites page: grouped, and only what this person may open. */
const GROUPS: { label: string; hrefs: string[] }[] = [
  { label: "Content", hrefs: ["/websites/posts", "/websites/pages", "/websites/media", "/websites/terms"] },
  { label: "Audience", hrefs: ["/websites/members", "/websites/products", "/websites/signups"] },
  { label: "Site", hrefs: ["/websites/homepage", "/websites/menus", "/websites/settings"] },
];

export default async function WebsitesLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") return children;
  const { pathname } = await currentRequest();
  const allowed = manifest.nav.filter((item) => !item.permission || can(ctx.subject, item.permission, ctx.scope));
  const label = (href: string) => allowed.find((item) => item.href === href)?.label;
  const groups = GROUPS.map((group) => ({ label: group.label, items: group.hrefs.filter((href) => label(href)).map((href) => ({ href, label: label(href)! })) })).filter((group) => group.items.length);
  if (!groups.length) return children;
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  return (
    <div className="min-w-0">
      <nav aria-label="Websites" className="mb-5 flex flex-wrap gap-x-6 gap-y-1 border-b border-line pb-2">
        <Link href="/websites" className={`inline-flex min-h-10 shrink-0 items-center text-sm font-semibold ${pathname === "/websites" ? "text-accent" : "text-ink hover:text-accent"}`}>
          Overview
        </Link>
        {groups.map((group) => (
          <div key={group.label} className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{group.label}</span>
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`inline-flex min-h-10 items-center rounded-md px-2.5 text-sm ${active(item.href) ? "bg-[#e0e7ff] font-semibold text-[#1e3a8a]" : "text-ink hover:bg-canvas"}`}
              >
                {item.label === "Site settings" ? "Settings" : item.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      {children}
    </div>
  );
}
