import { describe, expect, it } from "vitest";
import type { AgentContext } from "./context";
import { ISPY_TOOLS } from "./ispy-tools";

function ctx(input: { scope: "organization" | "platform"; modules?: string[]; grants?: string[]; admin?: boolean }): AgentContext {
  return {
    scope: input.scope,
    allowAdminActions: input.admin ?? false,
    organization: { id: "00000000-0000-0000-0000-000000000001", slug: "acme", name: "Acme" },
    origin: "https://acme.example.com",
    host: "acme.example.com",
    agent: { id: "a", name: "Agent", platform: "claude", userId: "u", ownerUserId: "u" },
    tokenId: "t",
    brands: [{ id: "00000000-0000-0000-0000-000000000002", name: "Acme", slug: "acme" }],
    subject: { entitledModuleIds: input.modules ?? [], grants: (input.grants ?? []).map((permission) => ({ permission, scope: { kind: "organization" } })) } as unknown as AgentContext["subject"],
  } as AgentContext;
}

const names = (c: AgentContext) => ISPY_TOOLS.filter((t) => t.available(c)).map((t) => t.name);

describe("ISpy agent tools", () => {
  it("have unique names and are read-only except the console send", () => {
    const all = ISPY_TOOLS.map((t) => t.name);
    expect(new Set(all).size).toBe(all.length);
    expect(ISPY_TOOLS.filter((t) => !t.readOnly).map((t) => t.name)).toEqual(["ispy_send_to_analyzer"]);
  });

  it("are hidden from organizations without ISpy", () => {
    expect(names(ctx({ scope: "organization", modules: ["knowledge"] }))).toEqual([]);
  });

  it("platform agents get the queue tools; only admin agents may send", () => {
    const readOnly = names(ctx({ scope: "platform" }));
    expect(readOnly).toContain("ispy_unsorted");
    expect(readOnly).toContain("ispy_list_candidates");
    expect(readOnly).not.toContain("ispy_send_to_analyzer");
    expect(names(ctx({ scope: "platform", admin: true }))).toContain("ispy_send_to_analyzer");
  });
});
