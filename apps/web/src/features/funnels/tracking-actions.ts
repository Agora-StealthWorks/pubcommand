"use server";

import { appendOrgAudit, tenantDb } from "@pubcommand/db";
import { redirect } from "next/navigation";
import { normalizeAttribution, normalizeTrackedParams } from "../../../../../modules/funnels/tracking";
import { funnelsAction, withMessage } from "./guard";

const BACK = "/funnels/settings";

/**
 * Funnels → Settings: the URL parameters every funnel in the organization
 * tracks, and first- or last-touch attribution. funnels.publish only.
 */
export async function saveFunnelsSettings(formData: FormData) {
  const ctx = await funnelsAction(BACK, "funnels.publish");
  const trackedParams = normalizeTrackedParams(formData.getAll("param").map(String));
  const attribution = normalizeAttribution(String(formData.get("attribution") ?? ""));
  const organizationId = ctx.resolved.id;
  const db = tenantDb(organizationId);
  const existing = await db.funnelsSettings.findFirst({ where: { organizationId }, select: { id: true, trackedParams: true, attribution: true } });
  let id = existing?.id;
  if (existing) {
    await db.funnelsSettings.updateMany({ where: { id: existing.id }, data: { trackedParams, attribution, updatedById: ctx.actorId } });
  } else {
    const created = await db.funnelsSettings.create({ data: { organizationId, trackedParams, attribution, updatedById: ctx.actorId }, select: { id: true } }).catch(() => null);
    if (created) id = created.id;
    else {
      // Another save created the row first: update it.
      const row = await db.funnelsSettings.findFirst({ where: { organizationId }, select: { id: true } });
      if (!row) redirect(withMessage(BACK, "error", "Could not save. Try again."));
      await db.funnelsSettings.updateMany({ where: { id: row.id }, data: { trackedParams, attribution, updatedById: ctx.actorId } });
      id = row.id;
    }
  }
  await appendOrgAudit(organizationId, {
    actorId: ctx.actorId,
    action: "funnels.settings.updated",
    targetType: "funnels_settings",
    targetId: id ?? organizationId,
    metadata: { trackedParams, attribution, previous: existing ? { trackedParams: existing.trackedParams, attribution: existing.attribution } : null },
  });
  redirect(withMessage(BACK, "notice", trackedParams.length ? "Saved." : "Saved. No parameters are tracked now."));
}
