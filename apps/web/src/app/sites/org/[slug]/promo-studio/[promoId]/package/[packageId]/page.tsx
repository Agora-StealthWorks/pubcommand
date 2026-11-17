import { Badge, Button, Input, Label } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { packagerAccess } from "@/features/packager/access";
import { addComponents, approvePackage, deletePackage, reopenPackage, retryFailed, updatePackage } from "@/features/packager/actions";
import { loadPackage } from "@/features/packager/data";
import { ComponentPicker, DirectionFields, FlagSummary, GenBadge, StatusBadge } from "@/features/packager/views";
import { AutoRefresh } from "@/features/promos/auto-refresh";
import { preview } from "../../../../../../../../../../../modules/promo-studio/packager";

export default async function PackagePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; promoId: string; packageId: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { slug, promoId, packageId } = await params;
  const query = await searchParams;
  const access = await packagerAccess(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, writable, approver } = access;
  const loaded = await loadPackage(ctx.resolved.id, ctx.brand.id, promoId, packageId);
  if (!loaded) notFound();
  const { pkg, promo, components } = loaded;
  const base = `/promo-studio/${promo.id}/package/${pkg.id}`;
  const busy = components.filter((c) => c.genStatus === "QUEUED" || c.genStatus === "RUNNING");
  const failed = components.filter((c) => c.genStatus === "FAILED" || (c.genStatus === "NONE" && !c.content));
  const approved = components.filter((c) => c.status === "APPROVED" && c.content.trim()).length;
  const allApproved = components.length > 0 && approved === components.length;
  const hidden = (
    <>
      <input type="hidden" name="promoId" value={promo.id} />
      <input type="hidden" name="packageId" value={pkg.id} />
    </>
  );

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <Link href={`/promo-studio/${promo.id}?tab=package`} className="text-sm text-accent hover:underline">
          ← {promo.title}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="[overflow-wrap:anywhere] text-2xl font-semibold tracking-tight">{pkg.title}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
              <Badge tone={pkg.status === "APPROVED" ? "ok" : "neutral"}>{pkg.status === "APPROVED" ? "Approved" : "Draft"}</Badge>
              <span>
                {approved}/{components.length} components approved
              </span>
              {pkg.approvedAt ? <span>· approved {pkg.approvedAt.toISOString().slice(0, 10)}</span> : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a href={`${base}/export?format=docx`} className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold hover:bg-canvas">
              Word
            </a>
            <a href={`${base}/export?format=md`} className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold hover:bg-canvas">
              Markdown
            </a>
            {approver && pkg.status !== "APPROVED" ? (
              <form action={approvePackage}>
                {hidden}
                <Button type="submit" disabled={!allApproved || busy.length > 0} title={allApproved ? "Approve the package" : "Approve every component first"}>
                  Approve package
                </Button>
              </form>
            ) : null}
            {approver && pkg.status === "APPROVED" ? (
              <form action={reopenPackage}>
                {hidden}
                <Button type="submit" variant="secondary">Reopen</Button>
              </form>
            ) : null}
          </div>
        </div>
      </header>

      <Flash error={query.error} notice={query.notice} />
      {busy.length ? (
        <div className="flex items-center gap-3 rounded-xl border border-[#c7d7fe] bg-[#eef4ff] px-4 py-3 text-sm text-[#1e3a8a]">
          <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-[#1e3a8a] border-t-transparent" aria-hidden />
          <span>
            Writing {busy.length} of {components.length}… each piece takes about a minute. This page updates by itself. <AutoRefresh />
          </span>
        </div>
      ) : null}
      {failed.length && !busy.length ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]">
          <span className="[overflow-wrap:anywhere] min-w-0">
            {failed.length} not written{failed[0]?.genError ? `: ${failed[0].genError}` : "."}
          </span>
          {writable ? (
            <form action={retryFailed}>
              {hidden}
              <Button type="submit" variant="secondary">Try again</Button>
            </form>
          ) : null}
        </div>
      ) : null}
      {!allApproved && approver && pkg.status !== "APPROVED" && components.length ? (
        <p className="text-xs text-muted">Approve each component (open it, set the status to Approved) to approve the package. Approval teaches {ctx.brand.name}&apos;s Brain.</p>
      ) : null}

      <ul className="grid gap-3 md:grid-cols-2">
        {components.map((c) => (
          <li key={c.id}>
            <Link href={`${base}/${c.id}`} className="block h-full rounded-xl border border-line bg-white p-4 hover:border-accent">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold">
                  {c.label} <span className="font-normal text-muted">· {c.quantity}</span>
                </span>
                <span className="flex flex-wrap items-center gap-1">
                  <GenBadge status={c.genStatus} />
                  <StatusBadge status={c.status} />
                </span>
              </div>
              <p className="[overflow-wrap:anywhere] mt-2 line-clamp-3 text-sm text-muted">
                {c.content ? preview(c.content) : c.genStatus === "FAILED" ? c.genError ?? "Not written." : "Not written yet."}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                <FlagSummary flags={c.flags} />
                {c.currentVersion ? <span>v{c.currentVersion}</span> : null}
              </div>
            </Link>
          </li>
        ))}
        {components.length === 0 ? <li className="rounded-xl border border-line bg-white p-4 text-sm text-muted">No components. Add some below.</li> : null}
      </ul>

      {writable ? (
        <div className="space-y-3">
          <details className="rounded-xl border border-line bg-white p-4">
            <summary className="cursor-pointer text-sm font-semibold text-accent">Add components</summary>
            <form action={addComponents} className="mt-3 space-y-3">
              {hidden}
              <ComponentPicker exclude={components.map((c) => c.kind)} includeEvent={Boolean(pkg.direction.event)} preselect={false} />
              {!pkg.direction.event ? <p className="text-xs text-muted">Live event pieces appear here once the direction names an event.</p> : null}
              <Button type="submit" variant="secondary">Write them</Button>
            </form>
          </details>
          <details className="rounded-xl border border-line bg-white p-4">
            <summary className="cursor-pointer text-sm font-semibold text-accent">Name and direction</summary>
            <form action={updatePackage} className="mt-3 space-y-3">
              {hidden}
              <div>
                <Label htmlFor="title">Package name</Label>
                <Input id="title" name="title" maxLength={200} defaultValue={pkg.title} />
              </div>
              <DirectionFields values={pkg.direction} eventToggle={false} />
              <Button type="submit" variant="secondary">Save direction</Button>
            </form>
          </details>
          <form action={deletePackage} className="pt-2">
            {hidden}
            <Button type="submit" variant="danger">Delete package</Button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
