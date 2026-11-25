const IMAGE_TYPES = /^image\/(png|jpeg|gif|webp|svg\+xml)$/;

const BY_EXTENSION: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };

/**
 * The image type of an upload, or null when it is not an allowed image. Browsers often send an
 * .svg file with an empty type or as text/xml, so SVG is recognized by its extension and content
 * (an <svg> root) too; the declared type is trusted for the bitmap formats.
 */
export function uploadedImageType(file: { name: string; type: string }, bytes: Uint8Array): string | null {
  const head = Buffer.from(bytes.subarray(0, 2048)).toString("utf8").replace(/^﻿/, "").trimStart();
  const looksSvg = /^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head);
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? "";
  if (looksSvg && (file.type === "image/svg+xml" || ext === "svg" || file.type === "" || /xml/.test(file.type))) return "image/svg+xml";
  if (file.type === "image/svg+xml") return null; // claims SVG but is not one
  if (IMAGE_TYPES.test(file.type)) return file.type;
  const guess = BY_EXTENSION[ext];
  return guess && guess !== "image/svg+xml" && (file.type === "" || file.type === "application/octet-stream") ? guess : null;
}
