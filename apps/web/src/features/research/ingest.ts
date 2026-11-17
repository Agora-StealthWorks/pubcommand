import {
  deriveTitle,
  htmlTitle,
  htmlToText,
  MIN_SOURCE_CHARS,
  normalizeText,
  parseCaptionTracks,
  pickCaptionTrack,
  timedTextToTranscript,
  youtubeVideoId,
  type SourceKind,
} from "../../../../../modules/research/ingest";
import { FetchRefused, safeFetch } from "./fetch";

/** Below this many characters of text, a PDF is treated as scanned and sent to the AI as a document. */
const SCANNED_PDF_TEXT_MIN = 600;
/** The AI reads a scanned PDF inline; the request has a size ceiling. */
export const MAX_SCANNED_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export type IngestedSource = {
  kind: SourceKind;
  inputType: "text" | "html" | "pdf" | "scanned-pdf" | "docx" | "transcript";
  title: string;
  sourceRef: string | null;
  text: string;
  file?: { filename: string; mimeType: string; data: Buffer };
};

export type IngestOutcome = IngestedSource | { error: string };

export function ingestPasted(input: { text: string; title: string; url: string }): IngestOutcome {
  const text = normalizeText(input.text);
  if (text.length < MIN_SOURCE_CHARS) return { error: "Paste at least a few sentences of research." };
  const url = /^https?:\/\//i.test(input.url.trim()) ? input.url.trim().slice(0, 2000) : null;
  return { kind: "text", inputType: "text", title: deriveTitle({ title: input.title, url, text, fallback: "Pasted research" }), sourceRef: url, text };
}

async function pdfText(data: Buffer): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(data));
    const result = await extractText(pdf, { mergePages: false });
    const pages = Array.isArray(result.text) ? result.text : [result.text];
    // Page markers let the AI cite "p. 4".
    return normalizeText(pages.map((page, index) => `[Page ${index + 1}]\n${page}`).join("\n\n"));
  } catch {
    return "";
  }
}

function pdfOutcome(input: { data: Buffer; filename: string; title: string; kind: SourceKind; sourceRef: string | null; text: string }): IngestOutcome {
  const readable = input.text.replace(/\[Page \d+\]/g, "").trim().length >= SCANNED_PDF_TEXT_MIN;
  if (!readable && input.data.length > MAX_SCANNED_PDF_BYTES) {
    return { error: "That PDF looks scanned (no text layer) and is over 20 MB, too large for the AI to read. Split it or upload a text PDF." };
  }
  return {
    kind: input.kind,
    inputType: readable ? "pdf" : "scanned-pdf",
    title: input.title,
    sourceRef: input.sourceRef,
    text: readable ? input.text : "",
    file: { filename: input.filename, mimeType: "application/pdf", data: input.data },
  };
}

export async function ingestFile(file: File, title: string): Promise<IngestOutcome> {
  if (file.size > MAX_UPLOAD_BYTES) return { error: "That file is over 50 MB." };
  const data = Buffer.from(await file.arrayBuffer());
  const name = file.name.slice(0, 200);
  const lower = name.toLowerCase();
  const label = deriveTitle({ title, fallback: name.replace(/\.(pdf|docx|txt|md)$/i, "") || "Upload" });
  if (lower.endsWith(".pdf")) {
    return pdfOutcome({ data, filename: name, title: label, kind: "file", sourceRef: name, text: await pdfText(data) });
  }
  if (lower.endsWith(".docx")) {
    try {
      const mammoth = await import("mammoth");
      const { value } = await mammoth.extractRawText({ buffer: data });
      const text = normalizeText(value);
      if (text.length < MIN_SOURCE_CHARS) return { error: "That Word file has almost no text in it." };
      return {
        kind: "file",
        inputType: "docx",
        title: label,
        sourceRef: name,
        text,
        file: { filename: name, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", data },
      };
    } catch {
      return { error: "That Word file could not be read. Save it again as .docx and retry." };
    }
  }
  if (lower.endsWith(".txt") || lower.endsWith(".md")) {
    const text = normalizeText(data.toString("utf8"));
    if (text.length < MIN_SOURCE_CHARS) return { error: "That file has almost no text in it." };
    return { kind: "file", inputType: "text", title: label, sourceRef: name, text };
  }
  return { error: "Upload a .pdf, .docx, .txt or .md file." };
}

export async function ingestUrl(raw: string, title: string): Promise<IngestOutcome> {
  if (youtubeVideoId(raw)) return ingestYoutube(raw, title, "");
  try {
    const page = await safeFetch(raw);
    const type = page.contentType.toLowerCase();
    if (type.includes("application/pdf") || page.body.subarray(0, 5).toString("latin1") === "%PDF-") {
      const filename = decodeURIComponent(new URL(page.url).pathname.split("/").pop() || "document.pdf").slice(0, 200);
      return pdfOutcome({ data: page.body, filename, title: deriveTitle({ title, url: page.url, fallback: filename }), kind: "url", sourceRef: page.url, text: await pdfText(page.body) });
    }
    if (!type.includes("html") && !type.startsWith("text/") && type !== "") {
      return { error: "That link is not a web page or PDF we can read. Download it and upload the file instead." };
    }
    const html = page.body.toString("utf8");
    const text = type.includes("html") || /<html|<body|<p[\s>]/i.test(html.slice(0, 5000)) ? htmlToText(html) : normalizeText(html);
    if (text.length < MIN_SOURCE_CHARS * 3) {
      return { error: "That page had almost no readable text (it may need a login or load its story with scripts). Paste the article text instead." };
    }
    return { kind: "url", inputType: "html", title: deriveTitle({ title: title || htmlTitle(html), url: page.url, fallback: "Web page" }), sourceRef: page.url, text };
  } catch (error) {
    return { error: error instanceof FetchRefused ? error.message : "That link could not be read. Paste the text instead." };
  }
}

/**
 * A YouTube video: a pasted transcript wins; otherwise we try the video's
 * public captions. When there are none we ask for a transcript.
 */
export async function ingestYoutube(raw: string, title: string, transcript: string): Promise<IngestOutcome> {
  const id = youtubeVideoId(raw);
  if (!id) return { error: "That is not a YouTube video link." };
  const ref = `https://www.youtube.com/watch?v=${id}`;
  if (transcript.trim()) {
    const text = normalizeText(transcript);
    if (text.length < MIN_SOURCE_CHARS) return { error: "Paste the full transcript." };
    return { kind: "youtube", inputType: "transcript", title: deriveTitle({ title, fallback: `YouTube video ${id}` }), sourceRef: ref, text };
  }
  const noCaptions = { error: "We could not get a transcript for that video (it has no public captions, or YouTube blocked the request). Paste the transcript below and add it again." };
  try {
    const page = await safeFetch(`${ref}&hl=en`, { cookie: "CONSENT=YES+1" });
    const html = page.body.toString("utf8");
    const track = pickCaptionTrack(parseCaptionTracks(html));
    if (!track) return noCaptions;
    const captions = await safeFetch(track.baseUrl);
    const text = timedTextToTranscript(captions.body.toString("utf8"));
    if (text.length < MIN_SOURCE_CHARS) return noCaptions;
    const pageTitle = htmlTitle(html)?.replace(/\s*-\s*YouTube$/, "") ?? null;
    return { kind: "youtube", inputType: "transcript", title: deriveTitle({ title: title || pageTitle, fallback: `YouTube video ${id}` }), sourceRef: ref, text };
  } catch {
    return noCaptions;
  }
}
