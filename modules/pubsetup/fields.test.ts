import { describe, expect, it } from "vitest";
describe("hex colors", () => {
  it("accepts a typed hex code with or without # and the short form", async () => {
    const { normalizeHex } = await import("./fields");
    expect(normalizeHex("#7C3AED")).toBe("#7c3aed");
    expect(normalizeHex("7c3aed")).toBe("#7c3aed");
    expect(normalizeHex("#73e")).toBe("#7733ee");
    expect(normalizeHex("purple")).toBeNull();
  });
});
