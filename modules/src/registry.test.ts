import { describe, expect, it } from "vitest";
import { PRODUCT_MODULE_IDS, moduleRegistry } from "./index";

describe("module registry", () => {
  it("loads the example stub, the product modules, and settings", () => {
    const ids = moduleRegistry.all().map((manifest) => manifest.id);
    expect(ids).toEqual([
      "example",
      "knowledge",
      "editorial",
      "performance",
      "promo-studio",
      "research",
      "intel",
      "forms",
      "charts",
      "billing",
      "settings",
    ]);
    for (const id of PRODUCT_MODULE_IDS) {
      expect(moduleRegistry.getBySlug(id)?.planEntitlement).toBe(id);
    }
    expect(moduleRegistry.permissionModules()["promo.approve"]).toBe("promo-studio");
    expect(moduleRegistry.permissionModules()["forms.export"]).toBe("forms");
    expect(moduleRegistry.jobs().some((job) => job.name === "example.ping")).toBe(true);
  });
});
