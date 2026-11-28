import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The pass an AI agent's page requests carry (header x-pc-agent). Only the MCP server's page
 * bridge makes it, after authenticating the agent's token; it is signed with AUTH_SECRET and
 * lives two minutes. readSession() turns it into the agent's user, so pages and server actions
 * run as the agent with its own permissions, exactly as they run for a person.
 */

export const AGENT_HEADER = "x-pc-agent";
const TTL_MS = 120_000;

export type AgentPass = {
  /** Agent user id. */
  u: string;
  /** Organization id the pass is for (the organization the agent works in). */
  o: string;
  /** Organization the agent and its token belong to (the console workspace for platform agents). */
  h: string;
  /** Agent id and token id (re-checked on use). */
  a: string;
  t: string;
  /** Brand to work in. */
  b: string | null;
  /** Platform agent with admin changes: acts with full access in that organization. */
  s: boolean;
  /** Expiry (ms) and nonce. */
  e: number;
  n: string;
};

function secret(): string {
  const value = process.env.AUTH_SECRET ?? "";
  if (value.length < 16) throw new Error("AUTH_SECRET must be at least 16 characters.");
  return value;
}

function sign(body: string): string {
  return createHmac("sha256", `agent-pass:${secret()}`).update(body).digest("base64url");
}

export function makeAgentPass(input: Omit<AgentPass, "e" | "n">, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...input, e: now + TTL_MS, n: randomBytes(8).toString("base64url") } satisfies AgentPass)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function readAgentPass(value: string | null | undefined, now = Date.now()): AgentPass | null {
  if (!value) return null;
  const [body, signature] = value.split(".");
  if (!body || !signature) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const pass = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AgentPass;
    if (typeof pass.e !== "number" || pass.e < now || pass.e > now + TTL_MS + 5_000) return null;
    if (![pass.u, pass.o, pass.h, pass.a, pass.t].every((v) => typeof v === "string" && v.length > 0)) return null;
    return pass;
  } catch {
    return null;
  }
}
