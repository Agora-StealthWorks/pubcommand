import { can } from "@pubcommand/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied } from "@/components/ui";
import { listPromos } from "@/features/promos/data";
import { getOrgContext } from "@/lib/org";
import { currentRequest } from "@/lib/request";

const STATUS_DOT: Record<string, string> = {
  QUEUED: "bg-[#fdb022]",
  RUNNING: "bg-[#fdb022] animate-pulse",
  FAILED: "bg-[#f04438]",
  DONE: "bg-[#12b76a]",
  NONE: "bg-line",
};

export default async function PromoAnalyzerLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  if (!ctx.subject.entitledModuleIds.includes("promo-studio")) return <Denied title="Promo Analyzer is turned off" />;
  if (!can(ctx.subject, "promo.read", ctx.scope)) return <Denied />;
  if (!ctx.brand) return <Denied title="Add a brand in Settings → Brands first" />;
  const request = await currentRequest();
  const q = new URLSearchParams(request.search.replace(/^\?/, "")).get("q") ?? "";
  const promos = await listPromos(ctx.resolved.id, ctx.brand.id, q);
  const activeId = request.pathname.split("/")[2] ?? "";

  return (
    <div className="-mx-4 -my-5 grid min-h-[calc(100vh-3.5rem)] sm:-mx-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="border-b border-line bg-white lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Past reviews · {promos.length}</h2>
          <Link href="/promo-studio" className="inline-flex min-h-9 items-center rounded-md bg-accent px-3 text-xs font-semibold text-white">
            + New promo
          </Link>
        </div>
        <form action={request.pathname} className="border-b border-line px-3 py-2">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search title, publisher, guru, code"
            aria-label="Search promos"
            className="pc-control w-full text-sm"
          />
        </form>
        <ul className="max-h-[40vh] overflow-y-auto lg:max-h-[calc(100vh-10rem)]">
          {promos.map((promo) => (
            <li key={promo.id}>
              <Link
                href={`/promo-studio/${promo.id}`}
                className={`flex items-start gap-2 border-b border-line px-4 py-2.5 hover:bg-canvas ${activeId === promo.id ? "bg-[#eef2ff]" : ""}`}
              >
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[promo.status] ?? "bg-line"}`} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {promo.isBestPerformer ? "★ " : ""}
                    {promo.title}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {promo.createdAt.toISOString().slice(0, 10)}
                    {promo.publisher ? ` · ${promo.publisher}` : ""}
                  </span>
                </span>
                {promo.score != null ? (
                  <span className="shrink-0 rounded-full bg-[#eef2ff] px-2 py-0.5 text-xs font-semibold text-[#1e3a8a]">{promo.score.toFixed(1)}</span>
                ) : null}
              </Link>
            </li>
          ))}
          {promos.length === 0 ? (
            <li className="px-4 py-6 text-sm text-muted">{q ? "No promos match." : "No promos yet. Upload your first one."}</li>
          ) : null}
        </ul>
      </aside>
      <section className="min-w-0 px-4 py-5 sm:px-6">{children}</section>
    </div>
  );
}
