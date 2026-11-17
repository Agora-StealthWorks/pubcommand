import { describe, expect, it } from "vitest";
import { describeSecrets, findSecrets, hasSecrets } from "./secrets";

// Built at runtime so no scanner mistakes this test for a leaked key.
const fake = (prefix: string, body: string) => `${prefix}${body}`;

describe("secret detection", () => {
  it("finds well-known key formats", () => {
    const samples = [
      fake("sk-ant-", "api03-abcdefghijklmnopqrstuvwxyz012345"),
      fake("AKIA", "ABCDEFGHIJKLMNOP"),
      fake("ghp_", "abcdefghijklmnopqrstuvwxyz0123456789"),
      fake("xoxb-", "123456789012-abcdefghij"),
      fake("AIza", "SyA1234567890abcdefghijklmnopqrstuv"),
      "-----BEGIN RSA PRIVATE KEY-----",
      fake("eyJhbGciOiJIUzI1NiJ9.", "eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop"),
      fake("Authorization: Bearer ", "abcdefghijklmnopqrstuvwxyz123456"),
      "DATABASE_URL=postgresql://postgres:Sup3rSecret@db.example.com:5432/app",
    ];
    for (const sample of samples) expect(hasSecrets(`Notes\n${sample}\n`), sample.slice(0, 12)).toBe(true);
  });

  it("finds assigned passwords and tokens", () => {
    expect(findSecrets("login\npassword: localtest123")).toEqual([{ kind: 'Value for "password"', line: 2 }]);
    expect(hasSecrets("API_KEY = 'a8f5f167f44f4964e6c998dee827110c'")).toBe(true);
    expect(hasSecrets("The api key is Zx81Kq0PwLmN44sd")).toBe(true);
  });

  it("leaves ordinary prose and placeholders alone", () => {
    const prose = [
      "Reset your password from the account page.",
      "Set HUB_API_TOKEN in Railway (token: HUB_API_TOKEN).",
      "password: <your password here>",
      "token: ${HUB_API_TOKEN}",
      "secret: process.env.SECRET_VALUE",
      "The secret is consistency and patience.",
      "Use postgresql://user:password@localhost:5432/dev for local work.",
      "The skeleton key to copywriting is clarity.",
      "Price was $49 and the token sale ended.",
    ];
    for (const line of prose) expect(findSecrets(line), line).toEqual([]);
  });

  it("describes hits without the value", () => {
    const hits = findSecrets("password: hunter2hunter2\nAKIAABCDEFGHIJKLMNOP");
    const text = describeSecrets(hits);
    expect(text).toContain("line 1");
    expect(text).not.toContain("hunter2");
  });
});
