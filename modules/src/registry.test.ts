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
      "funnels",
      "miniblog",
      "billing",
      "settings",
    ]);
    for (const id of PRODUCT_MODULE_IDS) {
      expect(moduleRegistry.getBySlug(id)?.planEntitlement).toBe(id);
    }
    expect(moduleRegistry.permissionModules()["promo.approve"]).toBe("promo-studio");
    expect(moduleRegistry.permissionModules()["forms.export"]).toBe("forms");
    expect(moduleRegistry.permissionModules()["funnels.publish"]).toBe("funnels");
    expect(moduleRegistry.permissionModules()["miniblog.publish"]).toBe("miniblog");
    expect(moduleRegistry.getById("miniblog")?.nav[0]?.href).toBe("/mini-blog");
    expect(moduleRegistry.jobs().some((job) => job.name === "example.ping")).toBe(true);
  });
});
