import { describe, expect, it } from "vitest";
import { defaultPlanChoice, formatPlanLimit, planKeyFromName, validatePlanDraft } from "./plans";

describe("plan drafts", () => {
  it("prefers Internal and treats the high sentinel as unlimited", () => {
    expect(formatPlanLimit(1_000_000)).toBe("Unlimited");
    expect(formatPlanLimit(25)).toBe("25");
    expect(
      defaultPlanChoice([
        { id: "starter", key: "starter" },
        { id: "internal", key: "internal" },
      ])?.id,
    ).toBe("internal");
    expect(defaultPlanChoice([{ id: "starter", key: "starter" }])?.id).toBe("starter");
    expect(defaultPlanChoice([])).toBeNull();
  });

  it("builds a plan from the form and keeps an existing key", () => {
    const created = validatePlanDraft({
      name: "Newsroom Plus",
      seatLimit: "10",
      brandLimit: "",
      workspaceLimit: "4",
      monthlyPrice: "19.50",
      seatUnlimited: false,
      brandUnlimited: true,
      workspaceUnlimited: false,
      moduleIds: ["knowledge", "knowledge"],
    });
    expect(created).toEqual({
      ok: true,
      name: "Newsroom Plus",
      key: "newsroom-plus",
      seatLimit: 10,
      brandLimit: 1_000_000,
      workspaceLimit: 4,
      monthlyPriceCents: 1950,
      moduleIds: ["knowledge"],
    });
    const edited = validatePlanDraft(
      {
        name: "Newsroom Plus renamed",
        seatLimit: "0",
        brandLimit: "2",
        workspaceLimit: "4",
        monthlyPrice: "",
        seatUnlimited: false,
        brandUnlimited: false,
        workspaceUnlimited: false,
        moduleIds: [],
      },
      { key: "newsroom-plus" },
    );
    expect(edited).toMatchObject({ ok: false, message: "Enter a seat limit of at least 1." });
    expect(planKeyFromName("!!!")).toBeNull();
  });
});
