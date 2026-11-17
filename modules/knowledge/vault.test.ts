import { describe, expect, it } from "vitest";
import {
  exportDecision,
  importDecision,
  isPersonalNote,
  noteTags,
  normalizeVaultPath,
  parseFrontmatter,
  planVaultImport,
  vaultRootPrefix,
  type ExistingNote,
} from "./vault";
import { fixZipName, readVaultZip, writeVaultZip } from "./zip";

const secretLine = `token = ${"Ab12Cd34"}${"Ef56Gh78Ij90"}`;

describe("vault paths and front matter", () => {
  it("cleans paths and refuses escapes", () => {
    expect(normalizeVaultPath("./Resources//Experts/A.md")).toBe("Resources/Experts/A.md");
    expect(normalizeVaultPath("../etc/passwd")).toBeNull();
    expect(normalizeVaultPath("Folder/")).toBeNull();
  });

  it("strips the vault's own top folder only when it holds .obsidian", () => {
    expect(vaultRootPrefix(["brain/.obsidian/app.json", "brain/A.md", "__MACOSX/brain/._A.md"])).toBe("brain/");
    expect(vaultRootPrefix(["Resources/A.md", "Resources/B.md"])).toBe("");
  });

  it("reads tags from front matter and inline", () => {
    const text = "---\ntitle: X\ntags:\n  - Promo\n  - personal/health\n---\nBody #idea and `#notatag`";
    expect(parseFrontmatter(text).data.title).toBe("X");
    expect(noteTags(text).sort()).toEqual(["idea", "personal/health", "promo"]);
    expect(isPersonalNote(text)).toBe(true);
    expect(isPersonalNote("---\ntags: [promo, private]\n---\nx")).toBe(true);
    expect(isPersonalNote("---\ntags: [promo]\n---\nprivately held companies")).toBe(false);
  });
});

describe("import and export decisions", () => {
  it("imports Markdown with title and folder from the path", () => {
    const decision = importDecision("Resources/Experts/Jeff Brown.md", "# Jeff\r\nNotes");
    expect(decision).toEqual({
      ok: true,
      note: { path: "Resources/Experts/Jeff Brown.md", sourceRef: "vault:Resources/Experts/Jeff Brown.md", title: "Jeff Brown", folder: "Resources/Experts", body: "# Jeff\nNotes" },
    });
  });

  it("skips non-markdown, hidden, empty and secret files", () => {
    expect(importDecision("attachments/logo.png", null)).toMatchObject({ ok: false, reason: "not-markdown" });
    expect(importDecision(".obsidian/workspace.md", "x")).toMatchObject({ ok: false, reason: "hidden" });
    expect(importDecision("A.md", "  \n")).toMatchObject({ ok: false, reason: "empty" });
    expect(importDecision("A.md", null)).toMatchObject({ ok: false, reason: "not-text" });
    const secret = importDecision("Ops/Keys.md", `Railway\n${secretLine}`);
    expect(secret).toMatchObject({ ok: false, reason: "secret" });
    if (!secret.ok) expect(secret.detail).not.toContain("Ab12Cd34");
  });

  it("applies the MTA export rules", () => {
    const text = "Plain note";
    expect(exportDecision("Inbox/2026-07-18.md", text)).toMatchObject({ ok: false, reason: "excluded-folder" });
    expect(exportDecision("AI/sessions/2026-06-18-06-hourly.md", text)).toMatchObject({ ok: false, reason: "excluded-folder" });
    expect(exportDecision("AI/brain-log.md", text)).toMatchObject({ ok: true });
    expect(exportDecision("archive/Daily Notes/x.md", text)).toMatchObject({ ok: false, reason: "excluded-folder" });
    expect(exportDecision("Areas/Personal/Health.md", text)).toMatchObject({ ok: false, reason: "excluded-folder" });
    expect(exportDecision("Areas/Work/Plan.md", text)).toMatchObject({ ok: false, reason: "excluded-folder" });
    expect(exportDecision("Areas/Workflows/Plan.md", text)).toMatchObject({ ok: true });
    expect(exportDecision("CLAUDE.md", text)).toMatchObject({ ok: false, reason: "agent-instructions" });
    expect(exportDecision("Areas/MTA/Notes.md", "---\ntags: [private]\n---\nx")).toMatchObject({ ok: false, reason: "personal" });
    expect(exportDecision("Areas/MTA/Keys.md", secretLine)).toMatchObject({ ok: false, reason: "secret" });
    expect(exportDecision("Projects/TPS Project/data/prices.csv", null)).toMatchObject({ ok: false, reason: "not-markdown" });
    expect(exportDecision("Resources/Experts/Jeff Brown.md", text)).toMatchObject({ ok: true });
  });
});

describe("import plan", () => {
  const decisions = [
    importDecision("A.md", "alpha"),
    importDecision("Folder/B.md", "beta"),
    importDecision("Folder/C.md", "gamma"),
    importDecision("D.md", "delta"),
    importDecision("E.md", "epsilon"),
    importDecision("img.png", null),
    importDecision("Keys.md", secretLine),
  ];

  it("creates, updates, leaves unchanged and never moves notes between Brains", () => {
    const existing = new Map<string, ExistingNote>([
      ["vault:Folder/B.md", { id: "b", brandId: "mta", title: "B", body: "old beta", folder: "Folder", deletedAt: null }],
      ["vault:Folder/C.md", { id: "c", brandId: "mta", title: "C", body: "gamma", folder: "Folder", deletedAt: null }],
      ["vault:D.md", { id: "d", brandId: "other", title: "D", body: "delta", folder: null, deletedAt: null }],
      ["vault:E.md", { id: "e", brandId: "mta", title: "E", body: "x", folder: null, deletedAt: new Date() }],
    ]);
    const { rows, report } = planVaultImport(decisions, existing, "mta");
    expect(rows.map((row) => [row.note.path, row.action])).toEqual([
      ["A.md", "create"],
      ["Folder/B.md", "update"],
      ["Folder/C.md", "unchanged"],
      ["D.md", "conflict"],
      ["E.md", "deleted"],
    ]);
    expect(report).toMatchObject({ files: 7, notes: 4, create: 1, update: 1, unchanged: 1, conflict: 1, deleted: 1 });
    expect(report.skipped).toEqual({ "not-markdown": 1, secret: 1 });
    expect(report.conflictFiles).toEqual(["D.md"]);
    expect(report.folders).toEqual([
      { folder: "(top level)", notes: 2 },
      { folder: "Folder", notes: 2 },
    ]);
  });

  it("is idempotent: re-planning after an import changes nothing", () => {
    const first = planVaultImport(decisions, new Map(), null);
    const after = new Map<string, ExistingNote>(
      first.rows.map((row) => [row.note.sourceRef, { id: row.note.path, brandId: null, title: row.note.title, body: row.note.body, folder: row.note.folder, deletedAt: null }]),
    );
    const second = planVaultImport(decisions, after, null);
    expect(second.report).toMatchObject({ create: 0, update: 0, unchanged: 5 });
  });
});

describe("vault zips", () => {
  it("round-trips Markdown, lists other files without inflating them, and filters", () => {
    const zip = writeVaultZip([
      { path: "vault/.obsidian/app.md", text: "settings" },
      { path: "vault/Resources/Experts/Jeff Brown.md", text: "# Jeff\nSee [[Promo Notes]]" },
      { path: "vault/Inbox/today.md", text: "todo" },
      { path: "vault/attachments/logo.png", text: "\u0089PNG" },
      { path: "vault/Areas/Keys.md", text: secretLine },
    ]);
    const read = readVaultZip(zip);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.rootPrefix).toBe("vault/");
    expect(read.files.map((file) => file.path).sort()).toEqual([
      ".obsidian/app.md",
      "Areas/Keys.md",
      "Inbox/today.md",
      "Resources/Experts/Jeff Brown.md",
      "attachments/logo.png",
    ]);
    expect(read.files.find((file) => file.path.endsWith(".png"))?.text).toBeNull();
    const imported = read.files.map((file) => importDecision(file.path, file.text)).filter((d) => d.ok);
    expect(imported.map((d) => (d.ok ? d.note.path : ""))).toEqual(expect.arrayContaining(["Inbox/today.md", "Resources/Experts/Jeff Brown.md"]));
    const exported = read.files.map((file) => exportDecision(file.path, file.text)).filter((d) => d.ok);
    expect(exported.map((d) => (d.ok ? d.note.path : ""))).toEqual(["Resources/Experts/Jeff Brown.md"]);
  });

  it("repairs UTF-8 names stored without the UTF-8 flag", () => {
    const latin1 = String.fromCharCode(...new TextEncoder().encode("Oxford Club — Partner.md"));
    expect(fixZipName(latin1)).toBe("Oxford Club — Partner.md");
    expect(fixZipName("Café.md")).toBe("Café.md");
    expect(fixZipName("plain.md")).toBe("plain.md");
  });

  it("rejects something that is not a zip", () => {
    expect(readVaultZip(new TextEncoder().encode("not a zip"))).toEqual({ ok: false, error: "That file is not a readable .zip." });
  });
});
