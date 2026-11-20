import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { pubsetupPage } from "@/features/pubsetup/guard";
import { ImportForm } from "@/features/pubsetup/import-form";

export default async function PublicationImportPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await pubsetupPage(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  return (
    <div className="max-w-3xl space-y-4">
      <Flash error={query.error} notice={query.notice} />
      <div>
        <h2 className="text-lg font-semibold">Import publications and editors</h2>
        <p className="text-sm text-muted">
          Bring in {access.ctx.brand.name}&apos;s publications, editors, logos and photos from a Publication Setup import file. Matching is by publication code and editor name, so
          running the same file again is safe.
        </p>
      </div>
      <ImportForm />
    </div>
  );
}
