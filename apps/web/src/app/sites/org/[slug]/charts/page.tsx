import { notFound } from "next/navigation";
import { Denied } from "@/components/ui";
import { createProjectAction, fetchSeriesAction, saveChartAction, saveTemplateAction, uploadImageAction } from "@/features/charts/actions";
import { chartsAccess } from "@/features/charts/context";
import { listProjects } from "@/features/charts/data";
import { ChartEditor } from "@/features/charts/editor";
import { loadSeries, marketStatus, todayIso } from "@/features/charts/market";
import { SAMPLE_CSV } from "@/features/charts/sample";
import { listTemplates, loadChart } from "@/features/charts/server";
import { getOrgContext } from "@/lib/org";
import { applyStyle } from "../../../../../../../../modules/charts/spec";
import { defaultSpec } from "../../../../../../../../modules/charts/templates";

export default async function ChartsEditorPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ chart?: string; template?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  const access = await chartsAccess(slug);
  if (!access.ok) return <Denied title={access.error} />;
  const { organizationId, brandId } = access.scope;
  const [templates, projects] = await Promise.all([listTemplates(organizationId), listProjects(organizationId, brandId)]);
  const status = marketStatus();
  const connected = status.massive || status.tiingo;

  const stored = query.chart ? await loadChart(organizationId, brandId, query.chart) : null;
  let spec;
  if (stored) {
    spec = stored.spec;
  } else {
    const template = templates.find((item) => item.id === query.template) ?? templates[0];
    spec = defaultSpec(todayIso(), template?.style, template?.id ?? null);
    if (template) spec = applyStyle(spec, template.style, template.id);
    if (!connected) spec.data = { ...spec.data, symbol: "CSV", csv: SAMPLE_CSV, period: "MAX" };
  }
  // Reopened charts show the exact bars that were saved; new charts load fresh data.
  const loaded = stored
    ? { ok: true as const, series: { symbol: stored.symbol, name: stored.seriesName, source: stored.source, unit: (stored.unit === "" ? "" : "$") as "" | "$", warnings: stored.warningsList, bars: stored.barsList } }
    : await loadSeries(spec.data);

  return (
    <ChartEditor
      key={stored?.id ?? "new"}
      initialSpec={spec}
      initialSeries={loaded.ok ? loaded.series : null}
      initialError={loaded.ok ? null : loaded.error}
      chartId={stored?.id ?? null}
      chartName={stored?.name ?? ""}
      projectId={stored?.projectId ?? null}
      templates={templates.map((t) => ({ id: t.id, name: t.name, category: t.category, style: t.style }))}
      projects={projects.map((p) => ({ id: p.id, name: p.name }))}
      marketNote={
        connected
          ? null
          : "Market data is not connected yet: MASSIVE_API_KEY and TIINGO_API_KEY are not set, so tickers cannot load. FRED series (FRED:DGS10) and pasted CSV work now. The chart below uses example CSV data."
      }
      actions={{ fetchSeries: fetchSeriesAction, save: saveChartAction, createProject: createProjectAction, saveTemplate: saveTemplateAction, uploadImage: uploadImageAction }}
    />
  );
}
