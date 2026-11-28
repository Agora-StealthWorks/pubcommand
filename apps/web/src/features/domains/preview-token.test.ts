import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/request", () => ({ currentRequest: async () => ({ search: "" }) }));

const { previewToken, previewTokenValid, withPreview } = await import("@/lib/preview-token");

const ORG = "11111111-1111-1111-1111-111111111111";
let saved: string | undefined;

beforeAll(() => {
  saved = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "test-secret-for-preview-tokens-0123456789";
});
afterAll(() => {
  process.env.AUTH_SECRET = saved;
});

describe("preview tokens", () => {
  it("opens only the page it was made for, in its organization", () => {
    const token = previewToken(ORG, "miniblog:a")!;
    expect(previewTokenValid(token, ORG, "miniblog:a")).toBe(true);
    expect(previewTokenValid(token, ORG, "miniblog:b")).toBe(false);
    expect(previewTokenValid(token, "22222222-2222-2222-2222-222222222222", "miniblog:a")).toBe(false);
  });

  it("expires after about a week", () => {
    const now = Date.UTC(2026, 10, 28);
    const token = previewToken(ORG, "funnel:x", now)!;
    expect(previewTokenValid(token, ORG, "funnel:x", now + 6 * 24 * 3600_000)).toBe(true);
    expect(previewTokenValid(token, ORG, "funnel:x", now + 8 * 24 * 3600_000)).toBe(false);
  });

  it("refuses tampered, empty and oversized tokens", () => {
    const token = previewToken(ORG, "website:w")!;
    const [exp, sig] = token.split(".");
    expect(previewTokenValid(`${(parseInt(exp!, 36) + 3600).toString(36)}.${sig}`, ORG, "website:w")).toBe(false);
    expect(previewTokenValid(`${exp}.${sig!.slice(0, -1)}x`, ORG, "website:w")).toBe(false);
    expect(previewTokenValid("", ORG, "website:w")).toBe(false);
    expect(previewTokenValid("a".repeat(200), ORG, "website:w")).toBe(false);
  });

  it("adds preview=1 and the token to a link, keeping its query", () => {
    const url = new URL(withPreview("https://maha-link.com/post?x=1", ORG, "miniblog:a"));
    expect(url.searchParams.get("x")).toBe("1");
    expect(url.searchParams.get("preview")).toBe("1");
    expect(previewTokenValid(url.searchParams.get("pv"), ORG, "miniblog:a")).toBe(true);
  });
});
