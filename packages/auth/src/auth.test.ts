import { describe, expect, it } from "vitest";
import { openGate, sealGate } from "./edge";
import { consumeMagicLink, inspectMagicLink, issueMagicLink, MAGIC_LINK_TTL_MS, type MagicLinkStore } from "./magic-link";
import { hashPassword, verifyPassword } from "./password";
import { ssoNotConfigured } from "./sso";
import { decryptTotpSecret, encryptTotpSecret, hotp, verifyTotp } from "./totp";

describe("password", () => {
  it("hashes and verifies a password", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).not.toContain("correct horse");
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("nope", hash)).toBe(false);
  }, 30_000);

  it("accepts a bcrypt $2b$ hash on the password login path", async () => {
    const hash = "$2b$12$cDNQQZkReczV5Ho7D8ZdqufpYeSApFWf18fomR1TWAHGMq9iHzpZ.";
    expect(await verifyPassword("stephen-test-password", hash)).toBe(true);
    expect(await verifyPassword("nope", hash)).toBe(false);
  }, 30_000);
});

function memoryStore() {
  const records = new Map<string, { id: string; userId: string; purpose: string; expiresAt: Date; consumedAt: Date | null }>();
  const store: MagicLinkStore = {
    async save(record) {
      records.set(record.tokenHash, { id: record.tokenHash, userId: record.userId, purpose: record.purpose, expiresAt: record.expiresAt, consumedAt: null });
    },
    async find(tokenHash) {
      const record = records.get(tokenHash);
      return record ? { ...record } : null;
    },
    async markConsumed(id, now) {
      const record = records.get(id);
      if (!record || record.consumedAt) return false;
      record.consumedAt = now;
      return true;
    },
  };
  return store;
}

describe("magic link", () => {
  const t0 = new Date("2026-01-01T00:00:00Z");
  const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

  it("consumes a token once and rejects an expired token", async () => {
    const store = memoryStore();
    const issued = await issueMagicLink(store, "user-1", t0);
    expect(await consumeMagicLink(store, issued.token, at(5))).toEqual({ userId: "user-1" });
    expect(await consumeMagicLink(store, issued.token, at(5))).toBeNull();

    const expired = await issueMagicLink(store, "user-1", t0);
    expect(await consumeMagicLink(store, expired.token, at(21))).toBeNull();
    expect(await consumeMagicLink(store, "", at(1))).toBeNull();
    expect(await consumeMagicLink(store, "not-a-token", at(1))).toBeNull();
  });

  it("never lets a reset token sign in, or a sign-in token reset a password", async () => {
    const store = memoryStore();
    const reset = await issueMagicLink(store, "user-1", t0, "password_reset");
    expect(await consumeMagicLink(store, reset.token, at(1))).toBeNull();
    expect(await consumeMagicLink(store, reset.token, at(1), "login")).toBeNull();
    // The failed login attempt did not use it up.
    expect(await consumeMagicLink(store, reset.token, at(1), "password_reset")).toEqual({ userId: "user-1" });

    const login = await issueMagicLink(store, "user-2", t0, "login");
    expect(await inspectMagicLink(store, login.token, at(1), "password_reset")).toBeNull();
    expect(await consumeMagicLink(store, login.token, at(1), "password_reset")).toBeNull();
    expect(await consumeMagicLink(store, login.token, at(1), "login")).toEqual({ userId: "user-2" });
  });

  it("gives a reset link 30 minutes, single use, and inspecting does not use it", async () => {
    const store = memoryStore();
    const reset = await issueMagicLink(store, "user-1", t0, "password_reset");
    expect(reset.expiresAt.getTime() - t0.getTime()).toBe(MAGIC_LINK_TTL_MS.password_reset);
    expect(MAGIC_LINK_TTL_MS.password_reset).toBe(30 * 60_000);
    expect(await inspectMagicLink(store, reset.token, at(29), "password_reset")).toEqual({ userId: "user-1" });
    expect(await inspectMagicLink(store, reset.token, at(29), "password_reset")).toEqual({ userId: "user-1" });
    expect(await consumeMagicLink(store, reset.token, at(29), "password_reset")).toEqual({ userId: "user-1" });
    expect(await consumeMagicLink(store, reset.token, at(29), "password_reset")).toBeNull();
    expect(await inspectMagicLink(store, reset.token, at(29), "password_reset")).toBeNull();

    const late = await issueMagicLink(store, "user-1", t0, "password_reset");
    expect(await inspectMagicLink(store, late.token, at(30), "password_reset")).toBeNull();
    expect(await consumeMagicLink(store, late.token, at(31), "password_reset")).toBeNull();
  });

  it("lets only one of two racing consumers win", async () => {
    const store = memoryStore();
    const issued = await issueMagicLink(store, "user-1", t0, "password_reset");
    const results = await Promise.all([
      consumeMagicLink(store, issued.token, at(1), "password_reset"),
      consumeMagicLink(store, issued.token, at(1), "password_reset"),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
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
