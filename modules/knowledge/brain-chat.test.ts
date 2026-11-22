import { describe, expect, it } from "vitest";
import { BRAINCHAT_TOOLS, chatTitle, citedNoteIds, cleanFolder, clampLimit, formatSearchResults, parseSaveNote, uploadsBlock, UPLOAD_INLINE_MAX } from "./brain-chat";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("BrainChat tools", () => {
  it("are strict-ready schemas: every property required, no extras", () => {
    for (const tool of BRAINCHAT_TOOLS) {
      const schema = tool.inputSchema as unknown as { additionalProperties: boolean; required: string[]; properties: Record<string, unknown> };
      expect(schema.additionalProperties).toBe(false);
      expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort());
    }
  });
});

describe("parseSaveNote", () => {
  it("cleans a new note and defaults the folder", () => {
    expect(parseSaveNote({ title: "  Webinar   lessons ", body: "a\r\nb", folder: null, note_id: null })).toEqual({ title: "Webinar lessons", body: "a\nb", folder: "BrainChat", noteId: null });
  });
  it("accepts an update by id and a nested folder", () => {
    expect(parseSaveNote({ title: "T", body: "B", folder: "/Promo reviews// 2026 /", note_id: ID })).toEqual({ title: "T", body: "B", folder: "Promo reviews/2026", noteId: ID });
  });
  it("refuses empty or bad input with a message for the model", () => {
    expect(parseSaveNote({ title: "", body: "B", folder: null, note_id: null })).toEqual({ error: "The note needs a title." });
    expect(parseSaveNote({ title: "T", body: " ", folder: null, note_id: null })).toEqual({ error: "The note needs a body." });
    expect(parseSaveNote({ title: "T", body: "B", folder: null, note_id: "abc" })).toMatchObject({ error: expect.stringContaining("note_id") });
  });
});

describe("helpers", () => {
  it("clamps limits and folders", () => {
    expect(clampLimit(null)).toBe(10);
    expect(clampLimit(99)).toBe(25);
    expect(clampLimit(0)).toBe(1);
    expect(cleanFolder("  ", null)).toBeNull();
  });
  it("titles a chat from its first message or its uploads", () => {
    expect(chatTitle("  What   converts? ")).toBe("What converts?");
    expect(chatTitle("", ["a.pdf"])).toBe("Uploaded a.pdf");
    expect(chatTitle("x".repeat(100))).toHaveLength(78);
  });
  it("formats search results with ids, and says when nothing matched", () => {
    expect(formatSearchResults("q", [])).toContain("No Master Brain notes match");
    const text = formatSearchResults("q", [{ id: ID, title: "Note", folder: null, where: "MTA", snippet: "snip", updatedAt: new Date("2026-11-01T00:00:00Z") }]);
    expect(text).toContain(`Note (id ${ID}) — Top level · MTA · updated 2026-11-01`);
  });
  it("puts uploads in the turn, cut to the inline limit", () => {
    const block = uploadsBlock([{ name: "big.txt", noteId: ID, title: "big.txt", text: "x".repeat(UPLOAD_INLINE_MAX + 10), scanned: false }]);
    expect(block).toContain(`(/brain/${ID})`);
    expect(block).toContain("the rest is in the note");
    expect(uploadsBlock([{ name: "scan.pdf", noteId: ID, title: "scan.pdf", text: "", scanned: true }])).toContain("attached as a document");
  });
  it("finds cited note ids", () => {
    expect(citedNoteIds(`See [A](/brain/${ID}) and [A again](/brain/${ID.toUpperCase()}) and [x](/brain/nope)`)).toEqual([ID]);
  });
});
