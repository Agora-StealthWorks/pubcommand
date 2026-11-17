import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { EditorForm } from "@/features/pubsetup/forms";
import { pubsetupPage } from "@/features/pubsetup/guard";

export default async function NewEditorPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await pubsetupPage(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">New editor</h2>
      <Flash error={query.error} />
      <EditorForm />
    </div>
  );
}
