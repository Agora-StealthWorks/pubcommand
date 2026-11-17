import { tenantDb } from "@pubcommand/db";
import Link from "next/link";
import { Denied, Flash } from "@/components/ui";
import { CallForm } from "@/features/trackrecord/call-form";
import { getEditor, getEditors } from "@/features/pubsetup/read";
import { trackAccess } from "@/features/trackrecord/context";
import { expertForEditor } from "../../../../../../../../../../modules/performance/attribution";

export default async function NewCallPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; expert?: string; editor?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await trackAccess("performance.write", slug);
  if (!access.ok) return <Denied title={access.error} />;
  const db = tenantDb(access.scope.organizationId);
  const [stored, categories, editor] = await Promise.all([
    db.trackExpert.findMany({ where: { brandId: access.scope.brandId, deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, editorId: true } }),
    db.trackCategory.findMany({ where: { brandId: access.scope.brandId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, color: true } }),
    query.editor ? getEditor(access.scope.organizationId, access.scope.brandId, query.editor) : null,
  ]);
  // Opened from an editor's Wiki profile: preselect the expert who is that editor, or offer to create one.
  const profile = editor && !editor.archived ? editor : null;
  const linked = profile ? expertForEditor(stored, profile, await getEditors(access.scope.organizationId, access.scope.brandId)) : null;
  const experts = [
    ...(profile && !linked?.editorId ? [{ id: `editor:${profile.id}`, name: linked ? `${profile.name} (link to the editor profile)` : `${profile.name} (new expert from the editor profile)` }] : []),
    ...stored.filter((e) => !(profile && !linked?.editorId && e.id === linked?.id)).map((e) => ({ id: e.id, name: e.name })),
  ];
  const defaultExpertId = profile ? (linked?.editorId ? linked.id : `editor:${profile.id}`) : query.expert;
  return (
    <div className="max-w-3xl space-y-3">
      {profile ? (
        <Link href={`/wiki/editors/${profile.slug}`} className="text-sm text-accent">
          ← {profile.name}&apos;s profile
        </Link>
      ) : (
        <Link href="/performance/archive" className="text-sm text-accent">
          ← Call archive
        </Link>
      )}
      <h2 className="text-xl font-semibold">Add a call</h2>
      <Flash error={query.error} />
      {experts.length === 0 ? (
        <p className="rounded-xl border border-line bg-white p-4 text-sm text-muted">
          Add an expert first under <Link href="/performance/archive/manage" className="font-semibold text-accent">Experts and categories</Link>.
        </p>
      ) : (
        <CallForm call={null} experts={experts} categories={categories} defaultExpertId={defaultExpertId} />
      )}
    </div>
  );
}
