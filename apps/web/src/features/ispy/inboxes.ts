import { ispyDb } from "./db";

/**
 * The ISpy inbox for an address. Exact match first; else a publisher catch-all on the
 * same domain whose address is the base of this one (`oxford+club@` → `oxford@`), in
 * which case the sub-address is adopted as its own inbox under that publisher.
 */
export async function resolveInboxForAddress(address: string): Promise<string | null> {
  const lower = address.toLowerCase().trim();
  return ispyDb(async (tx) => {
    const exact = await tx.ispyInbox.findUnique({ where: { address: lower }, select: { id: true } });
    if (exact) return exact.id;
    const [local, domain] = lower.split("@");
    if (!local || !domain) return null;
    const base = local.split("+")[0]!;
    const catchAll = await tx.ispyInbox.findFirst({ where: { level: "PUBLISHER_CATCHALL", address: `${base}@${domain}` }, select: { id: true, provider: true, feed: true, publisherId: true } });
    if (!catchAll) return null;
    const created = await tx.ispyInbox.create({ data: { provider: catchAll.provider, level: "PUBLISHER_CATCHALL", address: lower, externalId: lower, feed: catchAll.feed, publisherId: catchAll.publisherId, status: "ACTIVE", statusNote: `Adopted from the ${base}@${domain} catch-all.` }, select: { id: true } });
    return created.id;
  });
}
