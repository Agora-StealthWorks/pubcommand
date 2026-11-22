import Anthropic from "@anthropic-ai/sdk";
import { schemaProblem, type AiEffort, type AiInput, type AiUsage } from "./index";

/**
 * A chat turn where Claude may call the caller's tools (search a knowledge base,
 * read a note, save a note) before it answers. The loop runs here; the caller
 * supplies the tools. Text streams out through `onText`. Never throws.
 */

export type ChatTool = {
  name: string;
  description: string;
  /** JSON Schema for the input: objects need additionalProperties: false and every property in required. */
  inputSchema: Record<string, unknown>;
  /** Runs the tool. Return text for the model; throw (or return { error }) for a failure it should see. */
  run: (input: Record<string, unknown>) => Promise<string | { error: string }>;
};

/** One earlier turn, as plain text (tool calls of earlier turns are not replayed). */
export type ChatTurn = { role: "user" | "assistant"; content: string };

export type ChatActivity = { tool: string; input: Record<string, unknown>; ok: boolean; result: string };

export type ChatRequest = {
  /** Stable instructions. Cached. */
  system: string;
  history: readonly ChatTurn[];
  /** The new user turn (text, plus PDFs read directly). */
  input: readonly AiInput[];
  tools: readonly ChatTool[];
  effort?: AiEffort;
  maxTokens?: number;
  /** Most model calls in one turn (each tool round is one). */
  maxSteps?: number;
  model?: string;
  /** The answer text so far. Calls never overlap; errors it throws are ignored. */
  onText?: (text: string) => void | Promise<void>;
  /** Called after each tool runs. */
  onActivity?: (activity: ChatActivity) => void | Promise<void>;
};

export type ChatResult =
  | { status: "ok"; text: string; usage: AiUsage; activity: ChatActivity[] }
  | { status: "unavailable"; reason: string }
  | { status: "failed"; reason: string; text: string; usage?: AiUsage; activity: ChatActivity[] };

const DEFAULT_CHAT_MODEL = "claude-opus-5-5";
/** Longest tool result handed back to the model, in characters. */
const TOOL_RESULT_MAX = 60_000;

function readable(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return "The AI key was rejected. Check ANTHROPIC_API_KEY in Railway.";
  if (error instanceof Anthropic.RateLimitError) return "The AI is busy (rate limited). Try again in a minute.";
  if (error instanceof Anthropic.BadRequestError) return `The AI rejected the request: ${error.message}`;
  if (error instanceof Anthropic.APIError) return `AI error ${error.status ?? ""}: ${error.message}`.replace(/\s+/g, " ").trim();
  return error instanceof Error ? error.message : "Unknown AI error.";
}

function userContent(input: readonly AiInput[]): Anthropic.Beta.BetaContentBlockParam[] {
  // Documents go before the text that talks about them.
  const docs = input.flatMap((part) =>
    part.type === "pdf"
      ? [{ type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: part.base64 }, ...(part.title ? { title: part.title } : {}) }]
      : [],
  );
  const texts = input.flatMap((part) => (part.type === "text" && part.text.trim() ? [{ type: "text" as const, text: part.text }] : []));
  return [...docs, ...(texts.length ? texts : [{ type: "text" as const, text: "(no message)" }])];
}

/** Earlier turns as alternating messages (merging same-role neighbours). */
export function historyMessages(history: readonly ChatTurn[]): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const turn of history) {
    const text = turn.content.trim();
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.role === turn.role && typeof last.content === "string") last.content = `${last.content}\n\n${text}`;
    else out.push({ role: turn.role, content: text });
  }
  // The conversation must start with the user.
  while (out[0] && out[0].role !== "user") out.shift();
  return out;
}

export async function runChat(request: ChatRequest): Promise<ChatResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { status: "unavailable", reason: "The AI key is not set. Add ANTHROPIC_API_KEY in Railway." };
  }
  const activity: ChatActivity[] = [];
  const usage: AiUsage = { model: request.model ?? DEFAULT_CHAT_MODEL, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
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
      // A progress handler must never break the turn.
    } finally {
      busy = false;
    }
  };
  const byName = new Map(request.tools.map((tool) => [tool.name, tool]));
  const tools: Anthropic.Beta.BetaToolUnion[] = request.tools.map((tool, index) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
    strict: true,
    // Large inputs (a whole note to save) stream as they are written; inputs are checked below.
    eager_input_streaming: true,
    // Cache the tool list with the system prompt.
    ...(index === request.tools.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
  }));
  const messages: Anthropic.Beta.BetaMessageParam[] = [...historyMessages(request.history), { role: "user", content: userContent(request.input) }];
  if (messages[0]?.role !== "user") messages.unshift({ role: "user", content: "(conversation start)" });
  try {
    for (let step = 0; step < (request.maxSteps ?? 12); step += 1) {
      const stream = new Anthropic().beta.messages.stream({
        model: request.model ?? DEFAULT_CHAT_MODEL,
        max_tokens: request.maxTokens ?? 32000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
        output_config: { effort: request.effort ?? "medium" },
        // Cache the conversation so far for the next tool round and the next turn.
        cache_control: { type: "ephemeral" },
        tools,
        messages,
      });
      const before = text;
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          text += event.delta.text;
          void report();
        }
      }
      const message = await stream.finalMessage();
      usage.model = message.model;
      usage.inputTokens += message.usage.input_tokens;
      usage.outputTokens += message.usage.output_tokens;
      usage.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;
      if (message.stop_reason === "refusal") return { status: "failed", reason: "The AI declined this request.", text, usage, activity };
      if (message.stop_reason === "max_tokens") return { status: "failed", reason: "The answer ran out of room. Ask for a shorter answer or split the question.", text, usage, activity };
      messages.push({ role: "assistant", content: message.content });
      if (message.stop_reason === "pause_turn") continue;
      const calls = message.content.filter((block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use");
      if (message.stop_reason !== "tool_use" || calls.length === 0) {
        await report();
        return { status: "ok", text: text.trim(), usage, activity };
      }
      // Keep a paragraph break between what was said before and after the tools.
      if (text !== before && !text.endsWith("\n\n")) text += "\n\n";
      const results = await Promise.all(
        calls.map(async (call): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
          const tool = byName.get(call.name);
          const input = (call.input && typeof call.input === "object" ? call.input : {}) as Record<string, unknown>;
          const problem = tool ? schemaProblem(input, tool.inputSchema, "input") : `There is no tool called ${call.name}.`;
          let ok = false;
          let output: string;
          if (problem) output = `INVALID_INPUT: ${problem}. Call the tool again with complete, valid input.`;
          else {
            try {
              const result = await tool!.run(input);
              if (typeof result === "string") {
                ok = true;
                output = result;
              } else output = result.error;
            } catch (error) {
              output = error instanceof Error ? error.message : "The tool failed.";
            }
          }
          const clipped = output.length > TOOL_RESULT_MAX ? `${output.slice(0, TOOL_RESULT_MAX)}\n…(cut at ${TOOL_RESULT_MAX} characters)` : output;
          const entry: ChatActivity = { tool: call.name, input, ok, result: clipped.slice(0, 400) };
          activity.push(entry);
          try {
            await request.onActivity?.(entry);
          } catch {
            // ignore
          }
          return { type: "tool_result", tool_use_id: call.id, content: clipped, ...(ok ? {} : { is_error: true }) };
        }),
      );
      messages.push({ role: "user", content: results });
    }
    return { status: "failed", reason: "The answer took too many steps. Ask a narrower question.", text, usage, activity };
  } catch (error) {
    return { status: "failed", reason: readable(error), text, usage, activity };
  }
}
