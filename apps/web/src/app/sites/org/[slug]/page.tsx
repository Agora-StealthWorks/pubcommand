import { brandProfile } from "@pubcommand/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppCardTile } from "@/components/app-card";
import { loadAppCardSettings } from "@/features/app-cards/store";
import { dashboardCards, visibleApps } from "@/lib/apps";
import { getOrgContext } from "@/lib/org";

type DashboardCard = ReturnType<typeof dashboardCards>[number];

function AppCardLink({ app }: { app: DashboardCard }) {
  return (
    <Link
      href={app.href}
      className="group flex flex-col overflow-hidden rounded-xl border border-line bg-white transition-colors hover:border-accent focus-visible:border-accent"
    >
      <AppCardTile moduleId={app.moduleId} name={app.name} image={app.image} />
    </Link>
  );
}

export default async function Dashboard({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  // Staff choose which apps have a card, their names, artwork and order (Admin → App cards).
  // Only apps this organization has, and this person may open, are listed.
  const settings = await loadAppCardSettings();
  const apps = dashboardCards(visibleApps(ctx.subject, ctx.scope, brandProfile({ name: ctx.brand?.name ?? "", niche: ctx.brand?.niche }).niche, settings), settings);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {ctx.brand?.name ?? ctx.resolved.name}
        </h1>
        <p className="mt-1 text-sm text-muted">
          Pick an app. Switch publishers with the brand menu in the sidebar.
        </p>
      </header>
      {apps.length === 0 ? (
        <div className="rounded-xl border border-line bg-white py-16 text-center">
          <p className="font-medium">No apps turned on yet</p>
          <p className="mt-1 text-sm text-muted">
            Ask an admin to turn apps on in Settings.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {apps.map((app) => (
            <AppCardLink key={app.moduleId} app={app} />
          ))}
        </div>
      )}
    </div>
  );
}
