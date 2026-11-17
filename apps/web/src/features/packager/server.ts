import { runStructured, type AiInput } from "@pubcommand/ai";
import { brandProfile, brandPromptContext } from "@pubcommand/core";
import { tenantDb, type Prisma } from "@pubcommand/db";
import { logAiUsage } from "../ai/usage";
import { teachBrain } from "../brain/teach";
import { publicationPromptBlock } from "../pubsetup/read";
import type { PromoAnalysisResult } from "../../../../../modules/promo-studio/analysis";
import {
  COMPONENT_SCHEMA,
  checkClaims,
  componentMarkdown,
  componentPrompt,
  componentSpec,
  packageBrainNote,
  packagerSystem,
  parseDirection,
  rankNotes,
  type BestPerformer,
  type BrainNote,
  type GeneratedComponent,
  modelFor,
  type PromoContext,
} from "../../../../../modules/promo-studio/packager";
import { RESEARCH_SCHEMA, findingsBlock, normalizeFindings, parseFindings, researchPrompt, researchSystem, withSources, type Finding, type ResearchAnswer } from "../../../../../modules/promo-studio/timely";
import { examplesBlock, excludeRefsFor, rankExamples } from "../../../../../modules/promo-studio/training";
import { libraryFor } from "./training";

/** A generation stuck this long (server restarted mid-run) is shown as interrupted. */
export const STALE_GEN_MS = 15 * 60 * 1000;

export type BrandFields = { id: string; name: string; niche?: string | null; audience?: string | null; complianceNotes?: string | null };

type Db = ReturnType<typeof tenantDb>;

export function isGenStale(status: string, updatedAt: Date): boolean {
  return (status === "RUNNING" || status === "QUEUED") && Date.now() - updatedAt.getTime() > STALE_GEN_MS;
}

/** Text whose figures count as "from the source" for the claims check. */
export function allowedText(promo: { sourceText: string }, analysis: PromoAnalysisResult | null, offerDetails: string): string {
  const offer = analysis ? [analysis.offer.price, analysis.offer.term, analysis.offer.guarantee, analysis.offer.urgency, analysis.offer.summary, ...analysis.offer.bonuses].join("\n") : "";
  return [promo.sourceText, offer, offerDetails].join("\n");
}

async function latestAnalysis(db: Db, promoId: string): Promise<PromoAnalysisResult | null> {
  const row = await db.promoAnalysis.findFirst({ where: { promoId }, orderBy: { version: "desc" }, select: { result: true } });
  return row ? (row.result as unknown as PromoAnalysisResult) : null;
}

async function bestPerformers(db: Db, brandId: string, promoId: string): Promise<BestPerformer[]> {
  const promos = await db.promo.findMany({
    where: { brandId, deletedAt: null, isBestPerformer: true, id: { not: promoId } },
    select: { id: true, title: true, sourceText: true },
    orderBy: [{ performanceScore: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
    take: 3,
  });
  return Promise.all(
    promos.map(async (promo) => {
      const analysis = await latestAnalysis(db, promo.id);
      return {
        title: promo.title,
        headline: analysis?.headline.headline ?? "",
        bigIdea: analysis?.sixteenWord.bigIdea ?? "",
        lessons: analysis?.lessons ?? [],
        excerpt: promo.sourceText.slice(0, 2500),
      };
    }),
  );
}

async function brainNotes(db: Db, brandId: string, promoId: string, packageId: string): Promise<BrainNote[]> {
  const rows = await db.knowledgePage.findMany({
    where: {
      OR: [{ brandId }, { visibility: "SHARED" }],
      NOT: { sourceRef: { in: [`promo:${promoId}`, `package:${packageId}`] } },
    },
    select: { title: true, body: true },
    orderBy: { updatedAt: "desc" },
    take: 80,
  });
  return rows.map((row) => ({ title: row.title, body: row.body }));
}

const running = new Set<string>();

export type GenerationRequest = { componentId: string; feedback?: string | null };

/**
 * Live web research for a package's timely hooks. The model searches the web
 * and must give a source link for every finding; findings without one are
 * dropped. Nothing found is a fact until an editor ticks it as checked.
 */
export async function runPackageResearch(input: { organizationId: string; packageId: string; brand: BrandFields; actorId: string | null }): Promise<void> {
  const db = tenantDb(input.organizationId);
  const pkg = await db.promoPackage.findFirst({ where: { id: input.packageId, deletedAt: null } });
  if (!pkg) return;
  const fail = (reason: string) => db.promoPackage.updateMany({ where: { id: pkg.id }, data: { researchStatus: "FAILED", researchError: reason.slice(0, 1000) } }).catch(() => undefined);
  try {
    const promo = await db.promo.findFirst({ where: { id: pkg.promoId, deletedAt: null }, select: { id: true, title: true, product: true } });
    if (!promo) return;
    await db.promoPackage.updateMany({ where: { id: pkg.id }, data: { researchStatus: "RUNNING", researchError: null } });
    const profile = brandProfile(input.brand);
    const analysis = await latestAnalysis(db, promo.id);
    const direction = parseDirection(pkg.direction);
    const answer = await runStructured<ResearchAnswer>({
      system: researchSystem(profile.niche),
      input: [
        {
          type: "text",
          text: researchPrompt({
            brandContext: brandPromptContext(profile),
            today: new Date().toISOString().slice(0, 10),
            title: promo.title,
            product: promo.product,
            bigIdea: analysis?.sixteenWord.bigIdea ?? "",
            summary: analysis?.summary ?? "",
            angle: direction.angle,
            eventName: direction.event?.name ?? null,
          }),
        },
      ],
      schema: RESEARCH_SCHEMA,
      effort: "medium",
      maxTokens: 16000,
      webSearch: { maxUses: 5 },
    });
    if ("usage" in answer && answer.usage) {
      await logAiUsage({ organizationId: input.organizationId, moduleId: "promo-studio", feature: "packager.research", actorId: input.actorId, usage: answer.usage });
    }
    if (answer.status !== "ok") return void (await fail(answer.reason));
    const findings = normalizeFindings(answer.data, parseFindings(pkg.research));
    await db.promoPackage.updateMany({
      where: { id: pkg.id },
      data: { research: findings as unknown as Prisma.InputJsonValue, researchStatus: "DONE", researchError: null, researchedAt: new Date() },
    });
  } catch (error) {
    await fail(error instanceof Error ? error.message : "The web research failed.");
  }
}

/**
 * Write (or rewrite) components of one package. Runs after the response; each
 * component has its own status that the package page polls.
 */
export async function runPackageGeneration(input: {
  organizationId: string;
  packageId: string;
  brand: BrandFields;
  actorId: string | null;
  requests: GenerationRequest[];
}): Promise<void> {
  const db = tenantDb(input.organizationId);
  const pkg = await db.promoPackage.findFirst({ where: { id: input.packageId, deletedAt: null } });
  if (!pkg) return;
  const promo = await db.promo.findFirst({ where: { id: pkg.promoId, deletedAt: null } });
  if (!promo) return;
  const ids = input.requests.map((r) => r.componentId);
  try {
    const profile = brandProfile(input.brand);
    // When the promo's product is one of the brand's publications (Publication Setup), its
    // positioning, audience, voice and editors ride along with the brand context.
    const publicationBlock = await publicationPromptBlock(input.organizationId, promo.brandId, promo.product).catch(() => "");
    const brandContext = [brandPromptContext(profile), publicationBlock].filter(Boolean).join("\n\n");
    const direction = parseDirection(pkg.direction);
    const analysis = await latestAnalysis(db, promo.id);
    const [performers, notes] = await Promise.all([bestPerformers(db, promo.brandId, promo.id), brainNotes(db, promo.brandId, promo.id, pkg.id)]);
    const pdf: AiInput[] = [];
    if (promo.inputType === "scanned-pdf") {
      const source = await db.promoFile.findFirst({ where: { promoId: promo.id, kind: "source" } });
      if (source) pdf.push({ type: "pdf", base64: Buffer.from(source.data).toString("base64"), title: promo.title });
    }
    const context: PromoContext = {
      title: promo.title,
      product: promo.product,
      publisher: promo.publisher,
      gurus: promo.gurus,
      sourceText: promo.sourceText,
      analysis: analysis
        ? {
            summary: analysis.summary,
            bigIdea: analysis.sixteenWord.bigIdea,
            headline: analysis.headline.headline,
            offer: analysis.offer,
            strengths: analysis.strengths,
            lessons: analysis.lessons,
            compliance: analysis.compliance ?? [],
          }
        : null,
    };
    const allowed = allowedText(promo, analysis, direction.offerDetails);
    const system = packagerSystem(profile.niche);

    // Components that use timely hooks need the package's web research first (once).
    const kinds = await db.promoPackageComponent.findMany({ where: { packageId: pkg.id }, select: { id: true, kind: true } });
    const wantsResearch = kinds.some((c) => ids.includes(c.id) && componentSpec(c.kind)?.research);
    if (wantsResearch && pkg.researchStatus === "NONE") await runPackageResearch({ organizationId: input.organizationId, packageId: pkg.id, brand: input.brand, actorId: input.actorId });
    const fresh = wantsResearch ? await db.promoPackage.findFirst({ where: { id: pkg.id }, select: { research: true } }) : null;
    const findings: Finding[] = parseFindings(fresh?.research ?? pkg.research);
    const library = await libraryFor(input.organizationId, promo.brandId);
    const excludeRefs = excludeRefsFor(kinds.map((c) => c.id), promo.id);

    const one = async (request: GenerationRequest) => {
      const key = `${input.organizationId}:${request.componentId}`;
      if (running.has(key)) return;
      running.add(key);
      try {
        const component = await db.promoPackageComponent.findFirst({ where: { id: request.componentId, packageId: pkg.id } });
        const spec = component ? componentSpec(component.kind) : undefined;
        if (!component || !spec) return;
        await db.promoPackageComponent.updateMany({ where: { id: component.id }, data: { genStatus: "RUNNING", genError: null } });
        const query = `${spec.label} ${spec.itemName} ${promo.title} ${promo.product ?? ""} ${context.analysis?.bigIdea ?? ""} ${direction.angle}`;
        const previous = request.feedback != null && component.content.trim() ? { content: component.content, feedback: request.feedback } : null;
        const picked = rankExamples(library, { kind: spec.kind, publication: promo.publisher, niche: profile.niche, excludeRefs });
        await db.promoPackageComponent.updateMany({ where: { id: component.id }, data: { examplesUsed: picked.map((e) => ({ id: e.id, title: e.title })) as unknown as Prisma.InputJsonValue } });
        const text = componentPrompt({
          brandContext,
          promo: context,
          direction,
          spec,
          quantity: component.quantity,
          bestPerformers: performers,
          brainNotes: rankNotes(notes, query, 4).map((note) => ({ title: note.title, body: note.body.slice(0, 1500) })),
          previous,
          examples: examplesBlock(picked),
          research: spec.research ? findingsBlock(findings, spec.research) : "",
        });
        const answer = await runStructured<GeneratedComponent>({
          system,
          input: [...pdf, { type: "text", text }],
          schema: COMPONENT_SCHEMA,
          // Launch copy gets the premium model and more effort; short ads a faster model.
          model: modelFor(spec.tier, process.env),
          effort: spec.effort,
          maxTokens: 48000,
        });
        if (answer.status !== "ok") {
          if ("usage" in answer && answer.usage) {
            await logAiUsage({ organizationId: input.organizationId, moduleId: "promo-studio", feature: "packager.generate", actorId: input.actorId, usage: answer.usage });
          }
          await db.promoPackageComponent.updateMany({ where: { id: component.id }, data: { genStatus: "FAILED", genError: answer.reason } });
          return;
        }
        await logAiUsage({ organizationId: input.organizationId, moduleId: "promo-studio", feature: "packager.generate", actorId: input.actorId, usage: answer.usage });
        // Research-backed internal pieces carry the source links from the research itself.
        const content = spec.research === "internal" ? withSources(componentMarkdown(spec, answer.data), findings) : componentMarkdown(spec, answer.data);
        await saveVersion(db, {
          organizationId: input.organizationId,
          componentId: component.id,
          packageId: pkg.id,
          content,
          source: previous ? "regenerate" : "ai",
          feedback: previous ? request.feedback || null : null,
          model: answer.usage.model,
          inputTokens: answer.usage.inputTokens,
          outputTokens: answer.usage.outputTokens,
          actorId: input.actorId,
          flags: checkClaims(content, { niche: profile.niche, allowedText: allowed, rules: profile.complianceRules }),
          status: "DRAFT",
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Writing this component failed.";
        await db.promoPackageComponent.updateMany({ where: { id: request.componentId }, data: { genStatus: "FAILED", genError: reason } }).catch(() => undefined);
      } finally {
        running.delete(key);
      }
    };

    // Two at a time: fast enough for a full package without flooding the AI.
    const queue = [...input.requests];
    await Promise.all(
      [0, 1].map(async () => {
        for (let next = queue.shift(); next; next = queue.shift()) await one(next);
      }),
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The package run failed.";
    await db.promoPackageComponent
      .updateMany({ where: { id: { in: ids }, genStatus: { in: ["QUEUED", "RUNNING"] } }, data: { genStatus: "FAILED", genError: reason } })
      .catch(() => undefined);
  }
}

/** Store a new version as the component's current copy. Any change reopens an approved package. */
export async function saveVersion(
  db: Db,
  input: {
    organizationId: string;
    componentId: string;
    packageId: string;
    content: string;
    source: "ai" | "regenerate" | "edit" | "restore";
    feedback?: string | null;
    model?: string | null;
    inputTokens?: number;
    outputTokens?: number;
    actorId: string | null;
    flags: unknown[];
    status?: "DRAFT" | "NEEDS_EDITS" | "APPROVED";
  },
): Promise<number> {
  const last = await db.promoPackageComponentVersion.findFirst({ where: { componentId: input.componentId }, orderBy: { version: "desc" }, select: { version: true } });
  const version = (last?.version ?? 0) + 1;
  await db.promoPackageComponentVersion.create({
    data: {
      organizationId: input.organizationId,
      componentId: input.componentId,
      version,
      source: input.source,
      content: input.content,
      feedback: input.feedback ?? null,
      model: input.model ?? null,
      inputTokens: input.inputTokens ?? 0,
      outputTokens: input.outputTokens ?? 0,
      createdById: input.actorId,
    },
  });
  await db.promoPackageComponent.updateMany({
    where: { id: input.componentId },
    data: {
      content: input.content,
      currentVersion: version,
      genStatus: "DONE",
      genError: null,
      flags: input.flags as Prisma.InputJsonValue,
      ...(input.status ? { status: input.status } : {}),
    },
  });
  await reopenIfApproved(db, input.packageId);
  return version;
}

export async function reopenIfApproved(db: Db, packageId: string): Promise<void> {
  await db.promoPackage.updateMany({ where: { id: packageId, status: "APPROVED" }, data: { status: "DRAFT", approvedAt: null, approvedById: null } });
}

/** Teach the brand's mini-brain what an approved package looks like. */
export async function teachApprovedPackage(input: {
  organizationId: string;
  brandId: string;
  brandName: string;
  actorId: string | null;
  pkg: { id: string; title: string; direction: unknown };
  promoTitle: string;
  components: { kind: string; label: string; quantity: number; status: string; content: string }[];
}): Promise<void> {
  const note = packageBrainNote({
    title: input.pkg.title,
    promoTitle: input.promoTitle,
    brandName: input.brandName,
    direction: parseDirection(input.pkg.direction),
    components: input.components,
  });
  await teachBrain({
    organizationId: input.organizationId,
    brandId: input.brandId,
    sourceRef: `package:${input.pkg.id}`,
    title: note.title,
    body: note.body,
    folder: "Copy packages",
    source: "packager",
    actorId: input.actorId,
  });
}
