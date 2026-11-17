import { aiConfigured, runStructured, type AiUsage } from "@pubcommand/ai";
import { Prisma } from "@pubcommand/db";
import {
  AI_NOTE_LIMIT,
  CONFLICT_SCHEMA,
  CONFLICT_SYSTEM,
  conflictPrompt,
  detectRuleConflicts,
  factHash,
  factsHash,
  noteHash,
  notesHash,
  normalizeAiConflicts,
  reconcileConflicts,
  recheckReason,
  type AiConflictRaw,
  type ConflictCandidate,
  type ConflictNote,
  type EntityKind,
  type RecheckReason,
  type StoredConflict,
} from "../../../../../modules/knowledge/conflicts";
import { mainBrain } from "../main-brain/db";
import { listMainBrainNotesByEntity } from "../main-brain/notes";
import { entityKey, loadEntities, loadEntity, type EntityRecord } from "./entities";
import { supersededNoteIds } from "./flags";

export const AI_OFF_NOTE = "The AI check did not run (no AI key is set). Only the deterministic rules ran: names, codes, editors, prices, frequency, launch dates, titles and status.";

/**
 * Main-Brain notes about one entity that may be compared with its facts:
 * live, not marked outdated, and not learned from a different organization or
 * brand (another publisher's "Daily Edge" is a different publication).
 */
export async function entityNotes(record: EntityRecord): Promise<(ConflictNote & { updatedAt: Date; folder: string | null; origin: string; source: string })[]> {
  const hits = await listMainBrainNotesByEntity(record.name, { aliases: record.entity.aliases, limit: 60 });
  const allowed = hits.filter((hit) => !hit.originOrganizationId || (hit.originOrganizationId === record.organizationId && (!hit.originBrandId || hit.originBrandId === record.brandId)));
  if (!allowed.length) return [];
  const flagged = await supersededNoteIds(allowed.map((hit) => hit.id));
  const live = allowed.filter((hit) => !flagged.has(hit.id));
  const bodies = await mainBrain((tx) => tx.mainBrainNote.findMany({ where: { id: { in: live.map((hit) => hit.id) }, deletedAt: null }, select: { id: true, body: true } }));
  const byId = new Map(bodies.map((row) => [row.id, row.body]));
  return live.flatMap((hit) => {
    const body = byId.get(hit.id);
    return body == null ? [] : [{ id: hit.id, title: hit.title, body, strength: hit.strength, updatedAt: hit.updatedAt, folder: hit.folder, origin: hit.origin, source: hit.source }];
  });
}

export type CheckOutcome = { status: "unchanged" | "checked" | "failed"; reason: RecheckReason | null; created: number; reopened: number; cleared: number; open: number; aiStatus: string | null };

/**
 * Check one entity: rule layer always, AI layer when a key is set. Skips the
 * work (returns "unchanged") unless the facts or the matching notes changed
 * since the last check, or `force` is set.
 */
export async function checkEntity(record: EntityRecord, options: { force?: boolean; useAi?: boolean; actorId?: string | null } = {}): Promise<CheckOutcome> {
  const notes = await entityNotes(record);
  const hashes = { factsHash: factsHash(record.entity.fields), notesHash: notesHash(notes) };
  const where = { entityKind_entityId: { entityKind: record.kind, entityId: record.id } };
  const previous = await mainBrain((tx) => tx.mainBrainConflictCheck.findUnique({ where, select: { id: true, factsHash: true, notesHash: true, status: true } }));
  const reason = recheckReason(previous, hashes, options.force);
  const empty = { created: 0, reopened: 0, cleared: 0, open: 0 };
  if (!reason) return { status: "unchanged", reason: null, ...empty, aiStatus: null };

  const identity = {
    entityOrganizationId: record.organizationId,
    entityBrandId: record.brandId,
    entityName: record.name,
    entityCode: record.code,
    facts: record.entity.fields as unknown as Prisma.InputJsonValue,
  };
  const check = await mainBrain((tx) =>
    tx.mainBrainConflictCheck.upsert({
      where,
      create: { entityKind: record.kind, entityId: record.id, ...identity, factsHash: "", notesHash: "", status: "running", reason },
      update: { ...identity, status: "running", reason, error: null },
    }),
  );

  try {
    const rule = detectRuleConflicts(record.entity, notes);
    let ai: ConflictCandidate[] = [];
    let aiStatus: "ok" | "unavailable" | "failed" | "skipped" = "skipped";
    let aiReason: string | null = null;
    let aiUsage: AiUsage | null = null;
    const useAi = options.useAi ?? aiConfigured();
    if (!notes.length) {
      aiReason = "No main-Brain notes mention it.";
    } else if (!useAi) {
      aiStatus = aiConfigured() ? "skipped" : "unavailable";
      aiReason = aiConfigured() ? "Rules only for this check." : AI_OFF_NOTE;
    } else {
      const top = [...notes].sort((a, b) => b.strength - a.strength || b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, AI_NOTE_LIMIT);
      const result = await runStructured<AiConflictRaw>({
        system: CONFLICT_SYSTEM,
        input: [{ type: "text", text: conflictPrompt(record.entity, top) }],
        schema: CONFLICT_SCHEMA as unknown as Record<string, unknown>,
        effort: "medium",
        maxTokens: 6000,
      });
      if (result.status === "ok") {
        aiStatus = "ok";
        aiUsage = result.usage;
        ai = normalizeAiConflicts(result.data, record.entity, top);
      } else {
        aiStatus = result.status;
        aiReason = result.status === "unavailable" ? AI_OFF_NOTE : `The AI check failed: ${result.reason} Rule results are shown.`;
        aiUsage = result.status === "failed" ? (result.usage ?? null) : null;
      }
      if (aiUsage) logPlatformAiUsage(options.actorId ?? null, record, aiUsage);
    }

    const existing = await mainBrain((tx) =>
      tx.mainBrainConflict.findMany({
        where: { entityKind: record.kind, entityId: record.id },
        select: { id: true, factKey: true, noteId: true, layer: true, status: true, resolution: true, factHash: true, noteHash: true },
      }),
    );
    const factHashes = Object.fromEntries(Object.entries(record.entity.fields).map(([key, value]) => [key, factHash(key, value)]));
    const noteHashes = Object.fromEntries(notes.map((note) => [note.id, noteHash(note.body)]));
    const titles = new Map(notes.map((note) => [note.id, note.title]));
    const plan = reconcileConflicts({
      existing: existing as StoredConflict[],
      candidates: [...rule, ...ai],
      factHashes,
      noteHashes,
      layersRun: aiStatus === "ok" ? ["rule", "ai"] : ["rule"],
    });
    const now = new Date();
    const fieldsOf = (c: ConflictCandidate, fh: string, nh: string) => ({
      factValue: c.factValue,
      factHash: fh,
      noteTitle: titles.get(c.noteId) ?? "",
      noteHash: nh,
      noteSays: c.noteSays,
      quote: c.quote,
      noteValue: c.noteValue,
      suggestedValue: c.suggestedValue,
      layer: c.layer,
      rule: c.rule,
      confidence: c.confidence,
      lastSeenAt: now,
      checkId: check.id,
    });
    await mainBrain(async (tx) => {
      for (const c of plan.create) {
        await tx.mainBrainConflict.create({
          data: { entityKind: record.kind, entityId: record.id, entityOrganizationId: record.organizationId, entityBrandId: record.brandId, factKey: c.factKey, noteId: c.noteId, ...fieldsOf(c, c.factHash, c.noteHash) },
        });
      }
      for (const r of plan.refresh) {
        await tx.mainBrainConflict.update({
          where: { id: r.id },
          data: { ...fieldsOf(r.candidate, r.factHash, r.noteHash), ...(r.clearResolution ? { resolution: null, reason: null, resolvedAt: null, resolvedById: null, suggestion: Prisma.DbNull } : {}) },
        });
      }
      for (const r of plan.reopen) {
        await tx.mainBrainConflict.update({
          where: { id: r.id },
          data: { ...fieldsOf(r.candidate, r.factHash, r.noteHash), status: "OPEN", resolution: null, reason: null, resolvedAt: null, resolvedById: null, suggestion: Prisma.DbNull, firstSeenAt: now },
        });
      }
      if (plan.cleared.length) {
        await tx.mainBrainConflict.updateMany({
          where: { id: { in: plan.cleared } },
          data: { status: "RESOLVED", resolution: "cleared", reason: "No longer found when re-checked.", resolvedAt: now, resolvedById: null },
        });
      }
      await tx.mainBrainConflictCheck.update({
        where: { id: check.id },
        data: {
          status: "done",
          factsHash: hashes.factsHash,
          notesHash: hashes.notesHash,
          noteIds: notes.map((note) => note.id),
          aiStatus,
          aiReason,
          aiUsage: aiUsage ? (aiUsage as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          checkedAt: now,
          checkedById: options.actorId ?? null,
        },
      });
    });
    const open = await mainBrain((tx) => tx.mainBrainConflict.count({ where: { entityKind: record.kind, entityId: record.id, status: "OPEN" } }));
    return { status: "checked", reason, created: plan.create.length, reopened: plan.reopen.length, cleared: plan.cleared.length, open, aiStatus };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "The check failed.";
    await mainBrain((tx) => tx.mainBrainConflictCheck.update({ where: { id: check.id }, data: { status: "failed", error: message } })).catch(() => undefined);
    return { status: "failed", reason, ...empty, aiStatus: null };
  }
}

export type RecheckSummary = { entities: number; checked: number; unchanged: number; failed: number; created: number; reopened: number; cleared: number; removed: number };

/**
 * Re-check entities. Default: only those whose facts or matching notes changed
 * (the hourly job). `force` re-checks every entity in scope. Check rows for
 * entities that no longer exist are removed (with their conflicts).
 */
export async function recheckEntities(options: { force?: boolean; organizationId?: string; only?: { kind: EntityKind; id: string }; actorId?: string | null; useAi?: boolean } = {}): Promise<RecheckSummary> {
  const records = options.only ? [await loadEntity(options.only.kind, options.only.id)].filter((r): r is EntityRecord => Boolean(r)) : await loadEntities({ organizationId: options.organizationId });
  const summary: RecheckSummary = { entities: records.length, checked: 0, unchanged: 0, failed: 0, created: 0, reopened: 0, cleared: 0, removed: 0 };
  for (const record of records) {
    const outcome = await checkEntity(record, { force: options.force, actorId: options.actorId, useAi: options.useAi });
    if (outcome.status === "checked") summary.checked++;
    else if (outcome.status === "unchanged") summary.unchanged++;
    else summary.failed++;
    summary.created += outcome.created;
    summary.reopened += outcome.reopened;
    summary.cleared += outcome.cleared;
  }
  if (options.only && records.length === 0) {
    const gone = await mainBrain((tx) => tx.mainBrainConflictCheck.deleteMany({ where: { entityKind: options.only!.kind, entityId: options.only!.id } }));
    summary.removed += gone.count;
  } else if (!options.only) {
    const keep = new Set(records.map((r) => entityKey(r.kind, r.id)));
    const rows = await mainBrain((tx) => tx.mainBrainConflictCheck.findMany({ where: options.organizationId ? { entityOrganizationId: options.organizationId } : {}, select: { id: true, entityKind: true, entityId: true } }));
    const stale = rows.filter((row) => !keep.has(entityKey(row.entityKind as EntityKind, row.entityId))).map((row) => row.id);
    if (stale.length) summary.removed += (await mainBrain((tx) => tx.mainBrainConflictCheck.deleteMany({ where: { id: { in: stale } } }))).count;
  }
  return summary;
}

/** Mark checks as queued so pages poll while a re-check runs after the response. */
export async function markQueued(filter: { kind?: EntityKind; id?: string } = {}): Promise<void> {
  await mainBrain((tx) =>
    tx.mainBrainConflictCheck.updateMany({ where: { ...(filter.kind ? { entityKind: filter.kind } : {}), ...(filter.id ? { entityId: filter.id } : {}), status: { not: "running" } }, data: { status: "queued" } }),
  );
}

/**
 * logAiUsage() writes an organization's usage log, which that organization can
 * see; these checks belong to no organization (same as main-Brain Ask). The
 * usage is stored on the check row (main_brain_conflict_checks.ai_usage) and
 * written to the server log.
 */
function logPlatformAiUsage(actorId: string | null, record: EntityRecord, usage: AiUsage): void {
  console.info("[main-brain] conflict-check usage", actorId ?? "job", `${record.kind}:${record.id}`, JSON.stringify(usage));
}

