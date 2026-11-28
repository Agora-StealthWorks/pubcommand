/**
 * BrainChat: platform staff talk with the Master Brain and teach it.
 *
 * Claude answers from the Master Brain through tools (search, read, list) and
 * saves what staff ask it to remember (save_note). Files uploaded in the chat
 * become Master Brain notes before the turn runs. Pure: prompts, tool schemas,
 * input checks and formatting; no database, no AI.
 */

export const BRAINCHAT_SYSTEM = `You are BrainChat, the assistant inside PubCommand's admin console. You talk with PubCommand staff about the Master Brain and help them grow it.

The Master Brain is PubCommand's platform-wide knowledge base: an expert reference on the publishing industry (financial newsletters and beyond) — its publishers, editors, publications, offers, promos, results and copywriting craft. Its notes come from:
- what the organizations' apps learned: Promo Analyzer reviews ("Promo reviews"), the promos' own copy ("Promo copy"), facts promos state ("Promo facts"), emails and videos from publishers across the industry captured by Intel and VidRipper ("Industry intel"), publication and editor facts, research cards, track-record calls and more;
- vaults staff imported, notes staff wrote, and files uploaded here in BrainChat.

Your lens: you are an industry expert, not any one company's advocate. Treat every publisher (Agora and its imprints, MarketWise, Banyan Hill, Stansberry, Monument Traders Alliance and the rest) evenly, as companies in the industry. Do not call any of them "competitors" or take a side; describe what each does, what works and why, with evidence from the notes. When staff ask from one organization's point of view, answer for that organization explicitly ("for MTA, …") without changing the neutral framing of the Brain itself.

How to work:
- For any question about people, publications, promos, competitors, results or anything else that could be in the Brain, search it first (search_brain), then read the notes that matter (read_note). Search again with other words when the first search misses. Prefer a few focused searches over one vague one.
- Answer from the notes. When the notes do not cover something, say so plainly; you may add general copywriting or marketing knowledge, labelled as your own view, never as a fact from the Brain. Never make up numbers, prices, results, names or quotes.
- Cite the notes you used as Markdown links in the form [Note title](/brain/NOTE_ID), using the ids the tools return.
- Notes you save follow the same lens: neutral industry knowledge, no "competitors".
- Teaching: when staff ask you to remember, save, add, record or update something, write it with save_note: one clear note per topic, a specific title, the facts in plain Markdown, and where they came from. Start the body with frontmatter naming its niche (---\nniche: finance\n---, or health, or general for craft that fits every niche); finance and health knowledge must never mix. Update an existing note (note_id) only to correct or extend that same note; otherwise create a new one. Never save without being asked, and say what you saved, with its link.
- For what publishers are mailing right now (emails, reused copy, new promos, lifts, affiliate drops, trends), use the ISpy tools (ispy_feed, ispy_copy, ispy_promo, ispy_promos, ispy_trends, ispy_alerts, ispy_registry, ispy_routing, ispy_email): they read the live shared feed. The Brain's ISpy/ folder holds one note per email copy.
- Uploaded files are already saved as notes before you see them (their ids are given). Summarize or answer from them as asked; save extra notes (for example a summary or extracted facts) only when staff ask.
- Keep answers short and scannable: lead with the answer, then the supporting points. Use tables or bullet lists when they help.`;

const NULLABLE_STRING = { anyOf: [{ type: "string" }, { type: "null" }] };
const NULLABLE_INTEGER = { anyOf: [{ type: "integer" }, { type: "null" }] };

export const BRAINCHAT_TOOLS = [
  {
    name: "search_brain",
    description:
      "Full-text search over Master Brain notes (titles weigh more than bodies). Returns up to `limit` notes with id, title, folder, where it came from and a snippet. Use specific words: names, publication codes, product names, topics.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query", "folder", "limit"],
      properties: {
        query: { type: "string", description: "Words to search for." },
        folder: { ...NULLABLE_STRING, description: "Only notes in this folder (and its subfolders), e.g. \"Promo reviews\". Null for all." },
        limit: { ...NULLABLE_INTEGER, description: "How many notes, 1-25. Null for 10." },
      },
    },
  },
  {
    name: "read_note",
    description: "Read one Master Brain note in full (title, folder, provenance, body) by its id.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["note_id"],
      properties: { note_id: { type: "string", description: "The note id from search_brain or list_brain." } },
    },
  },
  {
    name: "list_brain",
    description:
      "Without a folder: the Master Brain's size, its folders with note counts and where notes came from. With a folder: the newest notes in that folder (id, title, updated).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["folder"],
      properties: { folder: { ...NULLABLE_STRING, description: "A folder name, or null for the overview." } },
    },
  },
  {
    name: "save_note",
    description:
      "Teach the Master Brain: create a note, or update one by note_id. Only when staff ask you to remember, save, add or update something. The body is Markdown.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "body", "folder", "note_id"],
      properties: {
        title: { type: "string", description: "Specific title, e.g. \"Webinar promos — what converted in 2026\"." },
        body: { type: "string", description: "The note in Markdown." },
        folder: { ...NULLABLE_STRING, description: "Folder, e.g. \"BrainChat\" or an existing folder. Null for \"BrainChat\"." },
        note_id: { ...NULLABLE_STRING, description: "The id of the note to update, or null to create a new note." },
      },
    },
  },
] as const;

export type BrainChatToolName = (typeof BRAINCHAT_TOOLS)[number]["name"];

export const BRAINCHAT_DEFAULT_FOLDER = "BrainChat";
export const BRAINCHAT_UPLOAD_FOLDER = "BrainChat uploads";
export const NOTE_TITLE_MAX = 200;
export const NOTE_BODY_MAX = 1_000_000;
/** Characters of an uploaded file put straight into the turn; the rest is in its note. */
export const UPLOAD_INLINE_MAX = 80_000;
export const UPLOAD_MAX_BYTES = 30 * 1024 * 1024;
export const UPLOADS_PER_TURN = 5;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isNoteId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function clampLimit(value: unknown, fallback = 10, max = 25): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(Math.max(n, 1), max);
}

/** Folder names: trimmed, no leading/trailing slashes, at most 120 characters. */
export function cleanFolder(value: unknown, fallback: string | null = BRAINCHAT_DEFAULT_FOLDER): string | null {
  if (typeof value !== "string") return fallback;
  const folder = value
    .split("/")
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("/")
    .slice(0, 120);
  return folder || fallback;
}

export type SaveNoteInput = { title: string; body: string; folder: string | null; noteId: string | null };

/** Check save_note input. Returns the cleaned note or a message for the model. */
export function parseSaveNote(input: Record<string, unknown>): SaveNoteInput | { error: string } {
  const title = typeof input.title === "string" ? input.title.replace(/\s+/g, " ").trim() : "";
  const body = typeof input.body === "string" ? input.body.replace(/\r\n/g, "\n").trim() : "";
  if (!title) return { error: "The note needs a title." };
  if (title.length > NOTE_TITLE_MAX) return { error: `The title is longer than ${NOTE_TITLE_MAX} characters.` };
  if (!body) return { error: "The note needs a body." };
  if (body.length > NOTE_BODY_MAX) return { error: "The note is too long; split it into several notes." };
  const noteId = input.note_id === null || input.note_id === undefined || input.note_id === "" ? null : input.note_id;
  if (noteId !== null && !isNoteId(noteId)) return { error: "note_id must be a note id from the tools, or null to create a note." };
  return { title, body, folder: cleanFolder(input.folder), noteId };
}

/** A chat's title from its first message. */
export function chatTitle(text: string, uploads: readonly string[] = []): string {
  const line = text.replace(/\s+/g, " ").trim();
  const base = line || (uploads.length ? `Uploaded ${uploads.join(", ")}` : "New chat");
  return base.length > 80 ? `${base.slice(0, 77)}…` : base;
}

export type UploadedForTurn = { name: string; noteId: string; title: string; text: string; scanned: boolean };

/** The text the model gets for this turn's uploads (already saved as notes). */
export function uploadsBlock(uploads: readonly UploadedForTurn[]): string {
  if (uploads.length === 0) return "";
  return uploads
    .map((upload) => {
      const head = `[Uploaded file "${upload.name}" — saved to the Master Brain as [${upload.title}](/brain/${upload.noteId}) (note id ${upload.noteId}).]`;
      if (upload.scanned) return `${head}\nIt is a scanned PDF with no text layer; it is attached as a document for you to read.`;
      const text = upload.text.length > UPLOAD_INLINE_MAX ? `${upload.text.slice(0, UPLOAD_INLINE_MAX)}\n…(the rest is in the note; use read_note)` : upload.text;
      return `${head}\n<file name="${upload.name.replace(/"/g, "'")}">\n${text}\n</file>`;
    })
    .join("\n\n");
}

/** The note body for an uploaded file. */
export function uploadNoteBody(input: { name: string; text: string; scanned: boolean; uploadedBy: string; at: Date }): string {
  const lines = [`# ${input.name}`, "", `- Uploaded in BrainChat by ${input.uploadedBy} on ${input.at.toISOString().slice(0, 10)}`, ""];
  if (input.scanned) lines.push("This is a scanned PDF with no text layer. The original file is attached below.");
  else lines.push(input.text.trim());
  return lines.join("\n");
}

export type SearchHitForModel = { id: string; title: string; folder: string | null; where: string; snippet: string; updatedAt: Date };

export function formatSearchResults(query: string, hits: readonly SearchHitForModel[]): string {
  if (hits.length === 0) return `No Master Brain notes match "${query}". Try other words, a name, or a broader term.`;
  return [
    `${hits.length} note${hits.length === 1 ? "" : "s"} match "${query}":`,
    ...hits.map((hit, i) => `${i + 1}. ${hit.title} (id ${hit.id}) — ${hit.folder ?? "Top level"} · ${hit.where} · updated ${hit.updatedAt.toISOString().slice(0, 10)}\n   ${hit.snippet}`),
  ].join("\n");
}

/** Note ids linked in an answer as (/brain/<id>). */
export function citedNoteIds(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(/\(\/brain\/([0-9a-f-]{36})\)/gi)) if (isNoteId(match[1])) ids.add(match[1]!.toLowerCase());
  return [...ids];
}
