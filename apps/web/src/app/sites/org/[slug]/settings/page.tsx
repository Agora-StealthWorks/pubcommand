import { can } from "@pubcommand/core";
import { Button, Input, Label } from "@pubcommand/ui";
import { tenantDb } from "@pubcommand/db";
import { notFound } from "next/navigation";
import { SlugField } from "@/components/slug-field";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { getOrgContext } from "@/lib/org";
import { updateSettings, updateSlug } from "@/server/org-actions";

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  if (!can(ctx.subject, "settings.manage", ctx.scope)) return <Denied />;
  const settings = await tenantDb(ctx.resolved.id).orgSettings.findUnique({ where: { organizationId: ctx.resolved.id } });
  return (
    <div className="max-w-xl">
      <PageHeader title="Organization settings" description="The public slug is the subdomain. Old slugs keep redirecting." />
      <Flash error={query.error} notice={query.notice} />
      <form action={updateSettings} className="space-y-3 rounded-lg border border-line bg-white p-5">
        <Label htmlFor="displayName">Display name</Label>
        <Input id="displayName" name="displayName" defaultValue={settings?.displayName ?? ctx.resolved.name} />
        <Label htmlFor="timezone">Timezone</Label>
        <Input id="timezone" name="timezone" defaultValue={settings?.timezone ?? "America/New_York"} />
        <Label htmlFor="supportEmail">Support email</Label>
        <Input id="supportEmail" name="supportEmail" defaultValue={settings?.supportEmail ?? ""} />
        <Button type="submit">Save settings</Button>
      </form>
      <form action={updateSlug} className="mt-6 space-y-3 rounded-lg border border-line bg-white p-5">
        <SlugField current={ctx.resolved.slug} />
        <Button type="submit" variant="secondary">Change slug</Button>
      </form>
    </div>
  );
}
