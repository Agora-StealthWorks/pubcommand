import type { AgentContext } from "./context";

/** Shared pieces of the MCP tools: the tool shape, its error, and argument readers. */

export class ToolError extends Error {}

type JsonSchema = Record<string, unknown>;
export type ToolResult = { data: unknown; targetType?: string; targetId?: string };
export type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  readOnly: boolean;
  /** Shown in tools/list only when this returns true. */
  available: (ctx: AgentContext) => boolean;
  run: (ctx: AgentContext, args: Record<string, unknown>) => Promise<ToolResult>;
};

// ── argument readers ────────────────────────────────────────────────────────

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function str(args: Record<string, unknown>, key: string, max = 300): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ToolError(`${key} must be a string.`);
  return value.slice(0, max);
}
export function uuid(args: Record<string, unknown>, key: string, required = true): string | undefined {
  const value = str(args, key, 40)?.trim();
  if (!value) {
    if (required) throw new ToolError(`${key} is required.`);
    return undefined;
  }
  if (!UUID.test(value)) throw new ToolError(`${key} must be an id from a list_ tool.`);
  return value.toLowerCase();
}
export function strings(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new ToolError(`${key} must be a list of strings.`);
  return (value as string[]).slice(0, 30).map((item) => item.slice(0, 60));
}
export function date(args: Record<string, unknown>, key: string): Date | undefined {
  const value = str(args, key, 40);
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new ToolError(`${key} must be an ISO 8601 date-time, e.g. 2026-12-01T14:00:00Z.`);
  return parsed;
}
export function limit(args: Record<string, unknown>, fallback = 20): number {
  const value = Number(args.limit ?? fallback);
  return Number.isFinite(value) ? Math.max(1, Math.min(100, Math.round(value))) : fallback;
}
export function oneOf<T extends string>(args: Record<string, unknown>, key: string, allowed: readonly T[], fallback?: T): T | undefined {
  const value = str(args, key, 40);
  if (value === undefined || value === "") return fallback;
  if (!(allowed as readonly string[]).includes(value)) throw new ToolError(`${key} must be one of: ${allowed.join(", ")}.`);
  return value as T;
}

