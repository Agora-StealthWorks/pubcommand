import { notFound } from "next/navigation";
import { widgetData } from "@/features/trackrecord/server";
import { WidgetView } from "@/features/trackrecord/widget-view";
import { widgetLimit, widgetView } from "../../../../../../../../../../modules/performance/widget";

/**
 * The embeddable track record (iframe). Public-safe: closed trades by default, date order, no loser count, no
 * worst trade, no losers list. Turning the widget off or rotating its token makes every old embed show nothing.
 */
export default async function TrackRecordWidgetPage({ params, searchParams }: { params: Promise<{ slug: string; token: string }>; searchParams: Promise<{ view?: string; limit?: string }> }) {
  const { slug, token } = await params;
  const query = await searchParams;
  const data = await widgetData(slug, token, widgetLimit(query.limit));
  if (!data) notFound();
  return <WidgetView data={data} view={widgetView(query.view)} />;
}
