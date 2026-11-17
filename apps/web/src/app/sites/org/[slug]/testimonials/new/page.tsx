import { Button } from "@pubcommand/ui";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { createTestimonialAction } from "@/features/testimonials/actions";
import { testimonialsPage } from "@/features/testimonials/guard";
import { lookups } from "@/features/testimonials/server";
import { ConsentFields, TestimonialFields } from "@/features/testimonials/ui";

export default async function NewTestimonialPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; pub?: string; editor?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await testimonialsPage(slug, "testimonials.write");
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx } = access;
  const look = await lookups(ctx.resolved.id, ctx.brand.id);
  return (
    <div className="max-w-3xl space-y-4">
      <Flash error={query.error} />
      <form action={createTestimonialAction} className="space-y-4 rounded-xl border border-line bg-white p-4 sm:p-5">
        <h2 className="text-base font-semibold">Add a testimonial</h2>
        <TestimonialFields
          values={{ publicationId: query.pub ?? null, editorId: query.editor ?? null }}
          publications={look.publications.filter((p) => !p.archived).map((p) => ({ id: p.id, name: p.name, code: p.code }))}
          editors={look.editorList.filter((e) => !e.archived).map((e) => ({ id: e.id, name: e.name }))}
        />
        <ConsentFields />
        <p className="text-xs text-muted">New testimonials start as pending review. The brand&apos;s compliance rules are checked on save.</p>
        <Button type="submit">Save testimonial</Button>
      </form>
    </div>
  );
}
