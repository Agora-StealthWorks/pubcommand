import { brandProfile } from "@pubcommand/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppThumbnail } from "@/components/app-thumbnail";
import { CATEGORY_ORDER, visibleApps, type VisibleApp } from "@/lib/apps";
import { getOrgContext } from "@/lib/org";

function AppCardLink({ app }: { app: VisibleApp }) {
  return (
    <Link
      href={app.href}
      className="group flex flex-col overflow-hidden rounded-xl border border-line bg-white transition-colors hover:border-accent"
    >
      <div className="border-b border-line">
        <AppThumbnail moduleId={app.moduleId} />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-center gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#eef2ff] text-xl"
            aria-hidden
          >
            {app.icon}
          </span>
          <h3 className="text-base font-semibold text-ink">{app.name}</h3>
        </div>
        <p className="flex-1 text-sm leading-relaxed text-muted">
          {app.description}
        </p>
        <span className="text-sm font-semibold text-accent group-hover:underline">
          Open →
        </span>
      </div>
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
  const apps = visibleApps(ctx.subject, ctx.scope, brandProfile({ name: ctx.brand?.name ?? "", niche: ctx.brand?.niche }).niche);
  const sections = CATEGORY_ORDER.map((category) => ({
    category,
    apps: apps.filter((app) => app.category === category),
  })).filter((section) => section.apps.length > 0);

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
          {sections
            .flatMap((section) => section.apps)
            .map((app) => (
              <AppCardLink key={app.moduleId} app={app} />
            ))}
        </div>
      )}
    </div>
  );
}
