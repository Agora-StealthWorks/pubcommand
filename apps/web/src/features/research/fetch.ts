import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import zlib from "node:zlib";
import { checkFetchUrl, isBlockedAddress, isIpLiteral } from "../../../../../modules/research/ingest";

const MAX_REDIRECTS = 5;
const MAX_BYTES = 15 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const BLOCKED = "That address points inside a private network, so it cannot be read.";

export class FetchRefused extends Error {}

/**
 * DNS lookup that refuses private answers. It runs inside the socket connect,
 * so the address we check is the address we connect to (no DNS rebinding gap).
 */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 4);
    const list = addresses as unknown as LookupAddress[];
    if (!list.length || list.some((entry) => isBlockedAddress(entry.address))) {
      return callback(Object.assign(new Error(BLOCKED), { code: "EPRIVATE" }), "", 4);
    }
    if (options.all) return (callback as unknown as (err: null, all: LookupAddress[]) => void)(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
};

export type Fetched = { url: string; status: number; contentType: string; body: Buffer };

function once(url: URL, headers: Record<string, string>): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(
      url,
      { method: "GET", headers, lookup: guardedLookup, timeout: TIMEOUT_MS, agent: false },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.resume();
          resolve({ status, headers: response.headers, body: Buffer.alloc(0) });
          return;
        }
        const encoding = String(response.headers["content-encoding"] ?? "").toLowerCase();
        const stream =
          encoding === "gzip" || encoding === "x-gzip"
            ? response.pipe(zlib.createGunzip())
            : encoding === "deflate"
              ? response.pipe(zlib.createInflate())
              : encoding === "br"
                ? response.pipe(zlib.createBrotliDecompress())
                : response;
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            request.destroy(new FetchRefused("That page is too large to read (over 15 MB)."));
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () => resolve({ status, headers: response.headers, body: Buffer.concat(chunks) }));
        stream.on("error", reject);
      },
    );
    request.on("timeout", () => request.destroy(new FetchRefused("The site took too long to answer.")));
    request.on("error", (error: Error & { code?: string }) => {
      if (error.code === "EPRIVATE") reject(new FetchRefused(BLOCKED));
      else if (error instanceof FetchRefused) reject(error);
      else if (error.code === "ENOTFOUND") reject(new FetchRefused("That site could not be found."));
      else reject(new FetchRefused(`The site could not be reached (${error.code ?? error.message}).`));
    });
    request.end();
  });
}

/**
 * GET a public URL. Every hop (including redirects) passes the URL check and
 * the guarded DNS lookup; IP-literal hosts are checked directly because Node
 * skips the lookup for them. Throws FetchRefused with a readable reason.
 */
export async function safeFetch(raw: string, extraHeaders: Record<string, string> = {}): Promise<Fetched> {
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const checked = checkFetchUrl(current);
    if (!checked.ok) throw new FetchRefused(checked.reason);
    const host = checked.url.hostname.replace(/^\[|\]$/g, "");
    if (isIpLiteral(host) && isBlockedAddress(host)) throw new FetchRefused(BLOCKED);
    const response = await once(checked.url, {
      "user-agent": "Mozilla/5.0 (compatible; ResearchReader/1.0)",
      accept: "text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.5",
      "accept-encoding": "gzip, deflate, br",
      "accept-language": "en-US,en;q=0.8",
      ...extraHeaders,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.location;
      if (!location) throw new FetchRefused("The site redirected without saying where.");
      current = new URL(location, checked.url).toString();
      continue;
    }
    if (response.status >= 400) {
      const hint = response.status === 401 || response.status === 403 ? " It may block automated readers; paste the text instead." : "";
      throw new FetchRefused(`The site answered ${response.status}.${hint}`);
    }
    return { url: checked.url.toString(), status: response.status, contentType: String(response.headers["content-type"] ?? ""), body: response.body };
  }
  throw new FetchRefused("Too many redirects.");
}
