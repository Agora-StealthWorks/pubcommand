import { tenantDb } from "@pubcommand/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { UUID, supportPage } from "@/features/support/guard";
import { RecordForm } from "@/features/support/record-form";
import { isAudience, isRecordCategory } from "../../../../../../../../../../modules/support/taxonomy";

export default async function NewSupportRecordPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; gap?: string; category?: string; audience?: string; title?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await supportPage(slug, "support.write");
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx } = access;
  const db = tenantDb(ctx.resolved.id);
  const gap = query.gap && UUID.test(query.gap) ? await db.supportGap.findFirst({ where: { id: query.gap, brandId: ctx.brand.id }, select: { id: true, question: true } }) : null;
  const pubs = await db.calendarPublication.findMany({ where: { brandId: ctx.brand.id, deletedAt: null }, orderBy: { name: "asc" }, select: { code: true, name: true } });
  return (
    <div className="max-w-3xl space-y-4">
      <Link href="/support" className="text-sm text-accent">
        ← Records
      </Link>
      <h2 className="text-lg font-semibold">New record</h2>
      {gap ? <p className="rounded-md border border-line bg-white px-3 py-2 text-sm">Answering the gap: “{gap.question}”. Saving marks it answered.</p> : null}
      <Flash error={query.error} />
      <RecordForm
        canPublish={ctx.canPublish}
        gapId={gap?.id}
        publicationCodes={pubs}
        values={{
          category: isRecordCategory(query.category) ? query.category : "faqs",
          audience: isAudience(query.audience) ? query.audience : "public",
          status: "draft",
          title: query.title ?? gap?.question ?? "",
          body: "",
          summary: "",
          url: null,
          tags: [],
          publicationCodes: [],
          gateOverrides: [],
          priceConfirmed: false,
        }}
      />
    </div>
  );
}
