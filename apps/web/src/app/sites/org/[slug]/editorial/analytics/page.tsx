import { notFound } from "next/navigation";
import { AnalyticsView } from "@/features/calendar/analytics-view";
import { calendarPage } from "@/features/calendar/context";
import { listPublications, loadSendStats } from "@/features/calendar/data";
import { toSendRow, type SendRow } from "../../../../../../../../../modules/editorial/analytics";

export default async function AnalyticsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await calendarPage(slug);
  if (!ctx) notFound();
  const [stats, publications] = await Promise.all([loadSendStats(ctx.resolved.id, ctx.brand.id), listPublications(ctx.resolved.id, ctx.brand.id, true)]);
  const rows = stats.map((s) => toSendRow(s)).filter((r): r is SendRow => r != null);
  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold">Editorial analytics</h2>
      <AnalyticsView rows={rows} publications={publications.map((p) => ({ code: p.code, name: p.name, color: p.color }))} />
    </div>
  );
}
