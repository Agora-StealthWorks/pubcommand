/**
 * ElevenLabs Conversational AI (Agents) adapter, built against the public API reference:
 *
 *   POST   /v1/convai/knowledge-base/text           { name, text } → { id }
 *   PATCH  /v1/convai/knowledge-base/{id}           { name, content }
 *   DELETE /v1/convai/knowledge-base/{id}?force=true  (also detaches it from agents)
 *   GET    /v1/convai/knowledge-base/{id}/content   → the document text
 *   GET    /v1/convai/knowledge-base?page_size=&cursor= → { documents, has_more, next_cursor }
 *   POST   /v1/convai/tools                         { tool_config } → { id }
 *   PATCH  /v1/convai/tools/{id}                    { tool_config }
 *   DELETE /v1/convai/tools/{id}
 *   POST   /v1/convai/secrets                       { type: "new", name, value } → { secret_id }
 *   GET / PATCH /v1/convai/agents/{id}              conversation_config.agent.{ prompt, first_message }
 *
 * The agent PATCH sends the whole current prompt object back with only prompt, knowledge_base
 * and tool_ids replaced, so the LLM choice and anything set by hand is preserved.
 * fetch is injected: tests run against fixtures, and the app passes the global fetch.
 */
import type { ToolDef } from "./tools";

export const ELEVENLABS_BASE = "https://api.elevenlabs.io";

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export type ElevenClient = { apiKey: string; baseUrl?: string; fetch: Fetch; timeoutMs?: number };

export class ElevenLabsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(client: ElevenClient, method: string, path: string, body?: unknown, raw = false): Promise<T> {
  const response = await client.fetch(`${client.baseUrl ?? ELEVENLABS_BASE}${path}`, {
    method,
    headers: { "xi-api-key": client.apiKey, "content-type": "application/json", accept: raw ? "text/plain, */*" : "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(client.timeoutMs ?? 30_000),
  });
  const text = await response.text();
  if (!response.ok) throw new ElevenLabsError(`ElevenLabs ${method} ${path.split("?")[0]} returned ${response.status}: ${text.slice(0, 200)}`, response.status);
  if (raw) return text as T;
  return (text ? JSON.parse(text) : {}) as T;
}

const enc = encodeURIComponent;

export async function createDocument(client: ElevenClient, name: string, text: string): Promise<string> {
  const out = await call<{ id: string }>(client, "POST", "/v1/convai/knowledge-base/text", { name, text });
  if (!out.id) throw new ElevenLabsError("ElevenLabs did not return a document id.", 502);
  return out.id;
}

export async function updateDocument(client: ElevenClient, id: string, name: string, text: string): Promise<void> {
  await call(client, "PATCH", `/v1/convai/knowledge-base/${enc(id)}`, { name, content: text });
}

export async function deleteDocument(client: ElevenClient, id: string): Promise<void> {
  try {
    await call(client, "DELETE", `/v1/convai/knowledge-base/${enc(id)}?force=true`);
  } catch (error) {
    if (!(error instanceof ElevenLabsError && error.status === 404)) throw error;
  }
}

export async function getDocumentText(client: ElevenClient, id: string): Promise<string> {
  const text = await call<string>(client, "GET", `/v1/convai/knowledge-base/${enc(id)}/content`, undefined, true);
  // Some responses wrap the text as JSON; accept either.
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as { content?: string; text?: string };
      return parsed.content ?? parsed.text ?? text;
    } catch {
      return text;
    }
  }
  return text;
}

export async function listDocuments(client: ElevenClient): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 50; page++) {
    const query: string = `page_size=100${cursor ? `&cursor=${enc(cursor)}` : ""}`;
    const result: { documents?: { id: string; name: string }[]; has_more?: boolean; next_cursor?: string | null } = await call(client, "GET", `/v1/convai/knowledge-base?${query}`);
    for (const d of result.documents ?? []) out.push({ id: d.id, name: d.name });
    if (!result.has_more || !result.next_cursor) break;
    cursor = result.next_cursor;
  }
  return out;
}

export async function createSecret(client: ElevenClient, name: string, value: string): Promise<string> {
  const out = await call<{ secret_id?: string; id?: string }>(client, "POST", "/v1/convai/secrets", { type: "new", name, value });
  const id = out.secret_id ?? out.id;
  if (!id) throw new ElevenLabsError("ElevenLabs did not return a secret id.", 502);
  return id;
}

/** A tool definition as an ElevenLabs webhook tool calling our API with the agent's key (a workspace secret). */
export function webhookToolConfig(tool: ToolDef, input: { apiBase: string; secretId: string | null }) {
  const properties = Object.fromEntries(tool.params.map((p) => [p.name, { type: p.type, description: p.description }]));
  return {
    type: "webhook",
    name: tool.name,
    description: tool.description,
    response_timeout_secs: 20,
    api_schema: {
      url: `${input.apiBase.replace(/\/$/, "")}/api/v1/support${tool.path}`,
      method: "GET",
      ...(tool.params.length ? { query_params_schema: { properties, required: tool.params.filter((p) => p.required).map((p) => p.name) } } : {}),
      ...(input.secretId ? { request_headers: { Authorization: { secret_id: input.secretId } } } : {}),
    },
  };
}

export async function createTool(client: ElevenClient, config: ReturnType<typeof webhookToolConfig>): Promise<string> {
  const out = await call<{ id: string }>(client, "POST", "/v1/convai/tools", { tool_config: config });
  if (!out.id) throw new ElevenLabsError("ElevenLabs did not return a tool id.", 502);
  return out.id;
}

export async function updateTool(client: ElevenClient, id: string, config: ReturnType<typeof webhookToolConfig>): Promise<void> {
  await call(client, "PATCH", `/v1/convai/tools/${enc(id)}`, { tool_config: config });
}

export async function deleteTool(client: ElevenClient, id: string): Promise<void> {
  try {
    await call(client, "DELETE", `/v1/convai/tools/${enc(id)}`);
  } catch (error) {
    if (!(error instanceof ElevenLabsError && error.status === 404)) throw error;
  }
}

type AgentShape = { conversation_config?: { agent?: { prompt?: Record<string, unknown> & { prompt?: string; knowledge_base?: { id: string }[]; tool_ids?: string[] }; first_message?: string } } };

export async function getAgent(client: ElevenClient, agentId: string): Promise<{ prompt: string; firstMessage: string; docIds: string[]; toolIds: string[]; raw: AgentShape }> {
  const raw = await call<AgentShape>(client, "GET", `/v1/convai/agents/${enc(agentId)}`);
  const agent = raw.conversation_config?.agent;
  return {
    prompt: agent?.prompt?.prompt ?? "",
    firstMessage: agent?.first_message ?? "",
    docIds: (agent?.prompt?.knowledge_base ?? []).map((d) => d.id),
    toolIds: agent?.prompt?.tool_ids ?? [],
    raw,
  };
}

/** Set the prompt, opening line, documents and our tools. Tools we do not own stay attached. */
export async function configureAgent(
  client: ElevenClient,
  agentId: string,
  input: { prompt: string; firstMessage?: string; docs: { id: string; name: string }[]; ownToolIds: string[]; previousOwnToolIds: string[] },
): Promise<void> {
  const current = await getAgent(client, agentId);
  const currentPrompt = current.raw.conversation_config?.agent?.prompt ?? {};
  const previous = new Set(input.previousOwnToolIds);
  const foreignTools = current.toolIds.filter((id) => !previous.has(id) && !input.ownToolIds.includes(id));
  const prompt = {
    ...currentPrompt,
    prompt: input.prompt,
    knowledge_base: input.docs.map((d) => ({ type: "text", id: d.id, name: d.name, usage_mode: "auto" })),
    tool_ids: [...foreignTools, ...input.ownToolIds],
  };
  await call(client, "PATCH", `/v1/convai/agents/${enc(agentId)}`, {
    conversation_config: { agent: { prompt, ...(input.firstMessage ? { first_message: input.firstMessage } : {}) } },
  });
}
