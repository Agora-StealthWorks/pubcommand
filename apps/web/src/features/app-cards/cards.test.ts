import type { AccessSubject } from "@pubcommand/core";
import { moduleRegistry } from "@pubcommand/modules";
import { describe, expect, it } from "vitest";
import { appCardImage, cardableApps, cardOnDashboard, dashboardCards, sortByCardPosition, visibleApps, type AppCardSettings } from "@/lib/apps";

const scope = { organizationId: "00000000-0000-4000-8000-000000000001", brandId: null };

/** Someone allowed every app permission, in an organization whose plan includes the given apps. */
function subject(entitled: string[]): AccessSubject {
  const permissions = moduleRegistry.all().flatMap((manifest) => manifest.permissions.map((permission) => ({ key: permission.key, moduleId: manifest.id })));
  return {
    userId: "u",
    organizationId: scope.organizationId,
    roleId: "role",
    membershipBrandId: null,
    membershipWorkspaceId: null,
    entitledModuleIds: entitled,
    grants: permissions.map((permission) => ({ permission: permission.key, effect: "allow" as const, brandId: null, workspaceId: null, roleId: "role" })),
    exclusions: [],
    permissionModules: Object.fromEntries(permissions.map((permission) => [permission.key, permission.moduleId])),
  };
}

const setting = (value: Partial<AppCardSettings[string]>): AppCardSettings[string] => ({ name: null, onDashboard: null, position: null, imageVersion: null, ...value });

describe("app cards", () => {
  it("lists built-in apps first, then modules with pages and no card, never Settings", () => {
    const apps = cardableApps();
    expect(apps.find((app) => app.moduleId === "forms")?.builtIn).toBe(true);
    expect(apps.find((app) => app.moduleId === "billing")?.builtIn).toBe(false);
    expect(apps.some((app) => ["settings", "example", "pubsetup"].includes(app.moduleId))).toBe(false);
    expect(apps.findIndex((app) => !app.builtIn)).toBeGreaterThan(apps.filter((app) => app.builtIn).length - 1);
  });

  it("shows built-in apps by default and new apps only once staff turn them on", () => {
    expect(cardOnDashboard("forms")).toBe(true);
    expect(cardOnDashboard("forms", setting({ onDashboard: false }))).toBe(false);
    expect(cardOnDashboard("billing")).toBe(false);
    expect(cardOnDashboard("billing", setting({ onDashboard: true }))).toBe(true);
  });

  it("uses an upload, then the bundled artwork, then the drawing", () => {
    expect(appCardImage("forms")).toBe("/brand/app-cards/forms.svg");
    expect(appCardImage("editorial")).toBe("/brand/app-cards/calendar.svg");
    expect(appCardImage("forms", setting({ imageVersion: 42 }))).toBe("/api/app-cards/forms?v=42");
    expect(appCardImage("charts")).toBeNull();
  });

  it("orders by staff position, then the built-in order", () => {
    const apps = [{ moduleId: "forms" }, { moduleId: "editorial" }, { moduleId: "wiki" }];
    expect(sortByCardPosition(apps).map((app) => app.moduleId)).toEqual(["editorial", "wiki", "forms"]);
    expect(sortByCardPosition(apps, { forms: setting({ position: 0 }) }).map((app) => app.moduleId)).toEqual(["forms", "editorial", "wiki"]);
  });

  it("only puts apps the organization has on its dashboard, with staff names and hidden cards left out", () => {
    const settings: AppCardSettings = {
      forms: setting({ name: "Surveys", position: 0 }),
      wiki: setting({ onDashboard: false }),
      billing: setting({ onDashboard: true }),
    };
    const apps = visibleApps(subject(["forms", "wiki", "editorial", "billing"]), scope, "general", settings);
    const cards = dashboardCards(apps, settings);
    expect(cards.map((card) => card.moduleId)).toEqual(["forms", "editorial", "billing"]);
    expect(cards[0]!.name).toBe("Surveys");
    // The hidden card stays in the sidebar; the added app joins it under "More apps".
    expect(apps.find((app) => app.moduleId === "wiki")).toBeDefined();
    expect(apps.find((app) => app.moduleId === "billing")?.category).toBe("More apps");
    // Not on the plan: no card, whatever staff chose.
    expect(dashboardCards(visibleApps(subject(["wiki"]), scope, "general", settings), settings).map((card) => card.moduleId)).toEqual([]);
  });
});
