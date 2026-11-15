export const SESSION_COOKIE = "pc_session";
export const GATE_COOKIE = "pc_gate";
export const IMPERSONATION_COOKIE = "pc_impersonate";

export type GatePayload = {
  sid: string;
  uid: string;
  role: "SUPER_ADMIN" | "SUPPORT" | "BILLING" | "OPS";
  mfa: boolean;
  exp: number;
};

export type ImpersonationPayload = {
  staffUserId: string;
  targetUserId: string;
  organizationId: string;
  exp: number;
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function sign(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function seal(payload: object, secret: string): Promise<string> {
  const body = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${await sign(secret, body)}`;
}

async function open<T>(token: string, secret: string): Promise<T | null> {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = await sign(secret, body);
  if (!safeEqual(signature, expected)) return null;
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(body))) as T;
  } catch {
    return null;
  }
}

export async function sealGate(payload: Omit<GatePayload, "exp">, secret: string, now = Date.now()): Promise<string> {
  return seal({ ...payload, exp: now + 1000 * 60 * 60 * 12 }, secret);
}

export async function openGate(token: string, secret: string, now = Date.now()): Promise<GatePayload | null> {
  const payload = await open<GatePayload>(token, secret);
  if (!payload || payload.exp < now) return null;
  if (!payload.sid || !payload.uid || !payload.role) return null;
  return payload;
}

export async function sealImpersonation(
  payload: Omit<ImpersonationPayload, "exp">,
  secret: string,
  now = Date.now(),
): Promise<string> {
  return seal({ ...payload, exp: now + 1000 * 60 * 60 * 2 }, secret);
}

export async function openImpersonation(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<ImpersonationPayload | null> {
  const payload = await open<ImpersonationPayload>(token, secret);
  if (!payload || payload.exp < now) return null;
  if (!payload.staffUserId || !payload.targetUserId || !payload.organizationId) return null;
  return payload;
}
