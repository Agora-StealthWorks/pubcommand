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
};

export type AiStructuredResult<T> =
  | { status: "ok"; data: T; usage: AiUsage }
  | { status: "unavailable"; reason: string }
  | { status: "failed"; reason: string; usage?: AiUsage };

export function aiConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

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
  const model = request.model ?? DEFAULT_MODEL;
  try {
    const stream = anthropic().beta.messages.stream({
      model,
      max_tokens: request.maxTokens ?? 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
      output_config: {
        effort: request.effort ?? "high",
        format: { type: "json_schema", schema: request.schema },
      },
      messages: [{ role: "user", content: toContent(request.input) }],
    });
    const message = await stream.finalMessage();
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
    try {
      return { status: "ok", data: JSON.parse(text) as T, usage };
    } catch {
      return { status: "failed", reason: "The AI answer was not valid JSON.", usage };
    }
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
