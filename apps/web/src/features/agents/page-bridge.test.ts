import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeAgentPass, readAgentPass } from "./assertion";
import { checkPath, describeForm, readPage } from "./page-bridge";
import { ToolError } from "./tool-kit";

const previous = process.env.AUTH_SECRET;
beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-for-agent-passes";
});
afterAll(() => {
  process.env.AUTH_SECRET = previous;
});

const pass = { u: "user", o: "org", h: "org", a: "agent", t: "token", b: null, s: false };

describe("agent passes", () => {
  it("round-trip, and refuse tampering and expiry", () => {
    const value = makeAgentPass(pass, 1_000_000);
    expect(readAgentPass(value, 1_000_500)).toMatchObject(pass);
    expect(readAgentPass(value, 1_000_000 + 121_000)).toBeNull();
    const [body, signature] = value.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, "base64url").toString()), s: true })).toString("base64url");
    expect(readAgentPass(`${forged}.${signature}`, 1_000_500)).toBeNull();
    expect(readAgentPass("garbage", 1_000_500)).toBeNull();
    expect(readAgentPass(null)).toBeNull();
  });
});

describe("page bridge", () => {
  it("keeps agents off their own management, accounts, billing and domains", () => {
    expect(checkPath("/funnels?tab=setup")).toBe("/funnels?tab=setup");
    for (const path of ["/agents", "/agents/approvals", "/account", "/billing", "/settings/domains", "/api/mcp", "/sites/org/x", "//evil.example.com", "funnels"]) {
      expect(() => checkPath(path)).toThrow(ToolError);
    }
  });

  it("reads a page's text, links and action forms without exposing internal action fields", () => {
    const html = `<html><head><title>Funnels · Acme</title></head><body>
      <aside><nav><a href="/settings">Settings</a></nav></aside>
      <main><h1>Launch funnels</h1><p>Video-series launches.</p><a href="/funnels/123">MAHA launch</a>
        <form action="" method="POST" enctype="multipart/form-data">
          <input type="hidden" name="$ACTION_ID_abc123" value="" />
          <input type="hidden" name="siteId" value="s1" />
          <h2>New funnel</h2>
          <label for="n">Name</label><input id="n" name="name" required value="" />
          <select name="mode"><option value="evergreen" selected>Evergreen</option><option value="live">Live</option></select>
          <label><input type="checkbox" name="waitlist" checked /> Waitlist</label>
          <button type="submit" name="intent" value="create">Create</button>
        </form>
        <form action="/search" method="get"><input name="q" /></form>
      </main></body></html>`;
    const page = readPage("/funnels?notice=Saved.", 200, html);
    expect(page.title).toBe("Funnels · Acme");
    expect(page.message).toEqual({ notice: "Saved." });
    expect(page.text).toContain("# Launch funnels");
    expect(page.links).toEqual([{ text: "MAHA launch", href: "/funnels/123" }]);
    expect(page.forms).toHaveLength(1);
    const form = describeForm(page.forms[0]!);
    expect(form.title).toBe("New funnel");
    expect(form.fields.map((f) => f.name)).toEqual(["name", "mode", "waitlist"]);
    expect(form.fields[0]).toMatchObject({ label: "Name", required: true });
    expect(form.fields[1]!.options?.[0]).toMatchObject({ value: "evergreen", selected: true });
    expect(form.buttons).toEqual([{ label: "Create", name: "intent", value: "create" }]);
    expect(form.hidden).toEqual({ siteId: "s1" });
    expect(JSON.stringify(form)).not.toContain("$ACTION");
  });
});
