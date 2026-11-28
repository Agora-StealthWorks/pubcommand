import { tenantDb } from "@pubcommand/db";
import { DEFAULT_TRACKED_PARAMS, normalizeAttribution, normalizeTrackedParams, pickTrackedParams, trackedQuery, type Attribution } from "../../../../../modules/funnels/tracking";

export type FunnelsSettingsView = { id: string | null; trackedParams: string[]; attribution: Attribution };

/**
 * The organization's Funnels settings (Funnels → Settings). Until an admin
 * saves, every funnel tracks the five utm_ parameters with first-touch
 * attribution. A saved empty list turns tracking off.
 */
export async function loadFunnelsSettings(organizationId: string): Promise<FunnelsSettingsView> {
  const row = await tenantDb(organizationId)
    .funnelsSettings.findFirst({ where: { organizationId }, select: { id: true, trackedParams: true, attribution: true } })
    .catch(() => null);
  if (!row) return { id: null, trackedParams: [...DEFAULT_TRACKED_PARAMS], attribution: "first" };
  return { id: row.id, trackedParams: normalizeTrackedParams(row.trackedParams), attribution: normalizeAttribution(row.attribution) };
}

/**
 * "?utm_source=…" for the tracked parameters in a page's query, so the front
 * door's redirect to a module keeps them (the module page's sync call reads them
 * from its address). "" when there are none.
 */
export async function trackedCarry(organizationId: string, query: Record<string, unknown>): Promise<string> {
  const settings = await loadFunnelsSettings(organizationId);
  const text = trackedQuery(pickTrackedParams(query, settings.trackedParams));
  return text ? `?${text}` : "";
}
