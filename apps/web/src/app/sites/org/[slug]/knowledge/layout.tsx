import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied } from "@/components/ui";
import { brainHref, loadBrain } from "@/features/brain/context";
import { FolderTree } from "@/features/brain/parts";
import { folderCounts } from "@/features/brain/search";
import { currentRequest } from "@/lib/request";
import { buildFolderTree } from "../../../../../../../../modules/knowledge/folders";
import { brandScope, MAIN_SCOPE } from "../../../../../../../../modules/knowledge/visibility";
import "@/features/brain/brain.css";

export default async function BrainLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const request = await currentRequest();
  const search = new URLSearchParams(request.search.replace(/^\?/, ""));
  const loaded = await loadBrain(slug, search.get("scope"));
  if (loaded.kind === "missing") notFound();
  if (loaded.kind === "denied") return <Denied title={loaded.title} />;
  const { ctx } = loaded;
  const scope = ctx.brain;
  const counts = await folderCounts(ctx.resolved.id, scope);
  const tree = buildFolderTree(counts);
  const total = counts.reduce((sum, row) => sum + row.count, 0);
  const activeFolder = request.pathname === "/knowledge" ? search.get("folder") : null;
  const path = request.pathname;
  const navItem = (href: string, label: string, active: boolean) => (
    <Link
      href={brainHref(href, scope)}
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
          {ctx.mainAllowed && ctx.scopeBrand ? (
            <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-canvas p-1" role="tablist" aria-label="Which Brain">
              <Link
                role="tab"
                aria-selected={scope.kind === "brand"}
                href={brainHref("/knowledge", brandScope(ctx.scopeBrand.id))}
                className={`flex min-h-9 min-w-0 items-center justify-center rounded-md px-2 text-center text-xs font-semibold ${scope.kind === "brand" ? "bg-white text-ink shadow-sm" : "text-muted"}`}
              >
                <span className="truncate">{ctx.scopeBrand.name}</span>
              </Link>
              <Link
                role="tab"
                aria-selected={scope.kind === "main"}
                href={brainHref("/knowledge", MAIN_SCOPE)}
                className={`flex min-h-9 items-center justify-center rounded-md px-2 text-xs font-semibold ${scope.kind === "main" ? "bg-white text-ink shadow-sm" : "text-muted"}`}
              >
                Main Brain
              </Link>
            </div>
          ) : null}
          <p className="mt-2 text-xs text-muted">
            {scope.kind === "main"
              ? `Every note from every brand, plus organization-wide notes. ${total} notes.`
              : `${ctx.scopeBrand?.name ?? "This brand"}'s own notes plus notes shared with every brand. ${total} notes.`}
          </p>
        </div>
        <nav className="flex flex-wrap gap-1 border-b border-line px-3 py-2" aria-label="Brain">
          {navItem("/knowledge", "Home", path === "/knowledge" && !activeFolder && !search.get("shared"))}
          {navItem("/knowledge/ask", "Ask the Brain", path.startsWith("/knowledge/ask"))}
          {ctx.canWrite ? navItem("/knowledge/new", "+ New note", path === "/knowledge/new") : null}
          {ctx.canWrite ? navItem("/knowledge/import", "Import", path.startsWith("/knowledge/import")) : null}
        </nav>
        <details className="px-3 py-2 lg:hidden">
          <summary className="cursor-pointer py-1 text-sm font-semibold text-accent">Folders ({tree.length})</summary>
          <div className="mt-2 max-h-[50vh] overflow-y-auto">
            <FolderTree nodes={tree} scope={scope} active={activeFolder} />
          </div>
        </details>
        <div className="hidden px-2 py-3 lg:block">
          <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-muted">Folders</p>
          <div className="max-h-[calc(100vh-17rem)] overflow-y-auto pr-1">
            <FolderTree nodes={tree} scope={scope} active={activeFolder} />
          </div>
        </div>
      </aside>
      <section className="min-w-0 px-4 py-5 sm:px-6">{children}</section>
    </div>
  );
}
