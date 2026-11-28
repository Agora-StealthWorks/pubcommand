import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { uploadedImageType } from "../pubsetup/image-type";
import { ToolError } from "./tool-kit";

/**
 * An image an agent points to by address (a guru's photo), fetched by PubCommand. Only public
 * https addresses: names that resolve to private, loopback, link-local or shared networks are
 * refused (so an agent cannot make the server reach internal services), every redirect is
 * checked the same way, and the bytes must be a PNG, JPG, GIF, WebP or SVG image.
 */

export type RemoteImage = { filename: string; mime: string; data: Uint8Array<ArrayBuffer> };

export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const lower = ip.toLowerCase();
  return lower === "::" || lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb");
}

async function checkHost(url: URL): Promise<void> {
  if (url.protocol !== "https:") throw new ToolError("Image addresses must start with https://");
  if (url.username || url.password) throw new ToolError("Image addresses cannot carry a username or password.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true }).catch(() => [])).map((row) => row.address);
  if (addresses.length === 0) throw new ToolError(`The image's site (${url.hostname}) could not be found.`);
  if (addresses.some(isPrivateAddress)) throw new ToolError("That image address points to a private network and cannot be used.");
}

/** Recognize the image by its bytes (the declared type is only a hint). */
export function imageTypeOf(bytes: Uint8Array, name: string): string | null {
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (Buffer.from(b.subarray(0, 4)).toString("ascii") === "RIFF" && Buffer.from(b.subarray(8, 12)).toString("ascii") === "WEBP") return "image/webp";
  return uploadedImageType({ name: name.endsWith(".svg") ? name : `${name}.svg`, type: "" }, b) === "image/svg+xml" ? "image/svg+xml" : null;
}

export async function fetchRemoteImage(address: string, maxMb: number): Promise<RemoteImage> {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    throw new ToolError("photo_url must be a full https:// address of an image.");
  }
  for (let hop = 0; hop < 4; hop += 1) {
    await checkHost(url);
    let response: Response;
    try {
      response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { "user-agent": "PubCommand-Agent/1.0", accept: "image/*" } });
    } catch {
      throw new ToolError("The image could not be downloaded (no answer within 15 seconds).");
    }
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      url = new URL(response.headers.get("location")!, url);
      continue;
    }
    if (!response.ok) throw new ToolError(`The image address answered ${response.status}.`);
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > maxMb * 1024 * 1024) throw new ToolError(`Images must be under ${maxMb} MB.`);
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.length > maxMb * 1024 * 1024) throw new ToolError(`Images must be under ${maxMb} MB.`);
    const name = decodeURIComponent(url.pathname.split("/").pop() || "image").slice(0, 200) || "image";
    const mime = imageTypeOf(data, name);
    if (!mime) throw new ToolError("That address is not a PNG, JPG, GIF, WebP or SVG image.");
    return { filename: name, mime, data };
  }
  throw new ToolError("The image address redirects too many times.");
}
