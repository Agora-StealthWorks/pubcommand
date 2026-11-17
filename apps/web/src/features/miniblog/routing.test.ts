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

describe("Mini-Blog tracked links and post images", () => {
  it("routes /go/<id> and /asset/<id> to the public handlers", async () => {
    const id = "11111111-2222-4333-8444-555555555555";
    expect(await rewriteOf(`/b/alerts/go/${id}`)).toBe(`/sites/public/acme/b/alerts/go/${id}`);
    expect(await rewriteOf(`/t/alerts/go/${id}`)).toBe(`/sites/public/acme/t/alerts/go/${id}`);
    expect(await rewriteOf(`/b/alerts/asset/${id}`)).toBe(`/sites/public/acme/b/alerts/asset/${id}`);
  });

  it("routes the funnel SMS and unsubscribe endpoints to the public site", async () => {
    expect(await rewriteOf("/l/launch/sms")).toBe("/sites/public/acme/l/launch/sms");
    expect(await rewriteOf("/l/launch/unsubscribe")).toBe("/sites/public/acme/l/launch/unsubscribe");
  });
});
