/**
 * Note attachments (images and files). Bytes live in Postgres and are served
 * by an authenticated route. Pure rules: which files are allowed, how they are
 * served, and how `![[file.png]]` in a note finds its attachment.
 */

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_NOTE = 40;

/** Served inline (rendered as <img>). SVG is never inline: it can carry script. */
const INLINE_IMAGES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** Downloaded, never rendered. */
const DOWNLOADS: Record<string, string> = {
  pdf: "application/pdf",
  svg: "image/svg+xml",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
};

export function extensionOf(filename: string): string {
  const match = /\.([a-z0-9]{1,8})$/i.exec(filename);
  return match ? match[1]!.toLowerCase() : "";
}

/** A safe display filename: no folders, control characters or quotes. */
export function cleanFilename(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f"<>|*?:]/g, "").replace(/\s+/g, " ").trim();
  return base.slice(-120) || "file";
}

export type AttachmentCheck = { ok: true; filename: string; contentType: string; inline: boolean } | { ok: false; error: string };

/** Content type comes from the extension (never from the browser), and must match the file's magic bytes for images. */
export function checkAttachment(name: string, size: number, head: Uint8Array): AttachmentCheck {
  const filename = cleanFilename(name);
  if (size <= 0) return { ok: false, error: "That file is empty." };
  if (size > MAX_ATTACHMENT_BYTES) return { ok: false, error: "Files can be up to 10 MB." };
  const ext = extensionOf(filename);
  const image = INLINE_IMAGES[ext];
  if (image) {
    if (!looksLike(ext, head)) return { ok: false, error: "That image file is damaged or not what its name says." };
    return { ok: true, filename, contentType: image, inline: true };
  }
  const download = DOWNLOADS[ext];
  if (download) return { ok: true, filename, contentType: download, inline: false };
  return { ok: false, error: "That file type is not supported. Use an image (PNG, JPG, GIF, WebP), PDF, Office file, text or CSV." };
}

function looksLike(ext: string, b: Uint8Array): boolean {
  const at = (i: number) => b[i] ?? -1;
  if (ext === "png") return at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47;
  if (ext === "jpg" || ext === "jpeg") return at(0) === 0xff && at(1) === 0xd8;
  if (ext === "gif") return at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46;
  if (ext === "webp") return at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(8) === 0x57 && at(9) === 0x45;
  return false;
}

export function isInlineImage(contentType: string): boolean {
  return Object.values(INLINE_IMAGES).includes(contentType);
}

/** Response headers for serving an attachment. */
export function attachmentHeaders(file: { filename: string; contentType: string; size: number }): Record<string, string> {
  const inline = isInlineImage(file.contentType);
  const ascii = file.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return {
    "Content-Type": file.contentType,
    "Content-Length": String(file.size),
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": "private, max-age=300",
  };
}

/** Match an embed target (`![[Pasted image 2024.png]]`, `![[assets/chart.png|300]]`) to an attachment by filename. */
export function findAttachment<T extends { filename: string }>(attachments: readonly T[], target: string): T | null {
  const name = (target.split("|")[0] ?? "").split("/").pop()?.trim().toLowerCase();
  if (!name) return null;
  return attachments.find((file) => file.filename.toLowerCase() === name) ?? null;
}

/** The Markdown to insert into a note for a new attachment. */
export function embedMarkdown(filename: string): string {
  return `![[${filename}]]`;
}
