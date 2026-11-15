/**
 * Example recommendation book and launch-funnel placeholders.
 * Rows are scoped by organizationId. Nothing here is a live broker feed.
 *
 * TODO: import fills from the organization's broker and upsert recommendations
 * for that organizationId only. Do not merge books across organizations.
 */

export const EXAMPLE_ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
export const EXAMPLE_OTHER_ORGANIZATION_ID = "22222222-2222-4222-8222-222222222222";

export type TradeDirection = "long" | "short";

export type Recommendation = {
  id: string;
  organizationId: string;
  symbol: string;
  direction: TradeDirection;
  openedOn: string;
  closedOn: string | null;
  /** Simple dollar P&L. Null while the recommendation is still open. */
  pnl: number | null;
};

export type LaunchFunnel = {
  organizationId: string;
  visits: number;
  optIns: number;
  revenue: number;
  /** Launch tracking is not connected. These figures are placeholders. */
  placeholder: true;
};

export type PerformanceRecommendationRow = {
  id: string;
  symbol: string;
  direction: "Long" | "Short";
  openedOn: string;
  closedOn: string;
  pnl: string;
};

export type PerformanceFunnelRow = {
  visits: string;
  optIns: string;
  revenue: string;
  placeholder: true;
};

export type PerformanceHome = {
  organizationId: string;
  /** True when this organization has no stored rows and the example book is shown. */
  example: boolean;
  source: "example";
  brokerImport: "not_implemented";
  recommendations: readonly PerformanceRecommendationRow[];
  closedPnl: string;
  funnel: PerformanceFunnelRow;
};

export type BrokerImportStatus = {
  status: "not_implemented";
  organizationId: string;
};

type SeedTrade = {
  id: string;
  organizationId: string;
  symbol: string;
  direction: TradeDirection;
  openedOn: string;
  closedOn: string | null;
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
};

const EXAMPLE_TRADES: readonly SeedTrade[] = [
  {
    id: "rec_example_aapl",
    organizationId: EXAMPLE_ORGANIZATION_ID,
    symbol: "AAPL",
    direction: "long",
    openedOn: "2026-01-06",
    closedOn: "2026-02-12",
    entryPrice: 180.25,
    exitPrice: 198.65,
    quantity: 100,
  },
  {
    id: "rec_example_msft",
    organizationId: EXAMPLE_ORGANIZATION_ID,
    symbol: "MSFT",
    direction: "short",
    openedOn: "2026-03-02",
    closedOn: "2026-03-20",
    entryPrice: 420,
    exitPrice: 401.5,
    quantity: 40,
  },
  {
    id: "rec_example_nvda",
    organizationId: EXAMPLE_ORGANIZATION_ID,
    symbol: "NVDA",
    direction: "long",
    openedOn: "2026-04-01",
    closedOn: null,
    entryPrice: 875,
    exitPrice: null,
    quantity: 10,
  },
  {
    id: "rec_example_xom",
    organizationId: EXAMPLE_OTHER_ORGANIZATION_ID,
    symbol: "XOM",
    direction: "long",
    openedOn: "2026-02-01",
    closedOn: "2026-02-28",
    entryPrice: 108.4,
    exitPrice: 99.15,
    quantity: 25,
  },
];

const EXAMPLE_FUNNELS: readonly LaunchFunnel[] = [
  {
    organizationId: EXAMPLE_ORGANIZATION_ID,
    visits: 12840,
    optIns: 960,
    revenue: 18420.5,
    placeholder: true,
  },
  {
    organizationId: EXAMPLE_OTHER_ORGANIZATION_ID,
    visits: 860,
    optIns: 40,
    revenue: 1260,
    placeholder: true,
  },
];

function cents(amount: number): number {
  return Math.round(amount * 100);
}

/** Dollar P&L from entry, exit, and quantity. Long gains when price rises; short gains when it falls. */
export function simplePnl(input: {
  direction: TradeDirection;
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
}): number | null {
  if (input.exitPrice === null) return null;
  const entry = cents(input.entryPrice);
  const exit = cents(input.exitPrice);
  const move = input.direction === "long" ? exit - entry : entry - exit;
  return (move * input.quantity) / 100;
}

function toRecommendation(trade: SeedTrade): Recommendation {
  return {
    id: trade.id,
    organizationId: trade.organizationId,
    symbol: trade.symbol,
    direction: trade.direction,
    openedOn: trade.openedOn,
    closedOn: trade.closedOn,
    pnl: simplePnl(trade),
  };
}

const EXAMPLE_RECOMMENDATIONS: readonly Recommendation[] = EXAMPLE_TRADES.map(toRecommendation);

export function formatCount(value: number): string {
  return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatUsd(amount: number): string {
  const negative = amount < 0;
  const [whole, fraction] = Math.abs(amount).toFixed(2).split(".");
  const grouped = (whole ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${grouped}.${fraction ?? "00"}`;
}

export function formatPnl(amount: number | null): string {
  if (amount === null) return "Open";
  if (amount > 0) return `+${formatUsd(amount)}`;
  return formatUsd(amount);
}

export function listRecommendations(organizationId: string): readonly Recommendation[] {
  if (!organizationId) return [];
  return EXAMPLE_RECOMMENDATIONS.filter((row) => row.organizationId === organizationId);
}

export function listLaunchFunnel(organizationId: string): LaunchFunnel | null {
  if (!organizationId) return null;
  return EXAMPLE_FUNNELS.find((row) => row.organizationId === organizationId) ?? null;
}

/**
 * TODO: pull fills from the connected broker and upsert recommendations for this organization only.
 * Broker imports are not connected in this slice.
 */
export function importBrokerRecommendations(organizationId: string): BrokerImportStatus {
  return { status: "not_implemented", organizationId };
}

function directionLabel(direction: TradeDirection): "Long" | "Short" {
  return direction === "long" ? "Long" : "Short";
}

function toRow(row: Recommendation): PerformanceRecommendationRow {
  return {
    id: row.id,
    symbol: row.symbol,
    direction: directionLabel(row.direction),
    openedOn: row.openedOn,
    closedOn: row.closedOn ?? "Open",
    pnl: formatPnl(row.pnl),
  };
}

function closedPnl(rows: readonly Recommendation[]): string {
  const total = rows.reduce((sum, row) => sum + (row.pnl ?? 0), 0);
  return formatPnl(total);
}

function projectExample(organizationId: string): readonly Recommendation[] {
  return listRecommendations(EXAMPLE_ORGANIZATION_ID).map((row) => ({
    ...row,
    id: `${organizationId}:${row.id}`,
    organizationId,
  }));
}

function funnelRow(funnel: LaunchFunnel): PerformanceFunnelRow {
  return {
    visits: formatCount(funnel.visits),
    optIns: formatCount(funnel.optIns),
    revenue: formatUsd(funnel.revenue),
    placeholder: true,
  };
}

function funnelFor(organizationId: string): LaunchFunnel {
  const stored = listLaunchFunnel(organizationId);
  if (stored) return stored;
  const example = listLaunchFunnel(EXAMPLE_ORGANIZATION_ID);
  if (!example) return { organizationId, visits: 0, optIns: 0, revenue: 0, placeholder: true };
  return { ...example, organizationId };
}

/** Recommendations and launch-funnel placeholders visible to one organization. */
export function performanceHome(organizationId: string): PerformanceHome {
  const stored = listRecommendations(organizationId);
  const example = stored.length === 0;
  const recommendations = example ? projectExample(organizationId) : stored;
  const funnel = funnelFor(organizationId);
  return {
    organizationId,
    example,
    source: "example",
    brokerImport: importBrokerRecommendations(organizationId).status,
    recommendations: recommendations.map(toRow),
    closedPnl: closedPnl(recommendations),
    funnel: funnelRow(funnel),
  };
}
