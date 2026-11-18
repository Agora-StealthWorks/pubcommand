import Anthropic from "@anthropic-ai/sdk";
import type { AiEffort, AiInput, AiUsage } from "./index";

export type AiStreamRequest = {
  /** Stable instructions. Cached, so keep anything per-request out of it. */
  system: string;
  /** Per-request instructions sent after the cached block (not cached). */
  context?: string;
  input: readonly AiInput[];
  effort?: AiEffort;
  maxTokens?: number;
  model?: string;
  /**
   * Called with the text so far as it streams. May be async; calls never overlap
   * (a slow handler is skipped for the deltas that arrive meanwhile and catches
   * up with the next one). Errors it throws are ignored.
   */
  onText?: (text: string) => void | Promise<void>;
};

export type AiStreamResult =
  | { status: "ok"; text: string; usage: AiUsage }
  /** The answer hit max_tokens. `text` is what was written before it stopped. */
  | { status: "truncated"; text: string; usage: AiUsage; reason: string }
  | { status: "unavailable"; reason: string }
  | { status: "failed"; reason: string; text: string; usage?: AiUsage };

const DEFAULT_STREAM_MODEL = "claude-opus-5-5";

function content(input: readonly AiInput[]): Anthropic.Beta.BetaContentBlockParam[] {
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

function readable(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return "The AI key was rejected. Check ANTHROPIC_API_KEY in Railway.";
  if (error instanceof Anthropic.RateLimitError) return "The AI is busy (rate limited). Try again in a minute.";
  if (error instanceof Anthropic.BadRequestError) return `The AI rejected the request: ${error.message}`;
  if (error instanceof Anthropic.APIError) return `AI error ${error.status ?? ""}: ${error.message}`.replace(/\s+/g, " ").trim();
  return error instanceof Error ? error.message : "Unknown AI error.";
}

/**
 * Stream a plain-text answer, reporting the text as it grows. Never throws:
 * "unavailable" without ANTHROPIC_API_KEY, "truncated" when the answer ran out
 * of room (with the partial text), "failed" on a refusal or an error.
 */
export async function streamText(request: AiStreamRequest): Promise<AiStreamResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { status: "unavailable", reason: "The AI key is not set. Add ANTHROPIC_API_KEY in Railway." };
  }
  let text = "";
  let busy = false;
  let pending = false;
  const report = async () => {
    if (!request.onText) return;
    if (busy) {
      pending = true;
      return;
    }
    busy = true;
    try {
      do {
        pending = false;
        await request.onText(text);
      } while (pending);
    } catch {
      // The caller's progress handler must never break the stream.
    } finally {
      busy = false;
    }
  };
  try {
    const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }];
    if (request.context?.trim()) system.push({ type: "text", text: request.context });
    const stream = new Anthropic().beta.messages.stream({
      model: request.model ?? DEFAULT_STREAM_MODEL,
      max_tokens: request.maxTokens ?? 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      output_config: { effort: request.effort ?? "high" },
      messages: [{ role: "user", content: content(request.input) }],
    });
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        text += event.delta.text;
        void report();
      }
    }
    const message = await stream.finalMessage();
    const usage: AiUsage = {
      model: message.model,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    };
    // The final text is the message's own text blocks (the same as the deltas).
    const final = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("") || text;
    if (message.stop_reason === "refusal") return { status: "failed", reason: "The AI declined to analyze this document.", text: final, usage };
    if (message.stop_reason === "max_tokens") {
      return { status: "truncated", reason: "The AI ran out of room before it finished.", text: final, usage };
    }
    return { status: "ok", text: final, usage };
  } catch (error) {
    return { status: "failed", reason: readable(error), text };
  }
}
