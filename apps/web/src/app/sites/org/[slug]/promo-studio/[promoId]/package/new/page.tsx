import { aiConfigured } from "@pubcommand/ai";
import { Button, Input, Label } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { packagerAccess } from "@/features/packager/access";
import { createPackage } from "@/features/packager/actions";
import { isUuid } from "@/features/packager/data";
import { ComponentPicker, DirectionFields } from "@/features/packager/views";
import { tenantDb } from "@pubcommand/db";

export default async function NewPackagePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; promoId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug, promoId } = await params;
  const query = await searchParams;
  const access = await packagerAccess(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  if (!access.writable) return <Denied title="Starting a package needs promo.write" />;
  const { ctx } = access;
  if (!isUuid(promoId)) notFound();
  const promo = await tenantDb(ctx.resolved.id).promo.findFirst({ where: { id: promoId, brandId: ctx.brand.id, deletedAt: null }, select: { id: true, title: true, analysisStatus: true } });
  if (!promo) notFound();

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <Link href={`/promo-studio/${promo.id}?tab=package`} className="text-sm text-accent hover:underline">
          ← {promo.title}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">New copy package</h1>
        <p className="mt-1 text-sm text-muted">
          Pick the pieces to write and give any direction. Each piece is written in the background from the promo, its
          analysis, {ctx.brand.name}&apos;s best performers and Brain notes. You can edit, rewrite and approve each one.
        </p>
      </div>
      <Flash error={query.error} />
      {!aiConfigured() ? (
        <p className="rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
          The AI key is not set yet, so the package is saved but nothing is written. Add <code>ANTHROPIC_API_KEY</code> in
          Railway, then press &quot;Try again&quot; on the package.
        </p>
      ) : null}
      {promo.analysisStatus !== "DONE" ? (
        <p className="rounded-md border border-line bg-white px-3 py-2 text-sm text-muted">This promo has no finished analysis yet. The package will use the copy alone.</p>
      ) : null}
      <form action={createPackage} className="space-y-5 rounded-xl border border-line bg-white p-5">
        <input type="hidden" name="promoId" value={promo.id} />
        <div>
          <Label htmlFor="title">Package name</Label>
          <Input id="title" name="title" maxLength={200} placeholder={`${promo.title} copy package`} />
        </div>
        <section>
          <h2 className="mb-2 text-sm font-semibold">Components</h2>
          <ComponentPicker includeEvent />
        </section>
        <section>
          <h2 className="mb-2 text-sm font-semibold">Direction (optional)</h2>
          <DirectionFields eventToggle />
        </section>
        <Button type="submit" className="w-full sm:w-auto">Create and write the package</Button>
      </form>
    </div>
  );
}
