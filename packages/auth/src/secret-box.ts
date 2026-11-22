import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encrypts a secret at rest (AES-256-GCM, random IV) with a key derived from AUTH_SECRET and a
 * purpose label, so a value encrypted for one purpose cannot be decrypted as another.
 * Same envelope as the staff TOTP secrets: "v1.<iv>.<tag>.<body>" (base64url).
 */
function keyFor(authSecret: string, purpose: string): Buffer {
  if (authSecret.length < 16) throw new Error("AUTH_SECRET must be at least 16 characters.");
  return createHash("sha256").update(`pubcommand:secret-box:${purpose}:`).update(authSecret).digest();
}

export function encryptSecret(plain: string, authSecret: string, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(authSecret, purpose), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

/** The plain secret, or null when the payload was tampered with or belongs to another key or purpose. */
export function decryptSecret(payload: string, authSecret: string, purpose: string): string | null {
  const [version, ivPart, tagPart, bodyPart] = payload.split(".");
  if (version !== "v1" || !ivPart || !tagPart || !bodyPart) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFor(authSecret, purpose), Buffer.from(ivPart, "base64url"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(bodyPart, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** "…1234": the only part of a stored key ever shown again. */
export function secretHint(plain: string): string {
  const tail = plain.trim().slice(-4);
  return tail ? `…${tail}` : "";
}
