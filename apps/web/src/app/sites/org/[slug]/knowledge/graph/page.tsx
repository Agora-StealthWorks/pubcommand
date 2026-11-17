import { Button } from "@pubcommand/ui";
import { notFound } from "next/navigation";
import { Denied } from "@/components/ui";
import { loadBrain } from "@/features/brain/context";
import { GraphView } from "@/features/brain/graph-view";
import { graphNotes } from "@/features/brain/notes";
import { folderCounts } from "@/features/brain/search";
import { normalizeFolder } from "../../../../../../../../../modules/knowledge/folders";
import { buildGraph, topFolder } from "../../../../../../../../../modules/knowledge/graph";

const WIDTH = 1000;
const HEIGHT = 700;

export default async function BrainGraphPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ folder?: string; all?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const loaded = await loadBrain(slug);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "denied") return <Denied title={loaded.title} />;
  const { ctx } = loaded;
  const folder = normalizeFolder(query.folder);
  const includeOrphans = query.all === "1";
  const [notes, counts] = await Promise.all([graphNotes(ctx.resolved.id, ctx.brain, folder), folderCounts(ctx.resolved.id, ctx.brain)]);
  const graph = buildGraph(notes, { preferBrandId: ctx.brain.brandId, includeOrphans, width: WIDTH, height: HEIGHT, within: folder });
  const tops = [...new Set(counts.map((row) => topFolder(row.folder)))].filter((name) => name !== "(top level)").sort();

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-semibold tracking-tight">Graph</h1>
      <p className="mt-1 text-sm text-muted">
        Notes in {ctx.scopeLabel} and the [[links]] between them. {graph.nodes.length} notes and {graph.edges.length} links shown
        {graph.truncated ? ` (the ${graph.nodes.length} best-connected of ${graph.totalNotes})` : ""}.
      </p>
      <form action="/knowledge/graph" className="pc-form-row my-4">
        <select name="folder" defaultValue={folder ?? ""} className="pc-control sm:w-64" aria-label="Folder">
          <option value="">All folders</option>
          {tops.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="all" value="1" defaultChecked={includeOrphans} /> Include notes without links
        </label>
        <Button type="submit" variant="secondary">
          Show
        </Button>
      </form>
      {graph.nodes.length === 0 ? (
        <p className="rounded-xl border border-line bg-white px-4 py-6 text-sm text-muted">No linked notes yet. Notes appear here once they link to each other with [[Note title]].</p>
      ) : (
        <GraphView nodes={graph.nodes} edges={graph.edges} groups={graph.groups} width={WIDTH} height={HEIGHT} hrefBase="/knowledge" />
      )}
    </div>
  );
}
