import { guardedFetch } from "../../../../../../../modules/intel/index";
import { verifyImageUrl } from "@/features/ispy/email-view";
import { fetchOnce, resolveHost } from "@/features/intel/net";

const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|bmp|avif|svg\+xml)$/i;

/**
 * ISpy's image proxy for the email reader: signed URLs only, every hop SSRF-checked,
 * images only, 5 MB at most. Publishers see PubCommand, never the reader.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const target = url.searchParams.get("u") ?? "";
  const signature = url.searchParams.get("s") ?? "";
  if (!target || !signature || !verifyImageUrl(target, signature)) return new Response("Not found", { status: 404 });
  const res = await guardedFetch(target, { fetchOnce, resolve: resolveHost }, { maxBytes: 5 * 1024 * 1024, timeoutMs: 12_000, maxRedirects: 5 });
  if (!res.ok || res.status >= 400) return new Response("Image unavailable", { status: 404 });
  const type = res.contentType.split(";")[0]!.trim();
  if (!IMAGE_TYPES.test(type) || res.truncated) return new Response("Not an image", { status: 415 });
  const headers: Record<string, string> = { "content-type": type, "cache-control": "public, max-age=86400, immutable", "x-content-type-options": "nosniff" };
  if (type.includes("svg")) headers["content-security-policy"] = "default-src 'none'; style-src 'unsafe-inline'";
  return new Response(Buffer.from(res.body), { status: 200, headers });
}
