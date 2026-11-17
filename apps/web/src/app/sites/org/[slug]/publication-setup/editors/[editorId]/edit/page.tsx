import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { EditorForm } from "@/features/pubsetup/forms";
import { pubsetupPage } from "@/features/pubsetup/guard";
import { getEditor } from "@/features/pubsetup/read";

export default async function EditEditorPage({ params, searchParams }: { params: Promise<{ slug: string; editorId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { slug, editorId } = await params;
  const query = await searchParams;
  const access = await pubsetupPage(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const editor = await getEditor(access.ctx.resolved.id, access.ctx.brand.id, editorId);
  if (!editor || editor.id !== editorId) notFound();
  return (
    <div>
      <Link href={`/publication-setup/editors/${editor.id}`} className="inline-flex min-h-11 items-center text-sm text-muted hover:text-ink">
        ← {editor.name}
      </Link>
      <h2 className="mb-4 text-lg font-semibold">Edit {editor.name}</h2>
      <Flash error={query.error} />
      <EditorForm editor={editor} />
    </div>
  );
}
