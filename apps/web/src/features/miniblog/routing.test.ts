import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

// Org hosts never reach the custom-domain lookup, so the DB-backed helper is stubbed.
vi.mock("@/features/domains/middleware", () => ({
  customDomainResponse: async () => null,
  stripCustomDomainHeaders: (headers: Headers) => headers,
}));

const { middleware } = await import("@/middleware");

async function rewriteOf(path: string, host = "acme.localhost:3000"): Promise<string | null> {
  process.env.ROOT_DOMAIN = "localhost";
  const response = await middleware(new NextRequest(`http://${host}${path}`, { headers: { host } }));
  const target = response.headers.get("x-middleware-rewrite");
  return target ? new URL(target).pathname : null;
}

describe("Mini-Blog public routing on an org host", () => {
  it("serves /b/<site> pages without the signed-in app", async () => {
    expect(await rewriteOf("/b/alerts")).toBe("/sites/public/acme/b/alerts");
    expect(await rewriteOf("/b/alerts/big-news")).toBe("/sites/public/acme/b/alerts/big-news");
    expect(await rewriteOf("/b/alerts/subscribe/submit")).toBe("/sites/public/acme/b/alerts/subscribe/submit");
  });

  it("keeps the old /t/<site> links working", async () => {
    expect(await rewriteOf("/t/alerts")).toBe("/sites/public/acme/t/alerts");
    expect(await rewriteOf("/t/alerts/subscribe")).toBe("/sites/public/acme/t/alerts/subscribe");
  });

  it("sends the admin screens to the org app", async () => {
    expect(await rewriteOf("/mini-blog")).toBe("/sites/org/acme/mini-blog");
    expect(await rewriteOf("/b")).toBe("/sites/org/acme/b");
    expect(await rewriteOf("/blog")).toBe("/sites/org/acme/blog");
  });
});
