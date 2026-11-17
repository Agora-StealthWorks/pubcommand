import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied } from "@/components/ui";
import { brainHref, loadBrain } from "@/features/brain/context";
import { FolderTree } from "@/features/brain/parts";
import { folderCounts } from "@/features/brain/search";
import { currentRequest } from "@/lib/request";
import { buildFolderTree } from "../../../../../../../../modules/knowledge/folders";
import "@/features/brain/brain.css";

export default async function BrainLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const request = await currentRequest();
  const search = new URLSearchParams(request.search.replace(/^\?/, ""));
  const loaded = await loadBrain(slug);
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "denied") return <Denied title={loaded.title} />;
  const { ctx } = loaded;
  const scope = ctx.brain;
  const counts = await folderCounts(ctx.resolved.id, scope);
  const tree = buildFolderTree(counts);
  const total = counts.reduce((sum, row) => sum + row.count, 0);
  const activeFolder = request.pathname === "/knowledge" ? search.get("folder") : null;
  const path = request.pathname;
  const folderHref = (folder: string) => brainHref("/knowledge", { folder });
  const navItem = (href: string, label: string, active: boolean) => (
    <Link
      href={brainHref(href)}
      className={`inline-flex min-h-9 items-center rounded-md px-3 text-sm font-medium ${active ? "bg-[#eef2ff] text-[#1e3a8a]" : "text-ink hover:bg-canvas"}`}
    >
      {label}
    </Link>
  );

  return (
    <div className="-mx-4 -my-5 grid min-h-[calc(100vh-3.5rem)] sm:-mx-6 lg:grid-cols-[288px_minmax(0,1fr)]">
      <aside className="min-w-0 border-b border-line bg-white lg:border-b-0 lg:border-r">
        <div className="border-b border-line px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Brain</p>
          <p className="mt-2 text-xs text-muted">
            {ctx.scopeBrand.name} · {total} notes
          </p>
        </div>
        <nav className="flex flex-wrap gap-1 border-b border-line px-3 py-2" aria-label="Brain">
          {navItem("/knowledge", "Home", path === "/knowledge" && !activeFolder && !search.get("shared"))}
          {navItem("/knowledge/ask", "Ask the Brain", path.startsWith("/knowledge/ask"))}
          {navItem("/knowledge/graph", "Graph", path.startsWith("/knowledge/graph"))}
          {ctx.canWrite ? navItem("/knowledge/new", "+ New note", path === "/knowledge/new") : null}
          {ctx.canWrite ? navItem("/knowledge/import", "Import", path.startsWith("/knowledge/import")) : null}
        </nav>
        <details className="px-3 py-2 lg:hidden">
          <summary className="cursor-pointer py-1 text-sm font-semibold text-accent">Folders ({tree.length})</summary>
          <div className="mt-2 max-h-[50vh] overflow-y-auto">
            <FolderTree nodes={tree} hrefFor={folderHref} active={activeFolder} />
          </div>
        </details>
        <div className="hidden px-2 py-3 lg:block">
          <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-muted">Folders</p>
          <div className="max-h-[calc(100vh-17rem)] overflow-y-auto pr-1">
            <FolderTree nodes={tree} hrefFor={folderHref} active={activeFolder} />
          </div>
        </div>
      </aside>
      <section className="min-w-0 px-4 py-5 sm:px-6">{children}</section>
    </div>
  );
}
