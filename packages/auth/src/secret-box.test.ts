import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, secretHint } from "./secret-box";

const SECRET = "local-dev-secret-at-least-16-chars";

describe("secret box", () => {
  it("round-trips and never stores the plain text", () => {
    const key = "re_abcdefghijklmnop1234";
    const sealed = encryptSecret(key, SECRET, "resend-api-key");
    expect(sealed).not.toContain(key);
    expect(sealed).not.toContain("1234");
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(encryptSecret(key, SECRET, "resend-api-key")).not.toBe(sealed);
    expect(decryptSecret(sealed, SECRET, "resend-api-key")).toBe(key);
  });

  it("refuses another secret, another purpose and tampering", () => {
    const sealed = encryptSecret("re_key_9876", SECRET, "resend-api-key");
    expect(decryptSecret(sealed, `${SECRET}-other`, "resend-api-key")).toBeNull();
    expect(decryptSecret(sealed, SECRET, "totp")).toBeNull();
    const parts = sealed.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(decryptSecret(parts.join("."), SECRET, "resend-api-key")).toBeNull();
    expect(decryptSecret("garbage", SECRET, "resend-api-key")).toBeNull();
  });

  it("shows only the last four characters", () => {
    expect(secretHint("re_abcdefghijklmnop1234")).toBe("…1234");
    expect(secretHint("")).toBe("");
  });
});
