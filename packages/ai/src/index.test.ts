import { describe, expect, it } from "vitest";
import { aiConfigured, runStructured } from "./index";

describe("runStructured", () => {
  it("reports unavailable without an API key instead of calling the network", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(aiConfigured()).toBe(false);
      await expect(
        runStructured({ system: "s", input: [{ type: "text", text: "hi" }], schema: { type: "object" } }),
      ).resolves.toMatchObject({ status: "unavailable" });
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});
