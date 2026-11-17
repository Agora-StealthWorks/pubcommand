import type { AccessSubject } from "@pubcommand/core";
import { describe, expect, it } from "vitest";
import { canReadKnowledge, canShareKnowledge, canUseMainBrain, canWriteKnowledge } from "./access";
import { anyWordsQuery, askPrompt, normalizeAskAnswer, parseStoredAnswer, promptExcerpt } from "./ask";
import { buildFolderTree, folderAncestors, normalizeFolder } from "./folders";
import { manifest } from "./manifest";
import {
  MAIN_SCOPE,
  brandScope,
  canEditNoteInScope,
  canSeeNote,
  originLabel,
  resolveScope,
  scopeWhere,
  sourceLabel,
} from "./visibility";

function subject(grants: string[], overrides: Partial<AccessSubject> = {}): AccessSubject {
  return {
    userId: "user-a",
    organizationId: "org-a",
    roleId: "role",
    membershipBrandId: null,
    membershipWorkspaceId: null,
    grants: grants.map((permission) => ({ permission, effect: "allow", brandId: null, workspaceId: null, roleId: "role" })),
    exclusions: [],
    entitledModuleIds: ["knowledge"],
    permissionModules: { "knowledge.read": "knowledge", "knowledge.write": "knowledge", "knowledge.share": "knowledge" },
    ...overrides,
  };
}

describe("manifest and permissions", () => {
  it("keeps the module contract and adds knowledge.share", () => {
    expect(manifest.id).toBe("knowledge");
    expect(manifest.slug).toBe("knowledge");
    expect(manifest.planEntitlement).toBe("knowledge");
    expect(manifest.nav.map((item) => item.href)).toEqual(["/knowledge"]);
    expect(manifest.permissions.map((item) => item.key)).toEqual(["knowledge.read", "knowledge.write", "knowledge.share"]);
  });

  it("needs write and share to share", () => {
    const scope = { organizationId: "org-a" };
    expect(canReadKnowledge(subject(["knowledge.read"]), scope)).toBe(true);
    expect(canWriteKnowledge(subject(["knowledge.read"]), scope)).toBe(false);
    expect(canShareKnowledge(subject(["knowledge.share"]), scope)).toBe(false);
    expect(canShareKnowledge(subject(["knowledge.write"]), scope)).toBe(false);
    expect(canShareKnowledge(subject(["knowledge.write", "knowledge.share"]), scope)).toBe(true);
  });

  it("keeps brand-bound members out of the main Brain", () => {
    expect(canUseMainBrain(subject([]))).toBe(true);
    expect(canUseMainBrain(subject([], { membershipBrandId: "b1" }))).toBe(false);
    expect(canUseMainBrain(subject([], { membershipWorkspaceId: "w1" }))).toBe(false);
  });
});

describe("visibility rule", () => {
  const a = brandScope("brand-a");
  const notes = {
    aPrivate: { brandId: "brand-a", visibility: "PRIVATE" as const },
    bPrivate: { brandId: "brand-b", visibility: "PRIVATE" as const },
    bShared: { brandId: "brand-b", visibility: "SHARED" as const },
    mainPrivate: { brandId: null, visibility: "PRIVATE" as const },
    mainShared: { brandId: null, visibility: "SHARED" as const },
  };

  it("lets a brand see its own notes and Shared notes only", () => {
    expect(canSeeNote(a, notes.aPrivate)).toBe(true);
    expect(canSeeNote(a, notes.bShared)).toBe(true);
    expect(canSeeNote(a, notes.mainShared)).toBe(true);
    expect(canSeeNote(a, notes.bPrivate)).toBe(false);
    expect(canSeeNote(a, notes.mainPrivate)).toBe(false);
  });

  it("lets the main Brain see everything, but never deleted notes", () => {
    for (const note of Object.values(notes)) expect(canSeeNote(MAIN_SCOPE, note)).toBe(true);
    expect(canSeeNote(MAIN_SCOPE, { ...notes.aPrivate, deletedAt: new Date() })).toBe(false);
    expect(canSeeNote(a, { ...notes.aPrivate, deletedAt: new Date() })).toBe(false);
  });

  it("builds the matching Prisma where", () => {
    expect(scopeWhere(MAIN_SCOPE)).toEqual({ deletedAt: null });
    expect(scopeWhere(a)).toEqual({ deletedAt: null, OR: [{ brandId: "brand-a" }, { visibility: "SHARED" }] });
  });

  it("edits only inside the note's own Brain", () => {
    expect(canEditNoteInScope(a, notes.aPrivate)).toBe(true);
    expect(canEditNoteInScope(a, notes.bShared)).toBe(false);
    expect(canEditNoteInScope(a, notes.mainShared)).toBe(false);
    expect(canEditNoteInScope(MAIN_SCOPE, notes.bPrivate)).toBe(true);
  });

  it("resolves the requested scope safely", () => {
    expect(resolveScope({ requested: "main", brandId: "brand-a", mainAllowed: true })).toEqual(MAIN_SCOPE);
    expect(resolveScope({ requested: "main", brandId: "brand-a", mainAllowed: false })).toEqual(a);
    expect(resolveScope({ requested: undefined, brandId: "brand-a", mainAllowed: true })).toEqual(a);
    expect(resolveScope({ requested: undefined, brandId: null, mainAllowed: true })).toEqual(MAIN_SCOPE);
    expect(resolveScope({ requested: "main", brandId: null, mainAllowed: false })).toBeNull();
  });

  it("labels origin and source", () => {
    const names = new Map([["brand-b", "Brand B"]]);
    expect(originLabel(notes.bShared, names)).toBe("Brand B");
    expect(originLabel(notes.mainShared, names)).toBe("Main Brain");
    expect(sourceLabel("promo-analyzer")).toBe("Promo Analyzer");
    expect(sourceLabel("member")).toBe("Written by a member");
  });
});

describe("folders", () => {
  it("normalizes and nests folders with counts", () => {
    expect(normalizeFolder(" Resources // Experts/ ")).toBe("Resources/Experts");
    expect(normalizeFolder("../x")).toBe("x");
    expect(normalizeFolder("")).toBeNull();
    const tree = buildFolderTree([
      { folder: "Resources/Experts", count: 3 },
      { folder: "Resources", count: 1 },
      { folder: "Areas/MTA", count: 2 },
      { folder: null, count: 4 },
    ]);
    expect(tree.map((node) => node.name)).toEqual(["Areas", "Resources"]);
    expect(tree[1]).toMatchObject({ path: "Resources", count: 1, total: 4 });
    expect(tree[1]?.children[0]).toMatchObject({ path: "Resources/Experts", count: 3, total: 3 });
    expect(folderAncestors("Resources/Experts")).toEqual(["Resources", "Resources/Experts"]);
  });
});

describe("Ask the Brain", () => {
  const sources = [
    { id: "n1", title: "Headlines", folder: "Copy", origin: "Main Brain", body: "---\ntags: [x]\n---\nUse the 4 U's." },
    { id: "n2", title: "Offers", folder: null, origin: "Brand A", body: "Lead with the guarantee." },
  ];

  it("builds an OR query from the meaningful words", () => {
    expect(anyWordsQuery("What is the best headline formula?")).toBe("best or headline or formula");
    expect(anyWordsQuery("the and of")).toBe("");
  });

  it("puts brand context and numbered notes into the prompt", () => {
    const prompt = askPrompt({ question: "How do I write a headline?", scopeLabel: "Brand A", brandContext: "Reader: busy parents", sources });
    expect(prompt).toContain('number="1" title="Headlines"');
    expect(prompt).toContain("Reader: busy parents");
    expect(prompt).not.toContain("tags: [x]");
    expect(promptExcerpt("x".repeat(20), 5)).toContain("[…note continues]");
  });

  it("keeps only citations to notes that were sent", () => {
    const answer = normalizeAskAnswer(
      {
        answer: "Use the 4 U's [1]. Lead with the guarantee [2]. Invented [7].",
        answered: true,
        citations: [
          { source: 1, why: "Headline rule" },
          { source: 1, why: "dup" },
          { source: 9, why: "made up" },
        ],
      },
      sources,
    );
    expect(answer.citations).toEqual([{ noteId: "n1", title: "Headlines", why: "Headline rule" }]);
    expect(answer.answer).toBe("Use the 4 U's [1]. Lead with the guarantee [2]. Invented .");
    expect(answer.consideredIds).toEqual(["n1", "n2"]);
    expect(normalizeAskAnswer({ answer: "No idea", answered: true, citations: [] }, sources).answered).toBe(false);
    expect(parseStoredAnswer(answer)).toEqual(answer);
    expect(parseStoredAnswer({ nope: true })).toBeNull();
  });
});
