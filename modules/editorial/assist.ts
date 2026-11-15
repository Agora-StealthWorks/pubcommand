import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createAnthropicProvider, type AiCompletionRequest, type AiCompletionResult } from "../../packages/ai/src/index";

export type WritingCompleter = (request: AiCompletionRequest) => Promise<AiCompletionResult>;

export type WritingAssistResult =
  | AiCompletionResult
  | { status: "todo"; provider: null; reason: string };

const MISSING_AI_TODO =
  "TODO: @pubcommand/ai is not available. The writing assist will call it when the package is installed.";

const require = createRequire(import.meta.url);

export async function writingAssist(
  input: { organizationId: string; issueTitle: string; prompt: string },
  load: () => Promise<WritingCompleter | null> = loadWritingCompleter,
): Promise<WritingAssistResult> {
  if (!input.organizationId) throw new Error("organizationId is required");
  const prompt = input.prompt.trim();
  if (!prompt) return { status: "todo", provider: null, reason: "TODO: add a prompt before asking for a draft." };
  try {
    const complete = await load();
    if (!complete) return { status: "todo", provider: null, reason: MISSING_AI_TODO };
    return await complete({
      model: "claude",
      messages: [
        {
          role: "system",
          content: "You help an editor draft a newsletter issue. Do not invent opens, clicks, or revenue.",
        },
        {
          role: "user",
          content: `Organization: ${input.organizationId}\nIssue: ${input.issueTitle}\n\n${prompt}`,
        },
      ],
    });
  } catch {
    return { status: "todo", provider: null, reason: MISSING_AI_TODO };
  }
}

async function loadWritingCompleter(): Promise<WritingCompleter | null> {
  return (await loadInstalledCompleter()) ?? loadWorkspaceCompleter();
}

async function loadInstalledCompleter(): Promise<WritingCompleter | null> {
  try {
    const resolved = require.resolve("@pubcommand/ai");
    const loaded: unknown = await import(pathToFileURL(resolved).href);
    if (!isAiModule(loaded)) return null;
    const provider = loaded.createAnthropicProvider();
    return (request) => provider.complete(request);
  } catch {
    return null;
  }
}

function loadWorkspaceCompleter(): WritingCompleter | null {
  try {
    const provider = createAnthropicProvider();
    return (request) => provider.complete(request);
  } catch {
    return null;
  }
}

function isAiModule(value: unknown): value is {
  createAnthropicProvider: (env?: NodeJS.ProcessEnv) => { complete: WritingCompleter };
} {
  if (typeof value !== "object" || value === null || !("createAnthropicProvider" in value)) return false;
  return typeof value.createAnthropicProvider === "function";
}
