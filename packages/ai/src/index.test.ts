import { describe, expect, it } from "vitest";
import { AnthropicProvider } from "./index";

describe("AnthropicProvider", () => {
  it("does not call Anthropic in Phase 1", async () => {
    await expect(new AnthropicProvider().complete({ model: "claude", messages: [] })).resolves.toMatchObject({
      status: "unavailable",
      provider: "anthropic",
    });
    await expect(
      new AnthropicProvider("test-key").complete({
        model: "claude",
        messages: [{ role: "user", content: "hello" }],
      }),
    ).resolves.toMatchObject({ status: "stub", provider: "anthropic" });
  });
});
