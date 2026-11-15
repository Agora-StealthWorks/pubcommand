export type AiRole = "system" | "user" | "assistant";

export type AiMessage = {
  role: AiRole;
  content: string;
};

export type AiCompletionRequest = {
  model: string;
  messages: readonly AiMessage[];
  maxTokens?: number;
};

export type AiCompletionResult =
  | { status: "unavailable"; provider: "anthropic"; reason: string }
  | { status: "stub"; provider: "anthropic"; reason: string };

export interface AiProvider {
  readonly id: "anthropic";
  complete(request: AiCompletionRequest): Promise<AiCompletionResult>;
}

/**
 * Anthropic-shaped provider. Phase 1 never calls the network, with or without an API key.
 */
export class AnthropicProvider implements AiProvider {
  readonly id = "anthropic" as const;

  constructor(private readonly apiKey?: string) {}

  async complete(_request: AiCompletionRequest): Promise<AiCompletionResult> {
    if (!this.apiKey) {
      return {
        status: "unavailable",
        provider: "anthropic",
        reason: "ANTHROPIC_API_KEY is not set. Phase 1 does not call Anthropic.",
      };
    }
    return {
      status: "stub",
      provider: "anthropic",
      reason: "Anthropic calls are not implemented in Phase 1.",
    };
  }
}

export function createAnthropicProvider(env: NodeJS.ProcessEnv = process.env): AnthropicProvider {
  return new AnthropicProvider(env.ANTHROPIC_API_KEY);
}
