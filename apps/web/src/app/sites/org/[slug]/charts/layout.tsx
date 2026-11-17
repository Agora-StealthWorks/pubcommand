import { notFound } from "next/navigation";
import { Denied } from "@/components/ui";
import { chartsAccess } from "@/features/charts/context";
import { ChartsTabs } from "@/features/charts/tabs";

/** The bundled Inter files: the same fonts the PNG/JPG/PDF exporter draws with. */
const CHART_FONTS_CSS = [
  [400, "Regular"],
  [600, "SemiBold"],
  [700, "Bold"],
  [800, "ExtraBold"],
]
  .map(([weight, file]) => `@font-face{font-family:Inter;font-weight:${weight};font-display:swap;src:url(/charts/fonts/Inter-${file}.otf) format("opentype")}`)
  .join("");
import { getOrgContext } from "@/lib/org";

export default async function ChartsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getOrgContext(slug);
  if (ctx.kind !== "ok") notFound();
  const access = await chartsAccess(slug);
  if (!access.ok) return <Denied title={access.error} />;
  return (
    <div className="min-w-0">
      <style>{CHART_FONTS_CSS}</style>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">ChartBuilder</h1>
        <ChartsTabs />
      </div>
      {children}
    </div>
  );
}
