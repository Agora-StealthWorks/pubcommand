/**
 * Gaps: questions the agent could not answer. They arrive from a post-call webhook (the
 * transcript is read for agent turns that admit not knowing, and for tool calls that found
 * nothing) or are pasted by a person. Similar questions collapse into one gap with a count;
 * the Gaps queue turns them into records.
 */

export type GapCandidate = { question: string; reason: string };

export type Transcript = { role: string; message: string | null; toolResults: string[] }[];

const NOT_KNOWN =
  /\b(i (do not|don't) have (that|this|any|the) (information|info|details?)|i('m| am) not sure|i (could not|couldn't|can't|cannot) find|i('m| am) unable to (find|answer)|i (do not|don't) know|not something i (can|have)|no information (on|about)|let me connect you|i('ll| will) (connect|transfer) you)\b/i;

const NOTHING_FOUND = /"(found|answered)"\s*:\s*false|"results"\s*:\s*\[\s*\]/;

export function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(hi|hello|hey|please|thanks|thank you|um|uh|so|ok|okay)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/** A question worth keeping: some words, not a greeting or a yes/no reply. */
function meaningful(text: string): boolean {
  const n = normalizeQuestion(text);
  return n.split(" ").filter((w) => w.length > 2).length >= 3;
}

/** Read an ElevenLabs post-call webhook body into a transcript. Unknown shapes give []. */
export function readPostCall(payload: unknown): { agentId: string | null; conversationId: string | null; transcript: Transcript } {
  const root = (payload ?? {}) as Record<string, unknown>;
  const data = ((root.data ?? root) as Record<string, unknown>) ?? {};
  const turns = Array.isArray(data.transcript) ? data.transcript : [];
  const transcript: Transcript = turns.map((turn) => {
    const t = (turn ?? {}) as Record<string, unknown>;
    const results = Array.isArray(t.tool_results) ? t.tool_results : [];
    return {
      role: typeof t.role === "string" ? t.role : "",
      message: typeof t.message === "string" ? t.message : null,
      toolResults: results.map((r) => {
        const v = (r ?? {}) as Record<string, unknown>;
        return typeof v.result_value === "string" ? v.result_value : JSON.stringify(v.result_value ?? v);
      }),
    };
  });
  return {
    agentId: typeof data.agent_id === "string" ? data.agent_id : null,
    conversationId: typeof data.conversation_id === "string" ? data.conversation_id : null,
    transcript,
  };
}

/** The customer questions the agent did not answer in one conversation. */
export function findGaps(transcript: Transcript): GapCandidate[] {
  const out: GapCandidate[] = [];
  let lastQuestion: string | null = null;
  let lookedUpNothing = false;
  for (const turn of transcript) {
    if (turn.role === "user") {
      if (turn.message && meaningful(turn.message)) {
        lastQuestion = turn.message.trim().slice(0, 500);
        lookedUpNothing = false;
      }
      continue;
    }
    if (turn.toolResults.some((r) => NOTHING_FOUND.test(r))) lookedUpNothing = true;
    if (!lastQuestion) continue;
    if (turn.message && NOT_KNOWN.test(turn.message)) {
      out.push({ question: lastQuestion, reason: lookedUpNothing ? "Nothing found, and the agent said it did not know." : "The agent said it did not know." });
      lastQuestion = null;
    } else if (turn.message && lookedUpNothing) {
      out.push({ question: lastQuestion, reason: "A lookup found nothing." });
      lastQuestion = null;
    }
  }
  return dedupe(out);
}

/** Pasted questions: one per line (or a transcript with "Customer:" / "User:" lines). */
export function parsePasted(text: string): GapCandidate[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const speaker = /^(customer|user|caller|member|visitor)\s*:\s*/i;
  const tagged = lines.some((line) => speaker.test(line));
  const picked = tagged ? lines.filter((line) => speaker.test(line)).map((line) => line.replace(speaker, "")) : lines.map((line) => line.replace(/^[-*•\d.)\s]+/, ""));
  return dedupe(picked.filter(meaningful).map((question) => ({ question: question.slice(0, 500), reason: "Added by hand." })));
}

export function dedupe(gaps: GapCandidate[]): GapCandidate[] {
  const seen = new Set<string>();
  return gaps.filter((gap) => {
    const key = normalizeQuestion(gap.question);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
