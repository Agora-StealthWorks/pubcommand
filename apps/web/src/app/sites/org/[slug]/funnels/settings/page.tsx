import { Button } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { Section } from "@/features/funnels/fields";
import { funnelsAccess } from "@/features/funnels/guard";
import { saveFunnelsSettings } from "@/features/funnels/tracking-actions";
import { loadFunnelsSettings } from "@/features/funnels/tracking-data";
import { TrackedParamsEditor } from "@/features/funnels/tracking-settings";

/** Funnels → Settings (funnels.publish): settings every funnel in the organization inherits. */
export default async function FunnelsSettingsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await funnelsAccess(slug, "funnels.publish");
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const settings = await loadFunnelsSettings(access.ctx.resolved.id);
  return (
    <div className="max-w-2xl">
      <Link href="/funnels" className="text-sm font-semibold text-accent">
        ← Launch funnels
      </Link>
      <PageHeader title="Funnels settings" description="Settings for every funnel and microsite in this organization, across all brands." />
      <Flash error={query.error} notice={query.notice} />
      <form action={saveFunnelsSettings} className="space-y-4">
        <Section
          title="Tracked URL parameters"
          description="When a visitor opens a funnel link with any of these in the address (for example ?utm_source=facebook), the values are kept with that visitor and recorded on their page views, clicks, email opt-ins and SMS sign-ups. Stats can then break results down by each parameter."
        >
          <TrackedParamsEditor initial={settings.trackedParams} />
        </Section>
        <Section title="Attribution" description="A visitor can arrive more than once from different links. Which values do they keep?">
          <fieldset className="space-y-3">
            <legend className="sr-only">Attribution</legend>
            {(
              [
                ["first", "First touch", "Keep the values from the first link they arrived with. Later links never change them."],
                ["last", "Last touch", "Replace them with the values from the newest link that carries any tracked parameter."],
              ] as const
            ).map(([value, label, hint]) => (
              <label key={value} className="flex items-start gap-2 text-sm">
                <input type="radio" name="attribution" value={value} defaultChecked={settings.attribution === value} className="mt-0.5 h-4 w-4 shrink-0 accent-accent" />
                <span>
                  <span className="font-semibold">{label}</span>
                  <span className="block text-xs text-muted">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="text-xs text-muted">Values are stored as they appear in the link (up to 200 characters each). Visitors who already have values keep them until a new link replaces them under last touch.</p>
        </Section>
        <Button type="submit" className="w-full sm:w-auto">
          Save settings
        </Button>
      </form>
    </div>
  );
}
