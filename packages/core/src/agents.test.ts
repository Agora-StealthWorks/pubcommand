import { describe, expect, it } from "vitest";
import { agentEmail, agentPublishOutcome, defaultAgentName, isAgentEmail, isAgentPlatform, platformFromClientName } from "./agents";

describe("agent emails", () => {
  it("are on the reserved domain and recognised case-insensitively", () => {
    const email = agentEmail("3F2A-91");
    expect(email).toBe("agent-3f2a-91@agents.pubcommand.invalid");
    expect(isAgentEmail(email)).toBe(true);
    expect(isAgentEmail(" Agent-x@AGENTS.PUBCOMMAND.INVALID ")).toBe(true);
  });

  it("do not match people or look-alike domains", () => {
    expect(isAgentEmail("stephen@example.com")).toBe(false);
    expect(isAgentEmail("x@notagents.pubcommand.invalid")).toBe(false);
    expect(isAgentEmail("x@agents.pubcommand.invalid.example.com")).toBe(false);
    expect(isAgentEmail(null)).toBe(false);
  });
});

describe("platformFromClientName", () => {
  it("recognises the connectors", () => {
    expect(platformFromClientName("Claude")).toBe("claude");
    expect(platformFromClientName("claude.ai")).toBe("claude");
    expect(platformFromClientName("ChatGPT")).toBe("openai");
    expect(platformFromClientName("OpenAI Agents")).toBe("openai");
    expect(platformFromClientName("Grok")).toBe("grok");
    expect(platformFromClientName("xAI")).toBe("grok");
    expect(platformFromClientName("Cursor")).toBe("other");
    expect(platformFromClientName(undefined)).toBe("other");
  });

  it("validates platform ids", () => {
    expect(isAgentPlatform("claude")).toBe(true);
    expect(isAgentPlatform("dots")).toBe(false);
  });
});

describe("defaultAgentName", () => {
  it("uses the owner's first name, else the email's local part", () => {
    expect(defaultAgentName("Stephen Smith", "s@example.com", "claude")).toBe("Stephen's Claude");
    expect(defaultAgentName(null, "jane@example.com", "grok")).toBe("jane's Grok");
    expect(defaultAgentName("", "jane@example.com", "other")).toBe("jane's Agent");
  });
});

describe("agentPublishOutcome", () => {
  it("publishes only when the org allows it and the agent has publish rights", () => {
    expect(agentPublishOutcome({ allowPublishing: true, canPublish: true })).toBe("publish");
    expect(agentPublishOutcome({ allowPublishing: false, canPublish: true })).toBe("pending");
    expect(agentPublishOutcome({ allowPublishing: true, canPublish: false })).toBe("pending");
  });
});
