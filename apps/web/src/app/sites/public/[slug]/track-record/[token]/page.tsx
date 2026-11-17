import { notFound } from "next/navigation";
import { publicPortfolio } from "@/features/trackrecord/server";
import { PublicTrackRecordView } from "@/features/trackrecord/ui";

/** The public-safe track record. It only ever renders a PublicTrackRecord: closed trades, no losers list. */
export default async function PublicTrackRecordPage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  const found = await publicPortfolio(slug, token);
  if (!found) notFound();
  const { portfolio, brandName, record } = found;
  return <PublicTrackRecordView record={record} title={portfolio.name} subtitle={`${brandName}${portfolio.publication ? ` · ${portfolio.publication}` : ""}`} asOf={new Date()} />;
}
