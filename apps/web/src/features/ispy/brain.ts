import { aiConfigured, runStructured } from "@pubcommand/ai";
import type { Prisma } from "@pubcommand/db";
import {
  COPY_EXTRACTION_SCHEMA,
  COPY_EXTRACTION_SYSTEM,
  copyExtractionPrompt,
  copyNote,
  liftType,
  normalizeCopyExtraction,
  typeFromHint,
  canonListName,
  type CopyExtraction,
  type Owner,
} from "../../../../../modules/ispy/index";
import { withNicheFrontmatter } from "../../../../../modules/knowledge/main-brain";
import { ensureConsoleOrganization } from "@/lib/console-workspace";
import { logAiUsage } from "../ai/usage";
import { teachBrain } from "../brain/teach";
import { mainBrain } from "../main-brain/db";
import { uniqueMainSlug } from "../main-brain/learn";
import { ispyDb, type IspyTx } from "./db";

export function asCopyExtraction(value: unknown): CopyExtraction | null {
  return value && typeof value === "object" ? normalizeCopyExtraction(value) : null;
}

/** The one small AI call for a new copy. Re-sends never call this. */
export async function extractCopy(copyId: string): Promise<"DONE" | "NONE" | "FAILED"> {
  const copy = await ispyDb((tx) =>
    tx.ispyCopy.findUnique({
      where: { id: copyId },
      select: { id: true, feed: true, extractionStatus: true, emails: { take: 1, orderBy: { receivedAt: "asc" }, select: { fromName: true, fromAddress: true, subject: true, textBody: true, promo: { select: { headline: true } } } } },
    }),
  );
  const first = copy?.emails[0];
  if (!copy || !first) return "NONE";
  if (!aiConfigured()) {
    await ispyDb((tx) => tx.ispyCopy.update({ where: { id: copyId }, data: { extractionStatus: "NONE", extractionError: "The AI key is not set. Add ANTHROPIC_API_KEY." } }));
    return "NONE";
  }
  await ispyDb((tx) => tx.ispyCopy.update({ where: { id: copyId }, data: { extractionStatus: "RUNNING" } }));
  const answer = await runStructured<unknown>({
    system: COPY_EXTRACTION_SYSTEM,
    input: [{ type: "text", text: copyExtractionPrompt({ feed: copy.feed, fromName: first.fromName, fromAddress: first.fromAddress, subject: first.subject, text: first.textBody, landingHeadline: first.promo?.headline ?? null }) }],
    schema: COPY_EXTRACTION_SCHEMA as unknown as Record<string, unknown>,
    effort: "low",
    maxTokens: 2500,
  });
  if ("usage" in answer && answer.usage) {
    const orgId = await ensureConsoleOrganization().catch(() => null);
    if (orgId) await logAiUsage({ organizationId: orgId, moduleId: "intel", feature: "ispy.extract", actorId: null, usage: answer.usage }).catch(() => undefined);
  }
  if (answer.status !== "ok") {
    await ispyDb((tx) => tx.ispyCopy.update({ where: { id: copyId }, data: { extractionStatus: answer.status === "unavailable" ? "NONE" : "FAILED", extractionError: answer.reason.slice(0, 500) } }));
    return answer.status === "unavailable" ? "NONE" : "FAILED";
  }
  const extraction = normalizeCopyExtraction(answer.data);
  await ispyDb((tx) =>
    tx.ispyCopy.update({
      where: { id: copyId },
      data: { extraction: extraction as unknown as Prisma.InputJsonValue, extractionStatus: "DONE", extractionError: null, title: (extraction.headline ?? undefined)?.slice(0, 300) },
    }),
  );
  return "DONE";
}

async function ownerOf(tx: IspyTx, publisherId: string | null, publicationId: string | null): Promise<Owner> {
  if (!publisherId) return { publisherId: null, publicationId, groupId: null };
  const p = await tx.ispyPublisher.findUnique({ where: { id: publisherId }, select: { parentId: true } });
  return { publisherId, publicationId, groupId: p?.parentId ?? null };
}

/**
 * Decide a copy's type: the landing page's owner first (promo / internal lift / external
 * lift), else the AI hint with the promoted brand matched against the registry. A staff
 * override sticks. The type is copied onto every send of the copy.
 */
export async function decideCopyType(copyId: string): Promise<void> {
  await ispyDb(async (tx) => {
    const copy = await tx.ispyCopy.findUnique({
      where: { id: copyId },
      select: { typeOverridden: true, emailType: true, extraction: true, promoId: true, emails: { take: 1, orderBy: { receivedAt: "asc" }, select: { publisherId: true, publicationId: true } } },
    });
    if (!copy) return;
    let type = copy.emailType;
    if (!copy.typeOverridden) {
      const first = copy.emails[0];
      const sender = await ownerOf(tx, first?.publisherId ?? null, first?.publicationId ?? null);
      const extraction = asCopyExtraction(copy.extraction);
      let decided: string | null = null;
      if (copy.promoId && extraction?.typeHint !== "editorial" && extraction?.typeHint !== "welcome") {
        const promo = await tx.ispyPromo.findUnique({ where: { id: copy.promoId }, select: { advertiser: { select: { publisherId: true, isPlatform: true } } } });
        if (promo?.advertiser.publisherId && !promo.advertiser.isPlatform) decided = liftType(sender, await ownerOf(tx, promo.advertiser.publisherId, null));
      }
      if (!decided && extraction) {
        let isSender: boolean | null = null;
        let sameGroup: boolean | null = null;
        if (extraction.promotedBrand) {
          const want = canonListName(extraction.promotedBrand);
          const pubs = await tx.ispyPublisher.findMany({ where: { deletedAt: null }, select: { id: true, name: true, parentId: true, publications: { select: { name: true } } } });
          const hit = pubs.find((p) => canonListName(p.name) === want || p.publications.some((x) => canonListName(x.name) === want));
          if (hit) {
            isSender = hit.id === sender.publisherId;
            sameGroup = !!sender.publisherId && (hit.parentId ?? hit.id) === (sender.groupId ?? sender.publisherId);
          }
        }
        decided = typeFromHint(extraction.typeHint, { promotedBrandIsSender: isSender, promotedBrandIsSameGroup: sameGroup });
      }
      type = decided ?? (copy.promoId ? "PROMO" : "OTHER");
      await tx.ispyCopy.update({ where: { id: copyId }, data: { emailType: type } });
    }
    const extraction = asCopyExtraction(copy.extraction);
    await tx.ispyEmail.updateMany({ where: { copyId }, data: { emailType: type, ...(extraction ? { topics: extraction.topics, gurus: extraction.gurus } : {}) } });
  });
}

type NoteContext = {
  note: { title: string; body: string };
  feed: string;
  folderKind: string;
  publisherName: string;
  linked: { organizationId: string; brandId: string | null; publication: string }[];
};

async function noteContext(copyId: string): Promise<NoteContext | null> {
  return ispyDb(async (tx) => {
    const copy = await tx.ispyCopy.findUnique({
      where: { id: copyId },
      select: {
        title: true,
        feed: true,
        emailType: true,
        extraction: true,
        normalized: true,
        promoId: true,
        emails: {
          orderBy: { receivedAt: "asc" },
          take: 200,
          select: { receivedAt: true, subject: true, sendKind: true, textBody: true, publisherId: true, publicationId: true, list: { select: { name: true } } },
        },
      },
    });
    if (!copy || !copy.emails.length) return null;
    const first = copy.emails[0]!;
    const publisherIds = [...new Set(copy.emails.map((e) => e.publisherId).filter((x): x is string => !!x))];
    const publicationIds = [...new Set(copy.emails.map((e) => e.publicationId).filter((x): x is string => !!x))];
    const [publishers, publications, promo] = await Promise.all([
      tx.ispyPublisher.findMany({ where: { id: { in: publisherIds } }, select: { id: true, name: true, type: true, linkedOrganizationId: true, linkedBrandId: true } }),
      tx.ispyPublication.findMany({ where: { id: { in: publicationIds } }, select: { id: true, name: true, linkedOrganizationId: true, linkedBrandId: true, publisherId: true } }),
      copy.promoId ? tx.ispyPromo.findUnique({ where: { id: copy.promoId }, select: { advertiserLabel: true, advertiser: { select: { label: true } } } }) : null,
    ]);
    const firstPublisher = publishers.find((p) => p.id === first.publisherId);
    const linked: NoteContext["linked"] = [];
    for (const pub of publications) {
      const orgId = pub.linkedOrganizationId ?? publishers.find((p) => p.id === pub.publisherId)?.linkedOrganizationId ?? null;
      if (orgId) linked.push({ organizationId: orgId, brandId: pub.linkedBrandId ?? publishers.find((p) => p.id === pub.publisherId)?.linkedBrandId ?? null, publication: pub.name });
    }
    for (const p of publishers) if (p.linkedOrganizationId && !linked.some((l) => l.organizationId === p.linkedOrganizationId)) linked.push({ organizationId: p.linkedOrganizationId, brandId: p.linkedBrandId, publication: p.name });
    const note = copyNote({
      title: copy.title,
      feed: copy.feed,
      emailType: copy.emailType,
      publisher: firstPublisher?.name ?? null,
      advertiser: promo?.advertiserLabel ?? promo?.advertiser.label ?? null,
      extraction: asCopyExtraction(copy.extraction),
      sends: copy.emails.map((e) => ({ date: e.receivedAt, list: e.list?.name ?? null, kind: e.sendKind, subject: e.subject })),
      text: first.textBody,
    });
    const kind = first.sendKind === "AFFILIATE" ? "Affiliate" : firstPublisher?.type === "INTERNAL" || linked.length ? "Internal" : "External";
    return { note, feed: copy.feed, folderKind: kind, publisherName: (firstPublisher?.name ?? "Unknown").replace(/[/\\]/g, "-"), linked };
  });
}

/**
 * Write (or refresh) the copy's markdown note. A copy from a publication linked to an
 * organization teaches that brand's Brain (which learns up into the Master Brain with
 * provenance); every other copy goes straight into the Master Brain under ISpy/.
 * No AI here: it reuses the copy's one extraction.
 */
export async function syncCopyNote(copyId: string): Promise<void> {
  const ctx = await noteContext(copyId);
  if (!ctx) return;
  const niche = ctx.feed === "HEALTH" ? "health" : "finance";
  const brandTargets = ctx.linked.filter((l) => l.brandId);
  if (brandTargets.length) {
    for (const target of brandTargets) {
      await teachBrain({
        organizationId: target.organizationId,
        brandId: target.brandId,
        sourceRef: `ispy-copy:${copyId}`,
        title: ctx.note.title,
        body: ctx.note.body,
        folder: `Our publications/${target.publication.replace(/[/\\]/g, "-")}`,
        source: "ispy",
        actorId: null,
        niche,
      });
    }
  } else {
    const key = `ispy:copy:${copyId}`;
    const folder = `ISpy/${ctx.feed === "HEALTH" ? "Health" : "FinPub"}/${ctx.folderKind}/${ctx.publisherName}`;
    const body = withNicheFrontmatter(ctx.note.body, niche);
    await mainBrain(async (tx) => {
      const existing = await tx.mainBrainNote.findUnique({ where: { key }, select: { id: true, editedAt: true, deletedAt: true, body: true } });
      if (existing?.deletedAt || existing?.editedAt) return;
      if (existing) {
        if (existing.body !== body) await tx.mainBrainNote.update({ where: { id: existing.id }, data: { title: ctx.note.title, body, folder, niche, learnedAt: new Date() } });
        return;
      }
      await tx.mainBrainNote.create({ data: { key, title: ctx.note.title, slug: await uniqueMainSlug(tx, ctx.note.title), body, folder, origin: "LEARNED", niche, source: "ispy", originSourceRef: key, learnedAt: new Date() } });
    }).catch((error: unknown) => console.error("[ispy] master note failed", copyId, error));
  }
  await ispyDb((tx) => tx.ispyCopy.update({ where: { id: copyId }, data: { brainSyncedAt: new Date() } }));
}

/**
 * After ingest: for each touched copy, extract it once (new copies only), decide its type,
 * then refresh its note. Called by the poll/sync jobs and the inbound webhook.
 */
export async function processCopies(copyIds: readonly string[], options: { extract?: boolean } = {}): Promise<{ extracted: number }> {
  let extracted = 0;
  for (const id of new Set(copyIds)) {
    const status = await ispyDb((tx) => tx.ispyCopy.findUnique({ where: { id }, select: { extractionStatus: true } }));
    if (options.extract !== false && status?.extractionStatus === "QUEUED") {
      if ((await extractCopy(id)) === "DONE") extracted += 1;
    }
    await decideCopyType(id).catch((error: unknown) => console.error("[ispy] type failed", id, error));
    await syncCopyNote(id).catch((error: unknown) => console.error("[ispy] note failed", id, error));
  }
  return { extracted };
}

/** Catch-up: copies whose sends changed since their note was written. */
export async function staleCopyIds(limit = 200): Promise<string[]> {
  const rows = await ispyDb((tx) =>
    tx.$queryRaw<{ id: string }[]>`SELECT id FROM ispy_copies WHERE merged_into_id IS NULL AND (brain_synced_at IS NULL OR brain_synced_at < updated_at - interval '10 seconds') ORDER BY updated_at ASC LIMIT ${limit}`,
  );
  return rows.map((r) => r.id);
}


const DEEP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["complianceRisk", "complianceNotes", "leadType", "hook", "bigIdea", "proof", "urgency", "offerStructure", "whatWorks", "notableFor"],
  properties: {
    complianceRisk: { type: "string", enum: ["HIGH", "MEDIUM", "LOW", "NONE"] },
    complianceNotes: { type: "array", items: { type: "string" } },
    leadType: { type: "string" },
    hook: { type: "string" },
    bigIdea: { type: "string" },
    proof: { type: "array", items: { type: "string" } },
    urgency: { type: "array", items: { type: "string" } },
    offerStructure: { type: "string" },
    whatWorks: { type: "array", items: { type: "string" } },
    notableFor: { type: "string", enum: ["COPY", "EDITORIAL", "COMPLIANCE", "PRODUCT", "ALL"] },
  },
} as const;

const DEEP_SYSTEM = `You are a senior direct-response copy chief reviewing one publisher email for editors and copywriters. Record only what the email says; describe claims, never repeat them as true; never invent numbers, prices or names. complianceRisk rates implied guarantees of returns or health outcomes, missing disclaimers and urgency that misleads.`;

/** iSpy's second pass, now only on request ("Deep analyze"): one bigger AI call per copy. */
export async function deepAnalyzeCopy(copyId: string): Promise<{ ok: true } | { error: string }> {
  if (!aiConfigured()) return { error: "The AI key is not set. Add ANTHROPIC_API_KEY." };
  const copy = await ispyDb((tx) => tx.ispyCopy.findUnique({ where: { id: copyId }, select: { feed: true, emails: { take: 1, orderBy: { receivedAt: "asc" }, select: { subject: true, fromName: true, fromAddress: true, textBody: true } } } }));
  const first = copy?.emails[0];
  if (!copy || !first) return { error: "That copy no longer exists." };
  const answer = await runStructured<Record<string, unknown>>({
    system: DEEP_SYSTEM,
    input: [{ type: "text", text: copyExtractionPrompt({ feed: copy.feed, fromName: first.fromName, fromAddress: first.fromAddress, subject: first.subject, text: first.textBody }) }],
    schema: DEEP_SCHEMA as unknown as Record<string, unknown>,
    effort: "medium",
    maxTokens: 4000,
  });
  if ("usage" in answer && answer.usage) {
    const orgId = await ensureConsoleOrganization().catch(() => null);
    if (orgId) await logAiUsage({ organizationId: orgId, moduleId: "intel", feature: "ispy.deep-analyze", actorId: null, usage: answer.usage }).catch(() => undefined);
  }
  if (answer.status !== "ok") return { error: answer.reason };
  await ispyDb((tx) => tx.ispyCopy.update({ where: { id: copyId }, data: { deepAnalysis: { ...answer.data, analyzedAt: new Date().toISOString() } as Prisma.InputJsonValue } }));
  return { ok: true };
}
