import { organizationPublicUrl } from "@pubcommand/core";
import { rawPrisma, tenantDb } from "@pubcommand/db";
import { pullProfile, pushProfile } from "@/features/support/platform";
import { defineJob } from "@/lib/jobs/types";
import { entitledOrgs } from "./support-pubsetup-sync";

/**
 * ElevenLabs two-way sync for agents with auto-sync on: pull first (edits made in ElevenLabs
 * go to review and are held), then push what changed here. Hash-compared, so a quiet slot
 * makes only read calls.
 */
export const supportPlatformSync = defineJob({
  name: "support.platform-sync",
  description: "Support Knowledge: pull edits from ElevenLabs and push changed knowledge to auto-sync agents.",
  schedule: "*/15 * * * *",
  timeoutMs: 14 * 60 * 1000,
  async run() {
    const profiles = await rawPrisma().supportAgentProfile.findMany({ where: { deletedAt: null, active: true, autoSync: true, platform: "elevenlabs" }, select: { id: true, organizationId: true } });
    const entitled = await entitledOrgs(profiles.map((p) => p.organizationId));
    const origins = new Map<string, string>();
    const totals = { agents: 0, pulledChanges: 0, created: 0, updated: 0, removed: 0, failed: 0 };
    for (const profile of profiles) {
      if (!entitled.has(profile.organizationId)) continue;
      if (!origins.has(profile.organizationId)) origins.set(profile.organizationId, await orgOrigin(profile.organizationId));
      try {
        const pulled = await pullProfile({ organizationId: profile.organizationId, profileId: profile.id });
        const pushed = await pushProfile({ organizationId: profile.organizationId, profileId: profile.id, origin: origins.get(profile.organizationId) as string });
        totals.agents += 1;
        totals.pulledChanges += pulled.changed;
        totals.created += pushed.create;
        totals.updated += pushed.update;
        totals.removed += pushed.remove;
        if (pushed.errors.length || pulled.errors.length) totals.failed += 1;
      } catch {
        totals.failed += 1;
        await tenantDb(profile.organizationId).supportAgentProfile.updateMany({ where: { id: profile.id }, data: { syncStatus: "failed" } });
      }
    }
    return totals;
  },
});

/** The org host the pushed tools call back to. */
async function orgOrigin(organizationId: string): Promise<string> {
  const org = await rawPrisma().organization.findUnique({ where: { id: organizationId }, select: { slug: true } });
  return organizationPublicUrl(org?.slug ?? "app", process.env.ROOT_DOMAIN ?? "localhost");
}
