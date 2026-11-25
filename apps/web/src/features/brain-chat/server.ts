import { runChat, type AiInput, type ChatActivity, type ChatTool, type ChatTurn } from "@pubcommand/ai";
import { appendPlatformAudit, type Prisma } from "@pubcommand/db";
import { checkAttachment, cleanFilename, extensionOf } from "../../../../../modules/knowledge/attachments";
import { frontmatterNiche, withNicheFrontmatter, type NoteNiche } from "../../../../../modules/knowledge/main-brain";
import {
  BRAINCHAT_SYSTEM,
  BRAINCHAT_TOOLS,
  BRAINCHAT_UPLOAD_FOLDER,
  clampLimit,
  cleanFolder,
  formatSearchResults,
  isNoteId,
  parseSaveNote,
  uploadNoteBody,
  uploadsBlock,
  type UploadedForTurn,
} from "../../../../../modules/knowledge/brain-chat";
import { mainBrain } from "../main-brain/db";
import { uniqueMainSlug } from "../main-brain/learn";
import { getMainNote, provenanceNames, searchMainNotes } from "../main-brain/notes";
import { syncPushDown } from "../main-brain/push";

/** Below this many characters, a PDF is treated as scanned and sent to the AI as a document. */
const SCANNED_PDF_TEXT_MIN = 400;
/** Largest scanned PDF handed to the AI in a turn. */
const PDF_DIRECT_MAX_BYTES = 20 * 1024 * 1024;
const LIVE_SAVE_MS = 900;
/** Earlier turns sent with each new one (older ones are summarized away by being left out). */
const HISTORY_TURNS = 30;

export type Staff = { userId: string; email: string };

export type StoredUpload = { name: string; noteId: string; title: string; chars: number; scanned: boolean };

type Extracted = { text: string; scanned: boolean };

/** Text from an uploaded file: Word, PDF, plain text, Markdown, CSV, JSON or HTML. */
export async function extractUploadText(name: string, data: Buffer): Promise<Extracted | { error: string }> {
  const ext = extensionOf(name);
  if (ext === "docx") {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: data });
    return value.trim() ? { text: value.trim(), scanned: false } : { error: `${name} has no text in it.` };
  }
  if (ext === "pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    let text = "";
    try {
      const pdf = await getDocumentProxy(new Uint8Array(data));
      const result = await extractText(pdf, { mergePages: true });
      text = (Array.isArray(result.text) ? result.text.join("\n") : result.text).trim();
    } catch {
      text = "";
    }
    return text.length < SCANNED_PDF_TEXT_MIN ? { text: "", scanned: true } : { text, scanned: false };
  }
  if (["txt", "md", "markdown", "csv", "tsv", "json"].includes(ext)) {
    const text = data.toString("utf8").replace(/^﻿/, "").trim();
    return text ? { text, scanned: false } : { error: `${name} is empty.` };
  }
  if (ext === "html" || ext === "htm") {
    const text = data
      .toString("utf8")
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n+/g, "\n\n")
      .trim();
    return text ? { text, scanned: false } : { error: `${name} has no text in it.` };
  }
  return { error: `${name}: upload Word (.docx), PDF, text, Markdown, CSV, JSON or HTML files.` };
}

/**
 * Save an uploaded file as a Master Brain note (the text, with the original
 * attached when its type is allowed). Returns what the turn needs.
 */
export async function saveUploadAsNote(file: File, staff: Staff): Promise<{ upload: UploadedForTurn; stored: StoredUpload; pdf?: AiInput } | { error: string }> {
  const name = cleanFilename(file.name);
  const data = Buffer.from(await file.arrayBuffer());
  const extracted = await extractUploadText(name, data);
  if ("error" in extracted) return extracted;
  const now = new Date();
  const title = name.replace(/\.[a-z0-9]{1,8}$/i, "") || name;
  const body = uploadNoteBody({ name, text: extracted.text, scanned: extracted.scanned, uploadedBy: staff.email, at: now });
  const attach = checkAttachment(name, data.length, data.subarray(0, 16));
  const note = await mainBrain(async (tx) => {
    const created = await tx.mainBrainNote.create({
      data: {
        key: `brainchat-upload:${crypto.randomUUID()}`,
        title: title.slice(0, 200),
        slug: await uniqueMainSlug(tx, title),
        body: withNicheFrontmatter(attach.ok ? `${body}\n\n![[${attach.filename}]]\n` : body, "general"),
        niche: "general",
        folder: BRAINCHAT_UPLOAD_FOLDER,
        origin: "AUTHORED",
        source: "brainchat",
        createdById: staff.userId,
      },
      select: { id: true, title: true },
    });
    if (attach.ok) await tx.mainBrainAttachment.create({ data: { noteId: created.id, filename: attach.filename, contentType: attach.contentType, size: data.length, data, createdById: staff.userId } });
    return created;
  });
  await appendPlatformAudit({ actorId: staff.userId, action: "main_brain.note.created", targetType: "main_brain_note", targetId: note.id, metadata: { via: "brainchat-upload", size: data.length } });
  const pdf = extracted.scanned && data.length <= PDF_DIRECT_MAX_BYTES ? ({ type: "pdf", base64: data.toString("base64"), title: name } as const) : undefined;
  return {
    upload: { name, noteId: note.id, title: note.title, text: extracted.text, scanned: extracted.scanned },
    stored: { name, noteId: note.id, title: note.title, chars: extracted.text.length, scanned: extracted.scanned },
    ...(pdf ? { pdf } : {}),
  };
}

/** The tools Claude uses in BrainChat, run against the Master Brain as this staff member. */
function brainTools(staff: Staff, savedNoteIds: string[]): ChatTool[] {
  const run: Record<string, ChatTool["run"]> = {
    async search_brain(input) {
      const query = String(input.query ?? "").trim();
      if (!query) return { error: "Give search_brain some words to search for." };
      const folder = cleanFolder(input.folder, null);
      const limit = clampLimit(input.limit);
      let hits = await searchMainNotes({ query, mode: "all", limit, filter: { folder } });
      // Too strict? Match any of the words instead.
      if (hits.length < Math.min(3, limit)) {
        const more = await searchMainNotes({ query, mode: "any", limit, filter: { folder } });
        const seen = new Set(hits.map((hit) => hit.id));
        hits = [...hits, ...more.filter((hit) => !seen.has(hit.id))].slice(0, limit);
      }
      const names = await provenanceNames();
      return formatSearchResults(
        query,
        hits.map((hit) => ({
          id: hit.id,
          title: hit.title,
          folder: hit.folder,
          updatedAt: hit.updatedAt,
          snippet: hit.snippet.replace(/[«»]/g, ""),
          where: hit.originBrandId ? (names.brands.get(hit.originBrandId)?.name ?? "a brand") : hit.originOrganizationId ? (names.orgs.get(hit.originOrganizationId)?.name ?? "an organization") : hit.source === "brainchat" ? "BrainChat" : "Platform",
        })),
      );
    },
    async read_note(input) {
      if (!isNoteId(input.note_id)) return { error: "note_id must be an id from search_brain or list_brain." };
      const note = await getMainNote(input.note_id);
      if (!note) return { error: "That note does not exist (or was deleted)." };
      const names = await provenanceNames();
      const where = [note.originOrganizationId ? names.orgs.get(note.originOrganizationId)?.name : null, note.originBrandId ? names.brands.get(note.originBrandId)?.name : null, note.source].filter(Boolean).join(" · ");
      return [`# ${note.title}`, `id ${note.id} · folder ${note.folder ?? "Top level"} · from ${where || "Platform"} · updated ${note.updatedAt.toISOString().slice(0, 10)}`, "", note.body].join("\n");
    },
    async list_brain(input) {
      const folder = cleanFolder(input.folder, null);
      if (folder) {
        const notes = await mainBrain((tx) =>
          tx.mainBrainNote.findMany({
            where: { deletedAt: null, OR: [{ folder }, { folder: { startsWith: `${folder}/` } }] },
            orderBy: { updatedAt: "desc" },
            take: 60,
            select: { id: true, title: true, folder: true, updatedAt: true },
          }),
        );
        if (notes.length === 0) return `The folder "${folder}" has no notes. Call list_brain with null to see the folders.`;
        return [`Newest ${notes.length} notes in "${folder}":`, ...notes.map((n) => `- ${n.title} (id ${n.id}) — ${n.folder ?? ""} · ${n.updatedAt.toISOString().slice(0, 10)}`)].join("\n");
      }
      const [total, folders, sources] = await mainBrain((tx) =>
        Promise.all([
          tx.mainBrainNote.count({ where: { deletedAt: null } }),
          tx.mainBrainNote.groupBy({ by: ["folder"], where: { deletedAt: null }, _count: { _all: true }, orderBy: { _count: { folder: "desc" } }, take: 80 }),
          tx.mainBrainNote.groupBy({ by: ["source"], where: { deletedAt: null }, _count: { _all: true }, orderBy: { _count: { source: "desc" } } }),
        ]),
      );
      return [
        `The Master Brain has ${total} notes.`,
        "Folders (notes):",
        ...folders.map((f) => `- ${f.folder ?? "Top level"}: ${f._count._all}`),
        "Sources (notes):",
        ...sources.map((s) => `- ${s.source}: ${s._count._all}`),
      ].join("\n");
    },
    async save_note(input) {
      const parsed = parseSaveNote(input);
      if ("error" in parsed) return parsed;
      if (parsed.noteId) {
        const existing = await getMainNote(parsed.noteId);
        if (!existing) return { error: "That note does not exist; create a new one with note_id null." };
        const niche = frontmatterNiche(parsed.body) ?? (existing.niche as NoteNiche);
        await mainBrain((tx) => tx.mainBrainNote.update({ where: { id: existing.id }, data: { title: parsed.title, body: withNicheFrontmatter(parsed.body, niche), niche, folder: parsed.folder, updatedById: staff.userId, editedAt: new Date() } }));
        await appendPlatformAudit({ actorId: staff.userId, action: "main_brain.note.updated", targetType: "main_brain_note", targetId: existing.id, metadata: { via: "brainchat" } });
        if (existing.pushScope !== "NONE") await syncPushDown({ noteIds: [existing.id] }).catch((error: unknown) => console.error("[brainchat] push-down failed", error));
        savedNoteIds.push(existing.id);
        return `Updated [${parsed.title}](/brain/${existing.id}) (id ${existing.id}).`;
      }
      const note = await mainBrain(async (tx) =>
        tx.mainBrainNote.create({
          data: { key: `note:${crypto.randomUUID()}`, title: parsed.title, slug: await uniqueMainSlug(tx, parsed.title), body: withNicheFrontmatter(parsed.body, frontmatterNiche(parsed.body) ?? "general"), niche: frontmatterNiche(parsed.body) ?? "general", folder: parsed.folder, origin: "AUTHORED", source: "brainchat", createdById: staff.userId },
          select: { id: true },
        }),
      );
      await appendPlatformAudit({ actorId: staff.userId, action: "main_brain.note.created", targetType: "main_brain_note", targetId: note.id, metadata: { via: "brainchat" } });
      savedNoteIds.push(note.id);
      return `Saved [${parsed.title}](/brain/${note.id}) (id ${note.id}) in ${parsed.folder ?? "Top level"}.`;
    },
  };
  return BRAINCHAT_TOOLS.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema as unknown as Record<string, unknown>, run: run[tool.name]! }));
}

/** Answer one user turn in the background, streaming into the assistant message row. */
export async function runBrainChatTurn(input: { chatId: string; userMessageId: string; assistantMessageId: string; staff: Staff; uploads: UploadedForTurn[]; pdfs: AiInput[] }): Promise<void> {
  // Only while the answer is still running: a stopped answer stays stopped.
  const save = (data: Prisma.MainBrainChatMessageUpdateManyMutationInput) => mainBrain((tx) => tx.mainBrainChatMessage.updateMany({ where: { id: input.assistantMessageId, status: "RUNNING" }, data }));
  try {
    const rows = await mainBrain((tx) =>
      tx.mainBrainChatMessage.findMany({ where: { chatId: input.chatId, status: "DONE" }, orderBy: { createdAt: "desc" }, take: HISTORY_TURNS + 1, select: { id: true, role: true, content: true, uploads: true } }),
    );
    const current = rows.find((row) => row.id === input.userMessageId);
    const history: ChatTurn[] = rows
      .filter((row) => row.id !== input.userMessageId)
      .reverse()
      .map((row) => ({ role: row.role === "assistant" ? "assistant" : "user", content: row.role === "user" ? withUploadRefs(row.content, row.uploads) : row.content }));
    const text = [current?.content ?? "", uploadsBlock(input.uploads)].filter((part) => part.trim()).join("\n\n");
    const savedNoteIds: string[] = [];
    const activity: ChatActivity[] = [];
    let lastSave = 0;
    let saving: Promise<unknown> = Promise.resolve();
    const result = await runChat({
      system: BRAINCHAT_SYSTEM,
      history,
      input: [...input.pdfs, { type: "text", text: text || "(no message)" }],
      tools: brainTools(input.staff, savedNoteIds),
      effort: "medium",
      onText: async (sofar) => {
        if (Date.now() - lastSave < LIVE_SAVE_MS) return;
        lastSave = Date.now();
        saving = save({ content: sofar });
        await saving;
      },
      onActivity: async (entry) => {
        activity.push(entry);
        await save({ activity: activity as unknown as Prisma.InputJsonValue });
      },
    });
    await saving.catch(() => undefined);
    if (result.status === "ok") {
      await save({ status: "DONE", content: result.text || "(no answer)", error: null, model: result.usage.model, usage: result.usage as unknown as Prisma.InputJsonValue, activity: result.activity as unknown as Prisma.InputJsonValue });
      console.info("[brainchat] usage", input.staff.userId, JSON.stringify(result.usage));
    } else if (result.status === "unavailable") {
      await save({ status: "FAILED", error: result.reason });
    } else {
      await save({ status: "FAILED", content: result.text, error: result.reason, activity: result.activity as unknown as Prisma.InputJsonValue, ...(result.usage ? { usage: result.usage as unknown as Prisma.InputJsonValue } : {}) });
    }
    await mainBrain((tx) => tx.mainBrainChat.update({ where: { id: input.chatId }, data: { updatedAt: new Date() } }));
  } catch (error) {
    await save({ status: "FAILED", error: error instanceof Error ? error.message : "BrainChat failed." }).catch(() => undefined);
  }
}

/** Earlier user turns mention their uploads so the model can read_note them later. */
function withUploadRefs(content: string, uploads: unknown): string {
  const list = Array.isArray(uploads) ? (uploads as StoredUpload[]) : [];
  if (list.length === 0) return content;
  return [content, ...list.map((u) => `[Uploaded "${u.name}" — note [${u.title}](/brain/${u.noteId}), id ${u.noteId}]`)].filter(Boolean).join("\n");
}
