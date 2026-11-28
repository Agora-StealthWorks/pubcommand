import { appendOrgAudit, organizationHasModule } from "@pubcommand/db";
import { ispyDb } from "./db";
import { provisionFromPublicationSetup } from "./admin";

/** Called after Publication Setup creates a publication. Never throws. */
export async function provisionIspyPublication(input: { organizationId: string; brandId: string; calendarPublicationId: string; name: string; actorId: string | null }): Promise<void> {
  try {
    if (!(await organizationHasModule(input.organizationId, "intel"))) return;
    const brand = await ispyDb((tx) => tx.brand.findUnique({ where: { id: input.brandId }, select: { niche: true } }));
    const made = await provisionFromPublicationSetup({ ...input, niche: brand?.niche ?? null });
    if (made) {
      await appendOrgAudit(input.organizationId, { actorId: input.actorId, action: "ispy.publication.provisioned", targetType: "ispy_publication", targetId: made.publicationId, metadata: { inboxCreated: Boolean(made.inbox) } });
    }
  } catch (error) {
    console.error("[ispy] provisioning failed", input.calendarPublicationId, error);
  }
}
