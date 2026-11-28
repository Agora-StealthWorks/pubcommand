/**
 * Funnel visitor traffic for the Operations Brain, across every organization.
 * Everything is counted in SQL: only totals leave the database, never visitor
 * ids, emails, IPs or page URLs. Automated traffic (botReason set) is left out.
 */
import { platformTx } from "@pubcommand/db";
import { funnelTrafficText, type FunnelTrafficRow } from "../../../../../modules/funnels/brain-traffic";
import { OFFER_CLICK_KINDS } from "../../../../../modules/funnels/stats";

const MAX_FUNNELS = 60;

export async function funnelTraffic(start: Date, end: Date): Promise<FunnelTrafficRow[]> {
  const offerKinds = [...OFFER_CLICK_KINDS];
  return platformTx(async (tx) => {
    const totals = await tx.$queryRaw<{ funnel_id: string; organization: string; funnel: string; site_type: string; visitors: bigint; views: bigint; clickers: bigint }[]>`
      SELECT f.id AS funnel_id, o.name AS organization, f.name AS funnel, f.site_type,
             count(DISTINCT e.visitor_id) FILTER (WHERE e.kind = 'view') AS visitors,
             count(*) FILTER (WHERE e.kind = 'view') AS views,
             count(DISTINCT e.visitor_id) FILTER (WHERE e.kind = ANY(${offerKinds})) AS clickers
      FROM funnel_events e
      JOIN funnels f ON f.id = e.funnel_id
      JOIN organizations o ON o.id = e.organization_id
      WHERE e.created_at >= ${start} AND e.created_at < ${end} AND e.bot_reason IS NULL
      GROUP BY f.id, o.name, f.name, f.site_type
      ORDER BY visitors DESC
      LIMIT ${MAX_FUNNELS}`;
    const optinTotals = await tx.$queryRaw<{ funnel_id: string; organization: string; funnel: string; site_type: string; optins: bigint }[]>`
      SELECT f.id AS funnel_id, o.name AS organization, f.name AS funnel, f.site_type, count(*) AS optins
      FROM funnel_optins p
      JOIN funnels f ON f.id = p.funnel_id
      JOIN organizations o ON o.id = p.organization_id
      WHERE p.created_at >= ${start} AND p.created_at < ${end}
      GROUP BY f.id, o.name, f.name, f.site_type`;

    const rows = new Map<string, FunnelTrafficRow>();
    const get = (id: string, organization: string, funnel: string, siteType: string) => {
      const existing = rows.get(id);
      if (existing) return existing;
      const created: FunnelTrafficRow = { organization, funnel, siteType, visitors: 0, views: 0, optins: 0, offerClickers: 0, devices: {}, reach: [], params: [] };
      rows.set(id, created);
      return created;
    };
    for (const t of totals) Object.assign(get(t.funnel_id, t.organization, t.funnel, t.site_type), { visitors: Number(t.visitors), views: Number(t.views), offerClickers: Number(t.clickers) });
    for (const t of optinTotals) get(t.funnel_id, t.organization, t.funnel, t.site_type).optins = Number(t.optins);
    const ids = [...rows.keys()];
    if (!ids.length) return [];

    const devices = await tx.$queryRaw<{ funnel_id: string; device: string; visitors: bigint }[]>`
      SELECT funnel_id, coalesce(device, 'unknown') AS device, count(DISTINCT visitor_id) AS visitors
      FROM funnel_events
      WHERE funnel_id = ANY(${ids}::uuid[]) AND created_at >= ${start} AND created_at < ${end} AND bot_reason IS NULL AND kind = 'view'
      GROUP BY funnel_id, coalesce(device, 'unknown')`;
    const reach = await tx.$queryRaw<{ funnel_id: string; position: number; visitors: bigint }[]>`
      SELECT e.funnel_id, d.position, count(DISTINCT e.visitor_id) AS visitors
      FROM funnel_events e JOIN funnel_days d ON d.id = e.day_id
      WHERE e.funnel_id = ANY(${ids}::uuid[]) AND e.created_at >= ${start} AND e.created_at < ${end} AND e.bot_reason IS NULL AND e.kind = 'view'
      GROUP BY e.funnel_id, d.position`;
    const paramVisitors = await tx.$queryRaw<{ funnel_id: string; key: string; value: string; visitors: bigint }[]>`
      SELECT e.funnel_id, kv.key, kv.value, count(DISTINCT e.visitor_id) AS visitors
      FROM funnel_events e, jsonb_each_text(CASE WHEN jsonb_typeof(e.params) = 'object' THEN e.params ELSE '{}'::jsonb END) kv
      WHERE e.funnel_id = ANY(${ids}::uuid[]) AND e.created_at >= ${start} AND e.created_at < ${end} AND e.bot_reason IS NULL AND e.kind = 'view'
      GROUP BY e.funnel_id, kv.key, kv.value`;
    const paramOptins = await tx.$queryRaw<{ funnel_id: string; key: string; value: string; optins: bigint }[]>`
      SELECT p.funnel_id, kv.key, kv.value, count(*) AS optins
      FROM funnel_optins p, jsonb_each_text(CASE WHEN jsonb_typeof(p.params) = 'object' THEN p.params ELSE '{}'::jsonb END) kv
      WHERE p.funnel_id = ANY(${ids}::uuid[]) AND p.created_at >= ${start} AND p.created_at < ${end}
      GROUP BY p.funnel_id, kv.key, kv.value`;

    for (const d of devices) {
      const row = rows.get(d.funnel_id);
      if (row) row.devices[d.device] = Number(d.visitors);
    }
    for (const r of reach) rows.get(r.funnel_id)?.reach.push({ position: Number(r.position), visitors: Number(r.visitors) });
    const params = new Map<string, { funnelId: string; key: string; value: string; visitors: number; optins: number }>();
    const param = (funnelId: string, key: string, value: string) => {
      const id = `${funnelId}|${key}|${value}`;
      const existing = params.get(id) ?? { funnelId, key, value, visitors: 0, optins: 0 };
      params.set(id, existing);
      return existing;
    };
    for (const p of paramVisitors) param(p.funnel_id, p.key, p.value).visitors = Number(p.visitors);
    for (const p of paramOptins) param(p.funnel_id, p.key, p.value).optins = Number(p.optins);
    for (const p of params.values()) rows.get(p.funnelId)?.params.push({ key: p.key, value: p.value, visitors: p.visitors, optins: p.optins });
    return [...rows.values()];
  });
}

/** The prompt / note text for a period ("" when no funnel had visitors). */
export async function funnelTrafficSummary(start: Date, end: Date): Promise<string> {
  try {
    return funnelTrafficText(await funnelTraffic(start, end));
  } catch (error) {
    console.warn("[usage] funnel traffic failed", error);
    return "";
  }
}
