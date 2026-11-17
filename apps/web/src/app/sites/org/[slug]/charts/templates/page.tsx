import { Button } from "@pubcommand/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Denied, Flash } from "@/components/ui";
import { deleteTemplateForm } from "@/features/charts/actions";
import { chartsAccess } from "@/features/charts/context";
import { listTemplates } from "@/features/charts/server";
import { getOrgContext } from "@/lib/org";
import { renderChartSvg } from "../../../../../../../../../modules/charts/render";
import { normalizeSpec } from "../../../../../../../../../modules/charts/spec";

function demoBars() {
  const bars = [];
  let value = 40;
  for (let i = 0; i < 120; i += 1) {
    value *= 1 + 0.004 + 0.02 * Math.sin(i / 6) * 0.5;
    bars.push({ t: Date.UTC(2024, 0, 1) + i * 3 * 86_400_000, o: value, h: value, l: value, c: value });
  }
  return bars;
}

export default async function ChartTemplatesPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  const access = await chartsAccess(slug);
  if (!access.ok) return <Denied title={access.error} />;
  const templates = await listTemplates(access.scope.organizationId);
  const bars = demoBars();
  return (
    <div className="space-y-4">
      <Flash error={query.error} notice={query.notice} />
      <p className="max-w-2xl text-sm text-muted">
        Templates are shared by the whole team. Make one from the editor with “Save as template”. Starters are locked: only ChartBuilder admins (charts.write) can delete them. Previews use example
        data.
      </p>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {templates.map((template, index) => {
          const spec = normalizeSpec({ ...template.style, size: { preset: "custom", w: template.style.design.w, h: template.style.design.h }, title: "Example ({ticker})", data: { symbol: "EXMPL" } }, "2026-01-01");
          const svg = renderChartSvg({ spec, bars, meta: { ticker: "EXMPL", name: "Example", source: "example data", unit: "$" }, idPrefix: `t${index}` }).replace(/width="\d+" height="\d+"/, 'width="100%"');
          const removable = template.locked ? access.canManage : template.createdById === access.scope.actorId || access.canManage;
          return (
            <li key={template.id} className="min-w-0 overflow-hidden rounded-xl border border-line bg-white">
              <div className="[&_svg]:block [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
              <div className="p-3">
                <p className="font-semibold">
                  {template.name} {template.locked ? <span className="ml-1 rounded bg-canvas px-1.5 py-0.5 text-xs text-muted">Starter</span> : null}
                </p>
                <p className="text-sm text-muted">{template.description || (template.category === "PROMO" ? "Promo" : "Publication")}</p>
                <div className="mt-2 flex items-center gap-2">
                  <Link href={`/charts?template=${template.id}`} className="inline-flex min-h-9 items-center rounded-md bg-accent px-3 text-sm font-semibold text-white">
                    Use
                  </Link>
                  {removable ? (
                    <form action={deleteTemplateForm} className="ml-auto">
                      <input type="hidden" name="templateId" value={template.id} />
                      <Button type="submit" variant="ghost" size="sm" className="text-[#b42318]">
                        Delete
                      </Button>
                    </form>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
