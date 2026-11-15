import { beforeEach, describe, expect, it } from "vitest";
import { writingAssist } from "./assist";
import { manifest } from "./manifest";
import { renderEditorialPage } from "./render";
import { getIssue, listIssues, resetEditorialStore, seedExampleIssues, syncSendStatsFromEsp } from "./store";

const orgA = "org-a";
const orgB = "org-b";

describe("editorial manifest", () => {
  it("matches the module contract", () => {
    expect(manifest.id).toBe("editorial");
    expect(manifest.slug).toBe("editorial");
    expect(manifest.planEntitlement).toBe("editorial");
    expect(manifest.nav[0]).toMatchObject({ href: "/editorial", permission: "editorial.read" });
    expect(manifest.permissions.map((permission) => permission.key)).toEqual([
      "editorial.read",
      "editorial.write",
      "editorial.publish",
    ]);
    expect(manifest.routes.some((route) => route.path === "/editorial")).toBe(true);
    expect(manifest.jobs.some((job) => job.name === "editorial.esp.sync" && job.description.includes("TODO"))).toBe(true);
  });
});

describe("editorial issues", () => {
  beforeEach(() => {
    resetEditorialStore();
  });

  it("seeds EXAMPLE issues with organizationId and send stats", () => {
    const seeded = seedExampleIssues(orgA);
    expect(seeded).toHaveLength(3);
    expect(seeded.every((issue) => issue.organizationId === orgA && issue.title.startsWith("EXAMPLE:"))).toBe(true);
    expect(getIssue(orgA, "example-monday-brief")).toMatchObject({
      organizationId: orgA,
      status: "sent",
      opens: 18420,
      clicks: 2104,
      revenue: 12840.5,
    });
    expect(getIssue(orgA, "example-coverage-draft")).toMatchObject({
      status: "draft",
      opens: 0,
      clicks: 0,
      revenue: 0,
      sentAt: null,
    });
    expect(getIssue(orgA, "example-subscriber-qa")?.scheduledFor).toBe("2026-11-18T13:00:00.000Z");
  });

  it("keeps rows inside the requested organization", () => {
    const a = listIssues(orgA);
    const b = listIssues(orgB);
    expect(a).toHaveLength(3);
    expect(b).toHaveLength(3);
    expect(a.every((issue) => issue.organizationId === orgA)).toBe(true);
    expect(b.every((issue) => issue.organizationId === orgB)).toBe(true);
    expect(getIssue(orgA, "example-monday-brief")?.organizationId).toBe(orgA);
    expect(getIssue(orgB, "example-monday-brief")?.organizationId).toBe(orgB);
    expect(getIssue(orgA, "missing")).toBeNull();
    expect(getIssue("", "example-monday-brief")).toBeNull();
    expect(() => listIssues("")).toThrow(/organizationId/);
  });

  it("does not let callers mutate stored rows or ESP stats", () => {
    const issue = getIssue(orgA, "example-monday-brief");
    if (!issue) throw new Error("expected example issue");
    issue.opens = 1;
    issue.organizationId = orgB;
    expect(getIssue(orgA, "example-monday-brief")?.opens).toBe(18420);
    expect(syncSendStatsFromEsp()).toMatchObject({ status: "todo" });
    expect(getIssue(orgA, "example-monday-brief")?.revenue).toBe(12840.5);
    seedExampleIssues(orgA);
    expect(listIssues(orgA)).toHaveLength(3);
  });
});

describe("editorial page", () => {
  beforeEach(() => {
    resetEditorialStore();
  });

  it("renders the issue list and send stats for one organization", async () => {
    const html = await renderEditorialPage({ organizationId: orgA, canWrite: true });
    expect(html).toContain("EXAMPLE: Monday market brief");
    expect(html).toContain("EXAMPLE: Subscriber Q&amp;A");
    expect(html).toContain("EXAMPLE: How we pick coverage");
    expect(html).toContain("18,420");
    expect(html).toContain("2,104");
    expect(html).toContain("$12,840.50");
    expect(html).toContain(`data-organization-id="${orgA}"`);
    expect(html).toContain('href="/editorial?issue=example-monday-brief"');
    expect(html).toContain("TODO: sync opens, clicks, and revenue from the ESP");
    expect(html).not.toContain(orgB);
  });

  it("renders one issue and escapes organization text", async () => {
    const html = await renderEditorialPage({
      organizationId: `acme"><script>`,
      issueId: "example-monday-brief",
      canWrite: true,
    });
    expect(html).toContain("EXAMPLE — What moved before the open");
    expect(html).toContain("2026-11-10 13:00");
    expect(html).toContain('href="/editorial"');
    expect(html).toContain("acme&quot;&gt;&lt;script&gt;");
    expect(html).not.toContain(`acme"><script>`);
    expect(html).toContain("<textarea");
  });

  it("shows a missing issue without listing other rows", async () => {
    const html = await renderEditorialPage({ organizationId: orgA, issueId: "missing", canWrite: false });
    expect(html).toContain("No issue with that id is stored for this organization");
    expect(html).not.toContain("EXAMPLE: Monday market brief");
  });

  it("blocks writing assist without editorial.write", async () => {
    let calls = 0;
    const html = await renderEditorialPage({
      organizationId: orgA,
      issueId: "example-coverage-draft",
      prompt: "Tighten the lede",
      canWrite: false,
      loadAssist: async () => {
        calls += 1;
        return null;
      },
    });
    expect(calls).toBe(0);
    expect(html).toContain("editorial.write");
    expect(html).not.toContain("<textarea");
  });

  it("calls the assist loader and shows a TODO when the AI package is missing", async () => {
    let calls = 0;
    const html = await renderEditorialPage({
      organizationId: orgA,
      issueId: "example-coverage-draft",
      prompt: "Tighten the lede",
      canWrite: true,
      loadAssist: async () => {
        calls += 1;
        return null;
      },
    });
    expect(calls).toBe(1);
    expect(html).toContain("@pubcommand/ai");
    expect(html).toContain("TODO: the assist does not write the issue body yet.");
  });
});

describe("writing assist", () => {
  it("calls the AI package with the issue and organization", async () => {
    let seen = "";
    const result = await writingAssist(
      { organizationId: orgA, issueTitle: "EXAMPLE: How we pick coverage", prompt: "Tighten the lede" },
      async () => async (request) => {
        seen = request.messages.map((message) => message.content).join("\n");
        return { status: "stub", provider: "anthropic", reason: "stubbed draft" };
      },
    );
    expect(result).toMatchObject({ status: "stub", provider: "anthropic", reason: "stubbed draft" });
    expect(seen).toContain(orgA);
    expect(seen).toContain("EXAMPLE: How we pick coverage");
    expect(seen).toContain("Tighten the lede");
  });

  it("shows a TODO when no prompt or provider is available", async () => {
    await expect(
      writingAssist({ organizationId: orgA, issueTitle: "EXAMPLE", prompt: "  " }, async () => {
        throw new Error("should not load");
      }),
    ).resolves.toMatchObject({ status: "todo", provider: null });
    await expect(
      writingAssist({ organizationId: orgA, issueTitle: "EXAMPLE", prompt: "hello" }, async () => null),
    ).resolves.toMatchObject({ status: "todo", reason: expect.stringContaining("@pubcommand/ai") });
  });

  it("calls the workspace AI package", async () => {
    const result = await writingAssist({
      organizationId: orgA,
      issueTitle: "EXAMPLE: How we pick coverage",
      prompt: "Tighten the lede",
    });
    expect(result.provider).toBe("anthropic");
    expect(result.status === "unavailable" || result.status === "stub").toBe(true);
    expect(result.reason.length).toBeGreaterThan(0);
  });
});
