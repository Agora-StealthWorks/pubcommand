import { describe, expect, it } from "vitest";
import { checkAttachment, attachmentHeaders, cleanFilename, findAttachment } from "./attachments";
import { buildGraph, layout } from "./graph";
import {
  entityMatchStrength,
  learnAction,
  learnedKey,
  parsePushedSourceRef,
  planPush,
  pushTargets,
  pushedSourceRef,
  shouldLearnUp,
} from "./main-brain";
import { BEST_PRACTICE_FOLDER, BEST_PRACTICE_SOURCE } from "./visibility";

const ORG = "11111111-1111-4111-8111-111111111111";
const NOTE = "22222222-2222-4222-8222-222222222222";
const BRAND_A = "33333333-3333-4333-8333-333333333333";
const BRAND_B = "44444444-4444-4444-8444-444444444444";

describe("learning up", () => {
  it("learns only what apps teach", () => {
    expect(shouldLearnUp({ source: "promo-analyzer", sourceRef: "promo:1", brandId: BRAND_A })).toBe(true);
    expect(shouldLearnUp({ source: "marketing-calendar", sourceRef: "calendar-issue:1", brandId: BRAND_A })).toBe(true);
    expect(shouldLearnUp({ source: "member", sourceRef: null, brandId: BRAND_A })).toBe(false);
    expect(shouldLearnUp({ source: "vault-import", sourceRef: "vault:x.md", brandId: BRAND_A })).toBe(false);
    expect(shouldLearnUp({ source: BEST_PRACTICE_SOURCE, sourceRef: pushedSourceRef(NOTE, BRAND_A), brandId: BRAND_A })).toBe(false);
  });

  it("keys learned notes per organization and source", () => {
    expect(learnedKey(ORG, "promo:9")).toBe(`learned:${ORG}:promo:9`);
  });

  it("refreshes app content but never overwrites a staff edit or revives a staff delete", () => {
    const input = { title: "T", body: "new", folder: "F", source: "promo-analyzer" };
    expect(learnAction(null, input)).toBe("create");
    expect(learnAction({ title: "T", body: "old", folder: "F", editedAt: null, deletedAt: null }, input)).toBe("refresh");
    expect(learnAction({ title: "T", body: "new", folder: "F", editedAt: null, deletedAt: null }, input)).toBe("touch");
    expect(learnAction({ title: "T", body: "old", folder: "F", editedAt: new Date(), deletedAt: null }, input)).toBe("touch");
    expect(learnAction({ title: "T", body: "old", folder: "F", editedAt: null, deletedAt: new Date() }, input)).toBe("skip");
  });
});

describe("push down", () => {
  const all = [
    { id: BRAND_A, organizationId: ORG },
    { id: BRAND_B, organizationId: ORG },
  ];

  it("targets every brand, the selected brands that still exist, or none", () => {
    expect(pushTargets("ALL", [], all)).toEqual(all);
    expect(pushTargets("SELECTED", [{ id: BRAND_B, organizationId: ORG }, { id: "gone", organizationId: ORG }], all)).toEqual([{ id: BRAND_B, organizationId: ORG }]);
    expect(pushTargets("NONE", all, all)).toEqual([]);
  });

  it("keeps finance and health notes inside their niche; general notes reach every brand", () => {
    const brands = [
      { id: "fin", organizationId: ORG, niche: "finance" },
      { id: "hea", organizationId: ORG, niche: "health" },
      { id: "gen", organizationId: ORG, niche: "general" },
    ];
    expect(pushTargets("ALL", [], brands, "finance").map((b) => b.id)).toEqual(["fin"]);
    expect(pushTargets("ALL", [], brands, "health").map((b) => b.id)).toEqual(["hea"]);
    expect(pushTargets("ALL", [], brands, "general").map((b) => b.id)).toEqual(["fin", "hea", "gen"]);
    // A health brand chosen by hand for a finance note is still left out.
    expect(pushTargets("SELECTED", [{ id: "hea", organizationId: ORG }, { id: "fin", organizationId: ORG }], brands, "finance").map((b) => b.id)).toEqual(["fin"]);
  });

  it("round-trips the copy's sourceRef", () => {
    expect(parsePushedSourceRef(pushedSourceRef(NOTE, BRAND_A))).toEqual({ mainNoteId: NOTE, brandId: BRAND_A });
    expect(parsePushedSourceRef("promo:1")).toBeNull();
  });

  it("creates, updates and removes copies to match the targets", () => {
    const note = { id: NOTE, title: "Headlines", body: "v2" };
    const copies = [
      { id: "c-a", brandId: BRAND_A, mainNoteId: NOTE, title: "Headlines", body: "v1", folder: BEST_PRACTICE_FOLDER, deletedAt: null },
      { id: "c-old", brandId: "old-brand", mainNoteId: NOTE, title: "Headlines", body: "v2", folder: BEST_PRACTICE_FOLDER, deletedAt: null },
      { id: "c-other", brandId: BRAND_B, mainNoteId: "another-note", title: "x", body: "x", folder: BEST_PRACTICE_FOLDER, deletedAt: null },
    ];
    const plan = planPush(note, all, copies);
    expect(plan.create).toEqual([{ id: BRAND_B, organizationId: ORG }]);
    expect(plan.update.map((row) => row.copyId)).toEqual(["c-a"]);
    expect(plan.remove).toEqual(["c-old"]);
    const unpushed = planPush(note, [], copies);
    expect(unpushed.remove.sort()).toEqual(["c-a", "c-old"]);
  });
});

describe("entity lookup", () => {
  it("ranks exact titles above prefixes above mentions", () => {
    expect(entityMatchStrength({ title: "Bryan Smith", body: "" }, "bryan smith")).toBe(3);
    expect(entityMatchStrength({ title: "Bryan Smith — Facts", body: "" }, "Bryan Smith")).toBe(2);
    expect(entityMatchStrength({ title: "Lessons", body: "As Bryan  Smith says" }, "Bryan Smith")).toBe(1);
    expect(entityMatchStrength({ title: "Lessons", body: "Bryan Smithers" }, "Bryan Smith")).toBe(0);
    expect(entityMatchStrength({ title: "x", body: "y" }, " ")).toBe(0);
  });
});

describe("attachments", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0]);
  it("takes the type from the extension and checks image bytes", () => {
    expect(checkAttachment("chart.png", 100, png)).toEqual({ ok: true, filename: "chart.png", contentType: "image/png", inline: true });
    expect(checkAttachment("fake.png", 100, new Uint8Array([1, 2, 3, 4]))).toMatchObject({ ok: false });
    expect(checkAttachment("logo.svg", 100, new Uint8Array())).toMatchObject({ ok: true, inline: false });
    expect(checkAttachment("run.exe", 100, new Uint8Array())).toMatchObject({ ok: false });
    expect(checkAttachment("big.pdf", 11 * 1024 * 1024, new Uint8Array())).toMatchObject({ ok: false });
  });

  it("cleans names and serves non-images as downloads in a sandbox", () => {
    expect(cleanFilename('../../evil"<x>.png')).toBe("evilx.png");
    const headers = attachmentHeaders({ filename: "a.svg", contentType: "image/svg+xml", size: 3 });
    expect(headers["Content-Disposition"]).toMatch(/^attachment/);
    expect(headers["Content-Security-Policy"]).toContain("sandbox");
    expect(attachmentHeaders({ filename: "a.png", contentType: "image/png", size: 3 })["Content-Disposition"]).toMatch(/^inline/);
  });

  it("finds an embed by file name", () => {
    const files = [{ filename: "Chart 1.png" }];
    expect(findAttachment(files, "assets/chart 1.png|300")).toEqual(files[0]);
    expect(findAttachment(files, "other.png")).toBeNull();
  });
});

describe("graph", () => {
  const note = (id: string, title: string, body: string, folder: string | null = "A") => ({ id, title, body, folder, brandId: null, visibility: "PRIVATE" as const });

  it("turns resolved wiki links into unique edges and drops orphans", () => {
    const graph = buildGraph(
      [note("1", "One", "See [[Two]] and [[Two|again]] and [[Missing]]"), note("2", "Two", "Back to [[One]]", "B"), note("3", "Lonely", "no links")],
      { preferBrandId: null },
    );
    expect(graph.edges).toEqual([{ source: "1", target: "2" }]);
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(["1", "2"]);
    expect(graph.groups).toEqual(["A", "B"]);
    expect(graph.totalNotes).toBe(3);
  });

  it("is deterministic and stays inside the box", () => {
    const ids = ["a", "b", "c", "d"];
    const edges = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ];
    const first = layout(ids, edges, 400, 300);
    expect(layout(ids, edges, 400, 300)).toEqual(first);
    for (const point of first.values()) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(400);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(300);
    }
  });

  it("caps the node count", () => {
    const notes = Array.from({ length: 30 }, (_, i) => note(String(i), `N${i}`, `[[N${(i + 1) % 30}]]`));
    const graph = buildGraph(notes, { preferBrandId: null, limit: 10 });
    expect(graph.nodes).toHaveLength(10);
    expect(graph.truncated).toBe(true);
  });
});

describe("niche frontmatter", () => {
  it("reads the niche line and writes it into every note", async () => {
    const { frontmatterNiche, withNicheFrontmatter } = await import("./main-brain");
    expect(frontmatterNiche("---\nniche: Health\ntags: [a]\n---\nBody")).toBe("health");
    expect(frontmatterNiche("---\nniche: crypto\n---\nBody")).toBeNull();
    expect(frontmatterNiche("No frontmatter")).toBeNull();
    expect(withNicheFrontmatter("Body", "finance")).toBe("---\nniche: finance\n---\n\nBody");
    expect(withNicheFrontmatter("---\ntags: [a]\n---\nBody", "health")).toBe("---\nniche: health\ntags: [a]\n---\nBody");
    expect(withNicheFrontmatter("---\ntags: [a]\nniche: finance\n---\nBody", "general")).toBe("---\ntags: [a]\nniche: general\n---\nBody");
    const once = withNicheFrontmatter("# T\n\nText", "health");
    expect(withNicheFrontmatter(once, "health")).toBe(once);
    expect(frontmatterNiche(once)).toBe("health");
  });
});
