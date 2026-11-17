import { runText, type AiTextResult } from "../../packages/ai/src/index";

export type WritingCompleter = (request: { system: string; prompt: string }) => Promise<AiTextResult>;

export type WritingAssistResult = AiTextResult | { status: "todo"; reason: string };

const SYSTEM = "You help an editor draft an email or newsletter issue for the brand described in the request. Follow the brand's reader and compliance rules. Never invent numbers, statistics, results, quotes or claims; leave a [bracketed placeholder] where a fact is needed.";

export async function writingAssist(
  input: { organizationId: string; issueTitle: string; prompt: string },
  complete: WritingCompleter = runText,
): Promise<WritingAssistResult> {
  if (!input.organizationId) throw new Error("organizationId is required");
  const prompt = input.prompt.trim();
  if (!prompt) return { status: "todo", reason: "Add a prompt before asking for a draft." };
  return complete({ system: SYSTEM, prompt: `Issue: ${input.issueTitle}\n\n${prompt}` });
}
