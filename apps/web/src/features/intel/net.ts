import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import zlib from "node:zlib";
import { guardedFetch, isPrivateAddress, type FetchOnce, type GuardedFetchResult } from "../../../../../modules/intel/index";

/** A desktop browser UA: many sales pages refuse obvious bots. */
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export async function resolveHost(hostname: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true }, (error, addresses: LookupAddress[]) => (error ? reject(error) : resolve(addresses.map((entry) => entry.address))));
  });
}

/**
 * The lookup the socket actually connects with. It re-checks every address at
 * connect time, so a name that resolved publicly a moment ago (DNS rebinding)
 * still cannot reach a private address.
 */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { all: true }, (error, addresses: LookupAddress[]) => {
    if (error) return callback(error, "", 4);
    const list = addresses.filter((entry) => !options.family || entry.family === options.family);
    if (!list.length || list.some((entry) => isPrivateAddress(entry.address))) {
      const blocked = Object.assign(new Error("That host resolves to a private address."), { code: "EPRIVATE" });
      return callback(blocked, "", 4);
    }
    if (options.all) return (callback as unknown as (error: null, addresses: LookupAddress[]) => void)(null, list);
    return callback(null, list[0]!.address, list[0]!.family);
  });
};

/** One request, no redirects, body capped at maxBytes (after decompression). */
export const fetchOnce: FetchOnce = (url, options) =>
  new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(
      url,
      {
        method: "GET",
        lookup: guardedLookup,
        timeout: options.timeoutMs,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          "accept-language": "en-US,en;q=0.8",
          "accept-encoding": "gzip, deflate, br",
        },
      },
      (response) => {
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(response.headers)) if (value !== undefined) headers[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.resume();
          resolve({ status, headers, body: new Uint8Array(), truncated: false });
          return;
        }
        const encoding = headers["content-encoding"] ?? "";
        const stream =
          encoding.includes("gzip") ? response.pipe(zlib.createGunzip()) : encoding.includes("br") ? response.pipe(zlib.createBrotliDecompress()) : encoding.includes("deflate") ? response.pipe(zlib.createInflate()) : response;
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        const finish = () => resolve({ status, headers, body: new Uint8Array(Buffer.concat(chunks)), truncated });
        stream.on("data", (chunk: Buffer) => {
          if (truncated) return;
          size += chunk.length;
          if (size > options.maxBytes) {
            chunks.push(chunk.subarray(0, chunk.length - (size - options.maxBytes)));
            truncated = true;
            request.destroy();
            finish();
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () => !truncated && finish());
        stream.on("error", (error) => (truncated ? undefined : reject(error)));
      },
    );
    request.on("timeout", () => request.destroy(new Error("The page took too long to answer.")));
    request.on("error", (error: Error & { code?: string }) => reject(error.code === "EPRIVATE" ? new Error("That link points at a private address.") : error));
    request.end();
  });

/** Fetch a public page: SSRF-guarded on every hop, size- and time-limited. */
export function fetchPublic(url: string, limits: { maxBytes: number; timeoutMs: number }): Promise<GuardedFetchResult> {
  return guardedFetch(url, { fetchOnce, resolve: resolveHost }, limits);
}
