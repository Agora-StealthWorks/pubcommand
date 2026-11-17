import { Button } from "@pubcommand/ui";
import { Denied } from "@/components/ui";
import { GraphView } from "@/features/brain/graph-view";
import { mainBrain } from "@/features/main-brain/db";
import { mainFolderCounts } from "@/features/main-brain/notes";
import { brainStaff } from "@/features/main-brain/staff";
import { normalizeFolder } from "../../../../../../../../modules/knowledge/folders";
import { buildGraph, topFolder } from "../../../../../../../../modules/knowledge/graph";

const WIDTH = 1000;
const HEIGHT = 700;

export default async function MainGraphPage({ searchParams }: { searchParams: Promise<{ folder?: string; all?: string }> }) {
  const query = await searchParams;
  if (!(await brainStaff())) return <Denied />;
  const folder = normalizeFolder(query.folder);
  const includeOrphans = query.all === "1";
  const [notes, counts] = await Promise.all([
    mainBrain((tx) =>
      tx.mainBrainNote.findMany({
        where: { deletedAt: null, ...(folder ? { OR: [{ folder }, { folder: { startsWith: `${folder}/` } }] } : {}) },
        select: { id: true, title: true, folder: true, body: true },
        orderBy: { updatedAt: "desc" },
        take: 5000,
      }),
    ),
    mainFolderCounts(),
  ]);
  const graph = buildGraph(
    notes.map((note) => ({ ...note, brandId: null, visibility: "PRIVATE" as const })),
    { preferBrandId: null, includeOrphans, width: WIDTH, height: HEIGHT, within: folder },
  );
  const tops = [...new Set(counts.map((row) => topFolder(row.folder)))].filter((name) => name !== "(top level)").sort();
  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-semibold tracking-tight">Main Brain graph</h1>
      <p className="mt-1 text-sm text-muted">
        {graph.nodes.length} notes and {graph.edges.length} links shown{graph.truncated ? ` (the ${graph.nodes.length} best-connected of ${graph.totalNotes})` : ""}. Pick a folder to see more of it.
      </p>
      <form action="/brain/graph" className="pc-form-row my-4">
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
        <p className="rounded-xl border border-line bg-white px-4 py-6 text-sm text-muted">No linked notes yet.</p>
      ) : (
        <GraphView nodes={graph.nodes} edges={graph.edges} groups={graph.groups} width={WIDTH} height={HEIGHT} hrefBase="/brain" />
      )}
    </div>
  );
}
