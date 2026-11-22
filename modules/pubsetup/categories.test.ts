import { describe, expect, it } from "vitest";
import { categoryName, groupByCategory, moveCategory, planCategorySeed, seedOrder, sortByCategory } from "./categories";

const cats = [
  { id: "c-trading", name: "Trading services", sortOrder: 20 },
  { id: "c-free", name: "Free newsletters", sortOrder: 10 },
  { id: "c-empty", name: "Empty", sortOrder: 5 },
];

describe("publication categories", () => {
  it("tidies names and rejects empty or long ones", () => {
    expect(categoryName("  Free   newsletters ")).toBe("Free newsletters");
    expect(categoryName("")).toBeNull();
    expect(categoryName("x".repeat(61))).toBeNull();
    expect(categoryName(3)).toBeNull();
  });

  it("groups by category order, then the publication's order, then name, uncategorized last", () => {
    const pubs = [
      { name: "Zeta", sortOrder: 0, categoryId: "c-trading" },
      { name: "Alpha", sortOrder: 2, categoryId: "c-trading" },
      { name: "Beta", sortOrder: 2, categoryId: "c-trading" },
      { name: "Daily", sortOrder: 0, categoryId: "c-free" },
      { name: "Loose", sortOrder: 0, categoryId: null },
      { name: "Gone", sortOrder: 0, categoryId: "deleted-id" },
    ];
    const groups = groupByCategory(pubs, cats, "Other");
    expect(groups.map((g) => g.label)).toEqual(["Free newsletters", "Trading services", "Other"]);
    expect(groups[1]!.items.map((p) => p.name)).toEqual(["Zeta", "Alpha", "Beta"]);
    expect(groups[2]!.items.map((p) => p.name)).toEqual(["Gone", "Loose"]);
    expect(groups.some((g) => g.label === "Empty")).toBe(false);
    expect(sortByCategory(pubs, cats).map((p) => p.name)).toEqual(["Daily", "Zeta", "Alpha", "Beta", "Gone", "Loose"]);
  });

  it("breaks a category order tie by name", () => {
    const tie = [
      { id: "b", name: "Bravo", sortOrder: 0 },
      { id: "a", name: "alpha", sortOrder: 0 },
    ];
    const groups = groupByCategory([{ name: "x", categoryId: "a" }, { name: "y", categoryId: "b" }], tie);
    expect(groups.map((g) => g.label)).toEqual(["alpha", "Bravo"]);
  });

  it("seeds one category per Type a brand uses, in the old Type order, and is idempotent", () => {
    const pubs = [
      { id: "p1", pubType: "Paid newsletter", categoryId: null },
      { id: "p2", pubType: "Free newsletter", categoryId: null },
      { id: "p3", pubType: "free newsletter ", categoryId: null },
      { id: "p4", pubType: null, categoryId: null },
      { id: "p5", pubType: "Something new", categoryId: null },
    ];
    const first = planCategorySeed(pubs, []);
    expect(first.create).toEqual([
      { name: "Paid newsletter", sortOrder: seedOrder("Paid newsletter") },
      { name: "Free newsletter", sortOrder: 10 },
      { name: "Something new", sortOrder: 1000 },
    ]);
    expect(first.assign).toEqual([
      { publicationId: "p1", categoryName: "Paid newsletter" },
      { publicationId: "p2", categoryName: "Free newsletter" },
      { publicationId: "p3", categoryName: "Free newsletter" },
      { publicationId: "p5", categoryName: "Something new" },
    ]);
    // Second run: categories exist and every publication has one.
    const existing = first.create.map((c, i) => ({ id: `c${i}`, ...c }));
    const assigned = pubs.map((p) => ({ ...p, categoryId: p.pubType ? existing.find((c) => c.name.toLowerCase() === p.pubType!.trim().toLowerCase())!.id : null }));
    expect(planCategorySeed(assigned, existing)).toEqual({ create: [], assign: [] });
  });

  it("does not recreate a category an admin renamed in a different case, and never reassigns", () => {
    const plan = planCategorySeed([{ id: "p1", pubType: "Free newsletter", categoryId: "c-free" }], [{ id: "x", name: "FREE NEWSLETTER", sortOrder: 1 }]);
    expect(plan).toEqual({ create: [], assign: [] });
  });

  it("moves a category up or down and renumbers", () => {
    expect(moveCategory(cats, "c-trading", "up")).toEqual([
      { id: "c-empty", sortOrder: 10 },
      { id: "c-trading", sortOrder: 20 },
      { id: "c-free", sortOrder: 30 },
    ]);
    expect(moveCategory(cats, "c-empty", "up").map((c) => c.id)).toEqual(["c-empty", "c-free", "c-trading"]);
  });
});
