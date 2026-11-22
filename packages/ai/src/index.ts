import Anthropic from "@anthropic-ai/sdk";

/** The model every PubCommand feature uses unless a caller names another. */
export const DEFAULT_MODEL = "claude-opus-5-5";

export type AiEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** One piece of input: plain text, or a PDF the model reads directly (scanned promos). */
export type AiInput = { type: "text"; text: string } | { type: "pdf"; base64: string; title?: string };

export type AiUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
};

export type AiStructuredRequest = {
  /** Stable instructions. Cached, so keep anything per-request out of it. */
  system: string;
  input: readonly AiInput[];
  /** JSON Schema for the answer. Objects need additionalProperties: false and required. */
  schema: Record<string, unknown>;
  effort?: AiEffort;
  maxTokens?: number;
  model?: string;
  /** Let the model search the web (Anthropic's server-side web search). Facts it finds must be cited by the caller's prompt. */
  webSearch?: { maxUses?: number; allowedDomains?: string[] };
};

export type AiStructuredResult<T> =
  | { status: "ok"; data: T; usage: AiUsage }
  | { status: "unavailable"; reason: string }
  | { status: "failed"; reason: string; usage?: AiUsage };

export function aiConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

/**
 * Checks a value against the JSON Schema subset PubCommand uses (type, enum, required,
 * properties, additionalProperties: false, items, anyOf). Returns the first problem, or null.
 */
export function schemaProblem(value: unknown, schema: Record<string, unknown>, path = "answer"): string | null {
  if (Array.isArray(schema.anyOf)) {
    const ok = (schema.anyOf as Record<string, unknown>[]).some((option) => schemaProblem(value, option, path) === null);
    return ok ? null : `${path} does not match any allowed shape`;
  }
  const type = schema.type;
  if (type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return `${path} should be an object`;
    const record = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    for (const key of (schema.required ?? []) as string[]) if (!(key in record)) return `${path}.${key} is missing`;
    for (const [key, child] of Object.entries(record)) {
      const childSchema = properties[key];
      if (!childSchema) {
        if (schema.additionalProperties === false) return `${path}.${key} is not expected`;
        continue;
      }
      const problem = schemaProblem(child, childSchema, `${path}.${key}`);
      if (problem) return problem;
    }
    return null;
  }
  if (type === "array") {
    if (!Array.isArray(value)) return `${path} should be a list`;
    const items = schema.items as Record<string, unknown> | undefined;
    if (items) for (const [i, item] of value.entries()) {
      const problem = schemaProblem(item, items, `${path}[${i}]`);
      if (problem) return problem;
    }
    return null;
  }
  if (type === "string" && typeof value !== "string") return `${path} should be text`;
  if (type === "integer" && !(typeof value === "number" && Number.isInteger(value))) return `${path} should be a whole number`;
  if (type === "number" && typeof value !== "number") return `${path} should be a number`;
  if (type === "boolean" && typeof value !== "boolean") return `${path} should be true or false`;
  if (type === "null" && value !== null) return `${path} should be empty`;
  if (Array.isArray(schema.enum) && !(schema.enum as unknown[]).includes(value)) return `${path} has an unexpected value`;
  return null;
}

/** The JSON object in a reply that may wrap it in a code fence or a sentence. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fenced ? fenced[1]! : text).trim();
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(body.slice(start, end + 1));
    throw new Error("no JSON object");
  }
}

/** True when the API refused a schema as too large or complex for constrained decoding. */
function schemaTooLarge(error: unknown): boolean {
  return error instanceof Anthropic.BadRequestError && /grammar is too large|schema is too complex|too many (strict|schema)/i.test(error.message);
}

/** Schemas the API refused to compile, by their JSON text: skip straight to the fallback next time. */
const unconstrainedSchemas = new Set<string>();

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  client ??= new Anthropic();
  return client;
}

function toContent(input: readonly AiInput[]): Anthropic.Beta.BetaContentBlockParam[] {
  return input.map((part) =>
    part.type === "text"
      ? { type: "text" as const, text: part.text }
      : {
          type: "document" as const,
          source: { type: "base64" as const, media_type: "application/pdf" as const, data: part.base64 },
          ...(part.title ? { title: part.title } : {}),
        },
  );
}

/**
 * Ask Claude for a JSON answer that matches `schema`. Never throws: callers get
 * "unavailable" with no API key, and "failed" with a readable reason otherwise.
 */
export async function runStructured<T>(request: AiStructuredRequest): Promise<AiStructuredResult<T>> {
  if (!aiConfigured()) {
    return { status: "unavailable", reason: "The AI key is not set. Add ANTHROPIC_API_KEY in Railway." };
  }
  const key = JSON.stringify(request.schema);
  try {
    if (!unconstrainedSchemas.has(key)) {
      try {
        return await structuredCall<T>(request, true);
      } catch (error) {
        if (!schemaTooLarge(error)) throw error;
        // The API cannot compile this schema for constrained decoding. Ask for the same JSON in the
        // instructions instead and check the answer here.
        unconstrainedSchemas.add(key);
      }
    }
    return await structuredCall<T>(request, false);
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return { status: "failed", reason: "The AI key was rejected. Check ANTHROPIC_API_KEY in Railway." };
    }
    if (error instanceof Anthropic.RateLimitError) {
      return { status: "failed", reason: "The AI is busy (rate limited). Try again in a minute." };
    }
    if (error instanceof Anthropic.BadRequestError) {
      return { status: "failed", reason: `The AI rejected the request: ${error.message}` };
    }
    if (error instanceof Anthropic.APIError) {
      return { status: "failed", reason: `AI error ${error.status ?? ""}: ${error.message}`.trim() };
    }
    return { status: "failed", reason: error instanceof Error ? error.message : "Unknown AI error." };
  }
}

/** One structured request. `constrained` uses the API's JSON schema mode; otherwise the schema rides in the instructions. Throws API errors. */
async function structuredCall<T>(request: AiStructuredRequest, constrained: boolean): Promise<AiStructuredResult<T>> {
  const model = request.model ?? DEFAULT_MODEL;
  const tools: Anthropic.Beta.BetaToolUnion[] = request.webSearch
    ? [
        {
          type: "web_search_20260209",
          name: "web_search",
          max_uses: request.webSearch.maxUses ?? 5,
          ...(request.webSearch.allowedDomains?.length ? { allowed_domains: request.webSearch.allowedDomains } : {}),
        },
      ]
    : [];
  const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }];
  if (!constrained) {
    system.push({
      type: "text",
      text: `Reply with one JSON object and nothing else (no code fence, no commentary). It must match this JSON Schema exactly: every required key present, no extra keys, enum fields use one of the listed values.\n${JSON.stringify(request.schema)}`,
      cache_control: { type: "ephemeral" },
    });
  }
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: toContent(request.input) }];
  let message: Anthropic.Beta.BetaMessage | null = null;
  // Server tools can pause a long turn; continue it a few times.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const stream = anthropic().beta.messages.stream({
      model,
      max_tokens: request.maxTokens ?? 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      output_config: {
        effort: request.effort ?? "high",
        ...(constrained ? { format: { type: "json_schema" as const, schema: request.schema } } : {}),
      },
      ...(tools.length ? { tools } : {}),
      messages,
    });
    message = await stream.finalMessage();
    if (message.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: message.content });
  }
  if (!message) return { status: "failed", reason: "The AI returned nothing." };
  const usage: AiUsage = {
    model: message.model,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
  };
  if (message.stop_reason === "refusal") {
    return { status: "failed", reason: "The AI declined to analyze this document.", usage };
  }
  if (message.stop_reason === "max_tokens") {
    return { status: "failed", reason: "The analysis ran out of room before it finished. Try again.", usage };
  }
  const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  let data: unknown;
  try {
    data = constrained ? JSON.parse(text) : extractJson(text);
  } catch {
    return { status: "failed", reason: "The AI answer was not valid JSON.", usage };
  }
  if (!constrained) {
    const problem = schemaProblem(data, request.schema);
    if (problem) return { status: "failed", reason: `The AI answer was incomplete (${problem}). Try again.`, usage };
  }
  return { status: "ok", data: data as T, usage };
}

export type AiTextResult =
  | { status: "ok"; text: string; usage: AiUsage }
  | { status: "unavailable"; reason: string }
  | { status: "failed"; reason: string };

/** Ask Claude for plain prose (drafts, rewrites). Never throws. */
export async function runText(request: { system: string; prompt: string; effort?: AiEffort; maxTokens?: number; model?: string }): Promise<AiTextResult> {
  if (!aiConfigured()) {
    return { status: "unavailable", reason: "The AI key is not set. Add ANTHROPIC_API_KEY in Railway." };
  }
  try {
    const stream = anthropic().beta.messages.stream({
      model: request.model ?? DEFAULT_MODEL,
      max_tokens: request.maxTokens ?? 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
      output_config: { effort: request.effort ?? "medium" },
      messages: [{ role: "user", content: request.prompt }],
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") return { status: "failed", reason: "The AI declined this request." };
    const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("").trim();
    return {
      status: "ok",
      text,
      usage: {
        model: message.model,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      },
    };
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : "Unknown AI error." };
  }
}

export { streamText, type AiStreamRequest, type AiStreamResult } from "./stream";
export { runChat, historyMessages, type ChatTool, type ChatTurn, type ChatActivity, type ChatRequest, type ChatResult } from "./chat";
