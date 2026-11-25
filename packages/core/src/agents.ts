/**
 * AI Agents: Claude, Grok, OpenAI (and other) agents that work in one organization as members.
 * An agent has its own user row with an address on a reserved domain that can never receive
 * mail (RFC 2606 ".invalid"), no password, and no interactive sign-in. Pure helpers only.
 */

/** Every agent user's email ends with this. Nobody can sign in, reset a password or be invited with it. */
export const AGENT_EMAIL_DOMAIN = "agents.pubcommand.invalid";

export function isAgentEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.trim().toLowerCase().endsWith(`@${AGENT_EMAIL_DOMAIN}`);
}

/** The agent user's email: unique, never deliverable. */
export function agentEmail(agentKey: string): string {
  return `agent-${agentKey.toLowerCase().replace(/[^a-z0-9-]/g, "")}@${AGENT_EMAIL_DOMAIN}`;
}

export const AGENT_PLATFORMS = [
  { id: "claude", label: "Claude", vendor: "Anthropic" },
  { id: "grok", label: "Grok", vendor: "xAI" },
  { id: "openai", label: "OpenAI", vendor: "OpenAI (ChatGPT, agents)" },
  { id: "other", label: "Other", vendor: "Any MCP client" },
] as const;

export type AgentPlatform = (typeof AGENT_PLATFORMS)[number]["id"];

export function isAgentPlatform(value: unknown): value is AgentPlatform {
  return typeof value === "string" && AGENT_PLATFORMS.some((platform) => platform.id === value);
}

export function agentPlatformLabel(value: string): string {
  return AGENT_PLATFORMS.find((platform) => platform.id === value)?.label ?? "Other";
}

/** Best guess of the platform from an OAuth connector's client_name ("Claude", "ChatGPT", "Grok", …). */
export function platformFromClientName(name: string | null | undefined): AgentPlatform {
  const value = (name ?? "").toLowerCase();
  if (/claude|anthropic/.test(value)) return "claude";
  if (/grok|\bxai\b|x\.ai/.test(value)) return "grok";
  if (/chatgpt|openai|\bgpt\b|codex/.test(value)) return "openai";
  return "other";
}

/** A default display name for a new agent: "Stephen's Claude". */
export function defaultAgentName(ownerName: string | null | undefined, ownerEmail: string, platform: AgentPlatform): string {
  const who = (ownerName ?? "").trim() || ownerEmail.split("@")[0] || "Team";
  const first = who.split(/\s+/)[0] ?? who;
  const label = platform === "other" ? "Agent" : agentPlatformLabel(platform);
  return `${first}'s ${label}`.slice(0, 80);
}

/**
 * What an agent's "publish" becomes. With the organization's "Allow publishing by AI agents"
 * on, an agent that has publish rights publishes like a person. Off, the post waits in
 * AI Agents → Approvals as "pending" until someone with publish rights approves it.
 */
export function agentPublishOutcome(input: { allowPublishing: boolean; canPublish: boolean }): "publish" | "pending" {
  return input.allowPublishing && input.canPublish ? "publish" : "pending";
}
