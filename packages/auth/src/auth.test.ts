import { describe, expect, it } from "vitest";
import { openGate, sealGate } from "./edge";
import { consumeMagicLink, issueMagicLink, type MagicLinkStore } from "./magic-link";
import { hashPassword, verifyPassword } from "./password";
import { ssoNotConfigured } from "./sso";
import { decryptTotpSecret, encryptTotpSecret, hotp, verifyTotp } from "./totp";

describe("password", () => {
  it("hashes and verifies a password", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).not.toContain("correct horse");
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("nope", hash)).toBe(false);
  });
});

describe("magic link", () => {
  it("consumes a token once and rejects an expired token", async () => {
    const records = new Map<string, { userId: string; expiresAt: Date; consumed: boolean }>();
    const store: MagicLinkStore = {
      async save(record) {
        records.set(record.tokenHash, { userId: record.userId, expiresAt: record.expiresAt, consumed: false });
      },
      async consume(tokenHash, now) {
        const record = records.get(tokenHash);
        if (!record || record.consumed || record.expiresAt <= now) return null;
        record.consumed = true;
        return { userId: record.userId };
      },
    };
    const issued = await issueMagicLink(store, "user-1", new Date("2026-01-01T00:00:00Z"));
    expect(await consumeMagicLink(store, issued.token, new Date("2026-01-01T00:05:00Z"))).toEqual({ userId: "user-1" });
    expect(await consumeMagicLink(store, issued.token, new Date("2026-01-01T00:05:00Z"))).toBeNull();

    const expired = await issueMagicLink(store, "user-1", new Date("2026-01-01T00:00:00Z"));
    expect(await consumeMagicLink(store, expired.token, new Date("2026-01-01T00:21:00Z"))).toBeNull();
  });
});

describe("totp", () => {
  it("matches the RFC 6238 SHA-1 vector and round-trips an encrypted secret", () => {
    const secret = Buffer.from("12345678901234567890", "ascii");
    expect(hotp(secret, Math.floor(59 / 30))).toBe("287082");
    const cipher = encryptTotpSecret("JBSWY3DPEHPK3PXP", "auth-secret");
    expect(cipher).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptTotpSecret(cipher, "auth-secret")).toBe("JBSWY3DPEHPK3PXP");
    expect(verifyTotp("JBSWY3DPEHPK3PXP", "000000", 0)).toBe(false);
  });
});

describe("staff gate", () => {
  it("rejects a tampered gate token", async () => {
    const token = await sealGate(
      { sid: "session", uid: "user", role: "SUPER_ADMIN", mfa: false },
      "secret",
    );
    expect((await openGate(token, "secret"))?.mfa).toBe(false);
    expect(await openGate(`${token}x`, "secret")).toBeNull();
    expect(await openGate(token, "other")).toBeNull();
  });
});

describe("sso", () => {
  it("lists no providers in Phase 1", async () => {
    expect(await ssoNotConfigured.listProviders("org")).toEqual([]);
  });
});
