import { createHmac, timingSafeEqual } from "node:crypto";
import type { GatePayload } from "@pubcommand/auth/edge";

/**
 * Synchronous twin of openGate() (packages/auth/src/edge.ts) for the middleware.
 *
 * The middleware must not await before it returns: in Next.js 15.5 (Node
 * middleware), awaiting there corrupts the request body that reaches the page,
 * so uploads on admin.<root> arrived without their files. Same token format:
 * base64url(JSON) + "." + base64url(HMAC-SHA256(body, secret)).
 */
/** Set briefly by /api/auth/gate so the middleware refuses instead of looping if a reissued pass is not accepted. */
export const GATE_RETRY_COOKIE = "pc_gate_retry";

export function openGateSync(token: string, secret: string, now = Date.now()): GatePayload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: GatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as GatePayload;
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== "number" || payload.exp < now) return null;
  if (!payload.sid || !payload.uid || !payload.role) return null;
  return payload;
}
