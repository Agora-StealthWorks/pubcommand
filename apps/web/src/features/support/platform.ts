import { tenantDb, type Prisma } from "@pubcommand/db";
import { strToU8, zipSync } from "fflate";
import {
  configureAgent,
  createDocument,
  createSecret,
  createTool,
  deleteDocument,
  deleteTool,
  ElevenLabsError,
  getAgent,
  getDocumentText,
  updateDocument,
  updateTool,
  webhookToolConfig,
  type ElevenClient,
  type Fetch,
} from "../../../../../modules/support/elevenlabs";
import { renderGuide } from "../../../../../modules/support/guide";
import { decryptSecret, keyMatches } from "../../../../../modules/support/keys";
import { buildDocs, contentHash, docFileName, type Doc } from "../../../../../modules/support/render";
import { normalizeScope } from "../../../../../modules/support/scope";
import { planPush, planSummary, pullDecision } from "../../../../../modules/support/sync";
import { toolsFor } from "../../../../../modules/support/tools";
import { authSecret, brandOf } from "./guard";

/**
 * ElevenLabs sync for one agent profile, with the brand's own API key (encrypted with
 * AUTH_SECRET). Push and pull are decided by content hash (modules/support/sync.ts). Runs
 * as a job (support.platform-sync) or from the agent page ("Push now"). Without a key the
 * same documents, guide and tools are exported as a bundle to upload by hand.
 */

type ProfileRow = NonNullable<Awaited<ReturnType<typeof loadProfile>>>;

async function loadProfile(organizationId: string, profileId: string) {
  return tenantDb(organizationId).supportAgentProfile.findFirst({ where: { id: profileId, deletedAt: null } });
}

export async function elevenClient(organizationId: string, brandId: string, fetchImpl: Fetch = fetch as unknown as Fetch): Promise<ElevenClient | null> {
  const row = await tenantDb(organizationId).supportConnection.findFirst({ where: { brandId, platform: "elevenlabs" } });
  if (!row) return null;
  return { apiKey: decryptSecret(row.apiKeyEnc, authSecret()), baseUrl: process.env.ELEVENLABS_API_BASE || undefined, fetch: fetchImpl };
}

/** Everything one agent can see, rendered: documents, guide and tool definitions. */
export async function agentMaterial(organizationId: string, profile: ProfileRow, origin: string) {
  const db = tenantDb(organizationId);
  const brand = await db.brand.findFirst({ where: { id: profile.brandId }, select: { name: true, niche: true, audience: true, complianceNotes: true } });
  const brandProfile = brandOf(brand ?? { name: "Brand" });
  const scope = normalizeScope(profile, brandProfile.niche);
  const records = await db.supportRecord.findMany({
    where: { brandId: profile.brandId, status: "published", category: { in: scope.categories }, audience: { in: scope.audiences } },
    select: { id: true, category: true, audience: true, status: true, title: true, body: true, url: true, publicationCodes: true, meta: true },
    take: 20_000,
  });
  const docs = buildDocs(
    records.map((r) => ({ ...r, publishedAt: typeof (r.meta as Record<string, unknown> | null)?.publishedAt === "string" ? ((r.meta as Record<string, string>).publishedAt ?? null) : null })),
    scope,
  );
  const tools = toolsFor(scope, brandProfile);
  const guide = renderGuide({ profile: { name: profile.name, personaName: profile.personaName, surface: profile.surface, scope, instructions: profile.instructions, escalation: profile.escalation }, brand: brandProfile, tools });
  return { docs, tools, guide, scope, brand: brandProfile, apiBase: origin };
}

export type PushResult = { create: number; update: number; remove: number; unchanged: number; held: number; tools: number; agentConfigured: boolean; warnings: string[]; errors: string[] };

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 400);
}

/** Push one profile's documents, tools and prompt. agentKey (optional) is used once to store the tools' auth secret. */
export async function pushProfile(input: { organizationId: string; profileId: string; origin: string; force?: boolean; agentKey?: string | null; fetchImpl?: Fetch }): Promise<PushResult> {
  const db = tenantDb(input.organizationId);
  const profile = await loadProfile(input.organizationId, input.profileId);
  if (!profile) throw new Error("That agent no longer exists.");
  const client = await elevenClient(input.organizationId, profile.brandId, input.fetchImpl);
  if (!client) throw new Error("Connect ElevenLabs first (your own API key), or download the bundle and upload it by hand.");
  const material = await agentMaterial(input.organizationId, profile, input.origin);
  const result: PushResult = { create: 0, update: 0, remove: 0, unchanged: 0, held: 0, tools: 0, agentConfigured: false, warnings: [], errors: [] };
  await db.supportAgentProfile.updateMany({ where: { id: profile.id }, data: { syncStatus: "running" } });

  // Documents, by content hash.
  const rows = await db.supportPlatformDoc.findMany({ where: { profileId: profile.id, kind: "doc" } });
  const plan = planPush(material.docs, rows.map((r) => ({ id: r.id, docKey: r.docKey, remoteId: r.remoteId, contentHash: r.contentHash, remoteHash: r.remoteHash, status: r.status })), { force: input.force });
  Object.assign(result, planSummary(plan));
  const prefix = `[${profile.name.slice(0, 40)}]`;
  const nameOf = (d: Doc) => `${prefix} ${d.name}`.slice(0, 250);
  const record = async (d: Doc, remoteId: string) => {
    const remoteHash = contentHash(await getDocumentText(client, remoteId).catch(() => d.text));
    const data = { name: nameOf(d), remoteId, contentHash: d.hash, remoteHash, status: "synced", error: null, lastPushedAt: new Date() };
    const updated = await db.supportPlatformDoc.updateMany({ where: { profileId: profile.id, kind: "doc", docKey: d.docKey }, data });
    if (!updated.count) await db.supportPlatformDoc.create({ data: { organizationId: input.organizationId, profileId: profile.id, kind: "doc", docKey: d.docKey, ...data } });
  };
  const fail = async (d: Doc, error: unknown) => {
    const msg = message(error);
    result.errors.push(`${d.docKey}: ${msg}`);
    const updated = await db.supportPlatformDoc.updateMany({ where: { profileId: profile.id, kind: "doc", docKey: d.docKey }, data: { status: "error", error: msg } });
    if (!updated.count) await db.supportPlatformDoc.create({ data: { organizationId: input.organizationId, profileId: profile.id, kind: "doc", docKey: d.docKey, name: nameOf(d), contentHash: d.hash, status: "error", error: msg } });
  };
  for (const d of plan.create) {
    try {
      await record(d, await createDocument(client, nameOf(d), d.text));
    } catch (error) {
      await fail(d, error);
    }
  }
  for (const { doc: d, row } of plan.update) {
    try {
      await updateDocument(client, row.remoteId as string, nameOf(d), d.text);
      await record(d, row.remoteId as string);
    } catch (error) {
      if (error instanceof ElevenLabsError && error.status === 404) {
        try {
          await record(d, await createDocument(client, nameOf(d), d.text));
          continue;
        } catch (inner) {
          await fail(d, inner);
          continue;
        }
      }
      await fail(d, error);
    }
  }
  for (const row of plan.remove) {
    try {
      if (row.remoteId) await deleteDocument(client, row.remoteId);
      await db.supportPlatformDoc.deleteMany({ where: { id: row.id } });
    } catch (error) {
      result.errors.push(`${row.docKey} (remove): ${message(error)}`);
    }
  }

  // Tools: webhook tools that call our API with the agent key, stored as an ElevenLabs workspace secret.
  let secretId = profile.remoteSecretId;
  if (!secretId && input.agentKey) {
    if (!keyMatches(input.agentKey.trim(), profile.keyHash)) result.errors.push("tools: that is not this agent's current key.");
    else {
      try {
        secretId = await createSecret(client, `${profile.name.slice(0, 60)} support key`, `Bearer ${input.agentKey.trim()}`);
        await db.supportAgentProfile.updateMany({ where: { id: profile.id }, data: { remoteSecretId: secretId } });
      } catch (error) {
        result.errors.push(`tools secret: ${message(error)}`);
      }
    }
  }
  const toolRows = await db.supportPlatformDoc.findMany({ where: { profileId: profile.id, kind: "tool" } });
  const previousToolIds = toolRows.map((r) => r.remoteId).filter((id): id is string => Boolean(id));
  if (!secretId) {
    if (material.tools.length) result.warnings.push("Tools were not pushed: paste the agent key once (it is stored as an ElevenLabs secret, not here).");
  } else {
    const wanted = new Map(material.tools.map((tool) => [tool.name, webhookToolConfig(tool, { apiBase: material.apiBase, secretId })]));
    for (const row of toolRows) {
      if (!wanted.has(row.docKey)) {
        try {
          if (row.remoteId) await deleteTool(client, row.remoteId);
          await db.supportPlatformDoc.deleteMany({ where: { id: row.id } });
        } catch (error) {
          result.errors.push(`tool ${row.docKey} (remove): ${message(error)}`);
        }
      }
    }
    for (const [name, config] of wanted) {
      const hash = contentHash(JSON.stringify(config));
      const row = toolRows.find((r) => r.docKey === name);
      try {
        let remoteId = row?.remoteId ?? null;
        if (remoteId && row?.contentHash === hash && !input.force) continue;
        if (remoteId) await updateTool(client, remoteId, config);
        else remoteId = await createTool(client, config);
        result.tools += 1;
        const data = { name, remoteId, contentHash: hash, status: "synced", error: null, lastPushedAt: new Date() };
        if (row) await db.supportPlatformDoc.updateMany({ where: { id: row.id }, data });
        else await db.supportPlatformDoc.create({ data: { organizationId: input.organizationId, profileId: profile.id, kind: "tool", docKey: name, ...data } });
      } catch (error) {
        result.errors.push(`tool ${name}: ${message(error)}`);
      }
    }
  }

  // The agent: prompt, opening line, attached documents and our tools.
  if (profile.remoteAgentId) {
    try {
      const promptHeld = await db.supportProposal.count({ where: { profileId: profile.id, kind: "platform-edit", sourceRef: "prompt", status: "pending" } });
      const attached = await db.supportPlatformDoc.findMany({ where: { profileId: profile.id, kind: "doc", remoteId: { not: null }, status: { in: ["synced", "remote_changed"] } } });
      const ownTools = await db.supportPlatformDoc.findMany({ where: { profileId: profile.id, kind: "tool", remoteId: { not: null } } });
      let prompt = material.guide;
      if (promptHeld && !input.force) {
        prompt = (await getAgent(client, profile.remoteAgentId)).prompt || material.guide;
        result.warnings.push("The prompt was edited in ElevenLabs and is waiting for review, so it was left as it is there.");
      }
      await configureAgent(client, profile.remoteAgentId, {
        prompt,
        firstMessage: profile.firstMessage.trim() || undefined,
        docs: attached.map((r) => ({ id: r.remoteId as string, name: r.name || r.docKey })),
        ownToolIds: ownTools.map((r) => r.remoteId as string),
        previousOwnToolIds: previousToolIds,
      });
      await db.supportAgentProfile.updateMany({ where: { id: profile.id }, data: { lastPushedPrompt: prompt } });
      result.agentConfigured = true;
    } catch (error) {
      result.errors.push(`agent: ${message(error)}`);
    }
  } else {
    result.warnings.push("No ElevenLabs agent id yet: documents and tools were uploaded but not attached to an agent.");
  }

  await db.supportAgentProfile.updateMany({
    where: { id: profile.id },
    data: { lastPushedAt: new Date(), syncStatus: result.errors.length ? "failed" : "done", lastSyncResult: JSON.parse(JSON.stringify({ push: result, at: new Date().toISOString() })) as Prisma.InputJsonValue },
  });
  return result;
}

export type PullResult = { checked: number; changed: number; recreate: number; promptChanged: boolean; errors: string[] };

/** Re-read pushed documents and the agent prompt; edits made on ElevenLabs go to the review queue. */
export async function pullProfile(input: { organizationId: string; profileId: string; fetchImpl?: Fetch }): Promise<PullResult> {
  const db = tenantDb(input.organizationId);
  const profile = await loadProfile(input.organizationId, input.profileId);
  if (!profile) throw new Error("That agent no longer exists.");
  const client = await elevenClient(input.organizationId, profile.brandId, input.fetchImpl);
  const out: PullResult = { checked: 0, changed: 0, recreate: 0, promptChanged: false, errors: [] };
  if (!client) return out;
  const rows = await db.supportPlatformDoc.findMany({ where: { profileId: profile.id, kind: "doc", status: "synced", remoteId: { not: null } } });
  for (const row of rows) {
    out.checked += 1;
    try {
      const text = await getDocumentText(client, row.remoteId as string);
      const decision = pullDecision(row, text);
      if (decision === "baseline") await db.supportPlatformDoc.updateMany({ where: { id: row.id }, data: { remoteHash: contentHash(text), lastPulledAt: new Date() } });
      else if (decision === "unchanged") await db.supportPlatformDoc.updateMany({ where: { id: row.id }, data: { lastPulledAt: new Date() } });
      else {
        out.changed += 1;
        await db.supportPlatformDoc.updateMany({ where: { id: row.id }, data: { status: "remote_changed", lastPulledAt: new Date() } });
        await db.supportProposal.create({
          data: { organizationId: input.organizationId, brandId: profile.brandId, kind: "platform-edit", title: `Edited in ElevenLabs: ${row.name || row.docKey}`.slice(0, 300), text: text.slice(0, 200_000), sourceRef: row.docKey, profileId: profile.id, targetId: row.id },
        });
      }
    } catch (error) {
      if (error instanceof ElevenLabsError && error.status === 404) {
        out.recreate += 1;
        await db.supportPlatformDoc.updateMany({ where: { id: row.id }, data: { remoteId: null, remoteHash: null, status: "pending", error: "Deleted in ElevenLabs: it will be uploaded again on the next push." } });
      } else out.errors.push(`${row.docKey}: ${message(error)}`);
    }
  }
  if (profile.remoteAgentId && profile.lastPushedPrompt) {
    try {
      const agent = await getAgent(client, profile.remoteAgentId);
      const pending = await db.supportProposal.count({ where: { profileId: profile.id, kind: "platform-edit", sourceRef: "prompt", status: "pending" } });
      if (agent.prompt && contentHash(agent.prompt) !== contentHash(profile.lastPushedPrompt) && !pending) {
        out.promptChanged = true;
        await db.supportProposal.create({
          data: { organizationId: input.organizationId, brandId: profile.brandId, kind: "platform-edit", title: `Prompt edited in ElevenLabs: ${profile.name}`.slice(0, 300), text: agent.prompt.slice(0, 200_000), sourceRef: "prompt", profileId: profile.id },
        });
      }
    } catch (error) {
      out.errors.push(`agent: ${message(error)}`);
    }
  }
  return out;
}

/** Review decision on a platform edit. Either way our version is pushed again next time. */
export async function resolvePlatformEdit(organizationId: string, proposalId: string, decision: "approved" | "rejected", actorId: string): Promise<{ profileId: string | null } | null> {
  const db = tenantDb(organizationId);
  const proposal = await db.supportProposal.findFirst({ where: { id: proposalId, kind: "platform-edit", status: "pending" } });
  if (!proposal) return null;
  await db.supportProposal.updateMany({ where: { id: proposal.id }, data: { status: decision, decidedById: actorId, decidedAt: new Date() } });
  if (proposal.targetId) await db.supportPlatformDoc.updateMany({ where: { id: proposal.targetId }, data: { status: "pending", contentHash: "" } });
  return { profileId: proposal.profileId };
}

/** The hand-upload bundle: guide, documents, tool definitions (neutral and ElevenLabs shape). */
export async function exportBundle(organizationId: string, profileId: string, origin: string): Promise<{ filename: string; bytes: Uint8Array } | null> {
  const profile = await loadProfile(organizationId, profileId);
  if (!profile) return null;
  const material = await agentMaterial(organizationId, profile, origin);
  const files: Record<string, Uint8Array> = {
    "README.txt": strToU8(
      [
        `Support Knowledge bundle for "${profile.name}" (${material.brand.name}).`,
        "",
        "1. In ElevenLabs, open your agent. Paste guide.md into the system prompt.",
        "2. Upload every file in documents/ to the agent's knowledge base.",
        "3. Create a workspace secret holding: Bearer <this agent's key> (the key starts psk_).",
        "4. Add each tool from tools-elevenlabs.json as a webhook tool, with an Authorization header that uses that secret.",
        "5. Set the post-call webhook to the URL on the agent page if you want gaps recorded automatically.",
        "",
        `Generated ${new Date().toISOString()}. Re-download after records change.`,
      ].join("\n"),
    ),
    "guide.md": strToU8(material.guide),
    "tools.json": strToU8(JSON.stringify(material.tools.map((t) => ({ ...t, url: `${origin}/api/v1/support${t.path}` })), null, 2)),
    "tools-elevenlabs.json": strToU8(JSON.stringify(material.tools.map((t) => webhookToolConfig(t, { apiBase: origin, secretId: "<your secret id>" })), null, 2)),
  };
  material.docs.forEach((d, i) => {
    files[`documents/${docFileName(d, i)}`] = strToU8(d.text);
  });
  const slug = profile.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent";
  return { filename: `support-${slug}.zip`, bytes: zipSync(files, { level: 6 }) };
}
