import { runStructured, type AiInput } from "@pubcommand/ai";
import { brandProfile, brandPromptContext } from "@pubcommand/core";
import { tenantDb, type Prisma } from "@pubcommand/db";
import { logAiUsage } from "@/features/ai/usage";
import {
  BACKUP_READ_SCHEMA,
  backupKind,
  backupReadSystem,
  cleanTranscript,
  mapProposal,
  mapTranscripts,
  MAX_TRANSCRIPT_CHARS,
  type BackupReadRaw,
} from "../../../../../modules/performance/backup-read";
import { imageToPdf } from "../../../../../modules/performance/image-pdf";
import type { TrackWorkScope } from "./server";

const MAX_FILES = 12;
/** Claude reads PDFs up to 32 MB; keep the whole request well under that. */
const MAX_PDF_BYTES = 24 * 1024 * 1024;
export const AI_RUN_STALE_MS = 10 * 60 * 1000;

/**
 * Read a call's backup files with the AI: transcribe each and propose the call's fields. Stores the transcripts
 * on the files and the proposal on the call. Never writes a field of the call itself: a person reviews the
 * proposal in the form and saves it. Soft-fails into aiStatus/aiError.
 */
export async function runBackupRead(scope: TrackWorkScope, callId: string): Promise<void> {
  const db = tenantDb(scope.organizationId);
  const fail = (status: "failed" | "unavailable", reason: string) =>
    db.trackCall.updateMany({ where: { id: callId }, data: { aiStatus: status, aiError: reason.slice(0, 500), aiRunAt: new Date() } });
  try {
    const call = await db.trackCall.findFirst({ where: { id: callId, brandId: scope.brandId, deletedAt: null } });
    if (!call) return;
    const brand = await db.brand.findFirst({ where: { id: scope.brandId } });
    const files = await db.trackCallFile.findMany({ where: { callId }, orderBy: { createdAt: "asc" }, take: MAX_FILES });
    const input: AiInput[] = [];
    const sent: { id: string; index: number; kind: string }[] = [];
    let pdfBytes = 0;
    for (const file of files) {
      const kind = backupKind(file.mimeType, file.filename);
      const index = sent.length + 1;
      const bytes = new Uint8Array(file.data);
      const skip = (reason: string) => db.trackCallFile.updateMany({ where: { id: file.id }, data: { transcriptStatus: "skipped", transcriptError: reason } });
      try {
        if (kind === "pdf" || kind === "image") {
          const pdf = kind === "pdf" ? bytes : imageToPdf(bytes);
          if (pdfBytes + pdf.length > MAX_PDF_BYTES) {
            await skip("Too large to read with the others. Read it on its own or attach a smaller copy.");
            continue;
          }
          pdfBytes += pdf.length;
          input.push({ type: "text", text: `File ${index}: ${file.filename} (${kind === "image" ? "screenshot" : "PDF"})` });
          input.push({ type: "pdf", base64: Buffer.from(pdf).toString("base64"), title: file.filename.slice(0, 200) });
        } else if (kind === "text" || kind === "docx") {
          let text: string;
          if (kind === "docx") {
            const mammoth = await import("mammoth");
            text = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
          } else {
            text = cleanTranscript(new TextDecoder("utf-8").decode(bytes));
          }
          text = text.slice(0, MAX_TRANSCRIPT_CHARS);
          if (!text.trim()) {
            await skip("The file has no text.");
            continue;
          }
          // A transcript is its own text: store it as is.
          await db.trackCallFile.updateMany({ where: { id: file.id }, data: { transcript: text, transcriptStatus: "done", transcriptError: null } });
          input.push({ type: "text", text: `File ${index}: ${file.filename} (transcript)\n\n${text}` });
        } else if (kind === "video") {
          await skip("Video and audio are not transcribed here. Attach the transcript as a .txt, .vtt, .srt or .docx file.");
          continue;
        } else {
          await skip("This file type cannot be read. Use PNG, JPEG, PDF, text or Word.");
          continue;
        }
        sent.push({ id: file.id, index, kind });
      } catch (error) {
        await db.trackCallFile.updateMany({ where: { id: file.id }, data: { transcriptStatus: "failed", transcriptError: error instanceof Error ? error.message.slice(0, 300) : "Could not read this file." } });
      }
    }
    if (!sent.length) return void (await fail("failed", "None of the backup files could be read. Add a screenshot, PDF or transcript."));
    input.push({
      type: "text",
      text: `Call as recorded so far (may be empty): title "${call.title}", ticker ${call.ticker ?? "none"}. Today is ${new Date().toISOString().slice(0, 10)}; never use it as the call date.`,
    });
    const answer = await runStructured<BackupReadRaw>({
      system: backupReadSystem(brand ? brandPromptContext(brandProfile(brand)) : ""),
      input,
      schema: BACKUP_READ_SCHEMA as unknown as Record<string, unknown>,
      effort: "medium",
      maxTokens: 24000,
    });
    if (answer.status === "unavailable") return void (await fail("unavailable", answer.reason));
    if ("usage" in answer && answer.usage) {
      await logAiUsage({ organizationId: scope.organizationId, moduleId: "performance", feature: "trackrecord.backup-read", actorId: scope.actorId, usage: answer.usage });
    }
    if (answer.status !== "ok") return void (await fail("failed", answer.reason));
    const transcripts = mapTranscripts(answer.data, sent.length);
    for (const file of sent) {
      if (file.kind === "text" || file.kind === "docx") continue;
      const transcript = transcripts.get(file.index);
      await db.trackCallFile.updateMany({
        where: { id: file.id },
        data: transcript ? { transcript, transcriptStatus: "done", transcriptError: null } : { transcriptStatus: "failed", transcriptError: "The AI returned no text for this file." },
      });
    }
    const proposal = mapProposal(answer.data, new Date());
    await db.trackCall.updateMany({
      where: { id: callId },
      data: { aiStatus: "done", aiError: null, aiRunAt: new Date(), aiProposal: proposal as unknown as Prisma.InputJsonValue },
    });
  } catch (error) {
    console.error("[trackrecord] backup read failed", error);
    await fail("failed", "The backup read failed. Try again.");
  }
}
