import { can } from "@pubcommand/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied } from "@/components/ui";
import { getOrgContext } from "@/lib/org";
import { currentRequest } from "@/lib/request";
import { showsTickers } from "@/features/calendar/tickers";

const TABS = [
  ["/editorial", "List"],
  ["/editorial/calendar", "Calendar"],
  ["/editorial/timeline", "Timeline"],
  ["/editorial/analytics", "Analytics"],
  ["/editorial/whats-working", "What's Working"],
  ["/editorial/stats", "Send stats"],
  ["/editorial/promos", "Promos"],
  ["/editorial/cub", "CUB Collector"],
  ["/editorial/tickers", "Tickers"],
  ["/editorial/setup", "Setup"],
] as const;

function activeTab(pathname: string): string {
  if (pathname.startsWith("/editorial/events") || pathname.startsWith("/editorial/issues")) return "/editorial";
  const match = TABS.filter(([href]) => href !== "/editorial" && pathname.startsWith(href)).map(([href]) => href)[0];
  return match ?? "/editorial";
}

export default async function MarketingCalendarLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  if (!ctx.subject.entitledModuleIds.includes("editorial")) return <Denied title="Marketing Calendar is turned off" />;
  if (!can(ctx.subject, "editorial.read", ctx.scope)) return <Denied />;
  if (!ctx.brand) return <Denied title="Add a brand in Settings → Brands first" />;
  const request = await currentRequest();
  const active = activeTab(request.pathname);
  const writable = can(ctx.subject, "editorial.write", ctx.scope);
  // Tickers is a finance-brand view.
  const brand = ctx.brand;
  const tabs = TABS.filter(([href]) => href !== "/editorial/tickers" || showsTickers(brand));

  return (
    <div className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Marketing Calendar</h1>
          <p className="text-sm text-muted">Events, issues and send stats for {ctx.brand.name}.</p>
        </div>
        {writable ? (
          <div className="flex gap-2">
            <Link href="/editorial/events/new" className="inline-flex min-h-11 items-center rounded-md bg-accent px-3 text-sm font-semibold text-white">
              + Event
            </Link>
            <Link href="/editorial/issues/new" className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold hover:bg-canvas">
              + Issue
            </Link>
          </div>
        ) : null}
      </div>
      <nav className="-mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-line" aria-label="Marketing Calendar sections">
        {tabs.map(([href, label]) => (
          <Link
            key={href}
            href={href}
            className={`inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm font-medium ${active === href ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
