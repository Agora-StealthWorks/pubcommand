import { readFileSync } from "node:fs";
import { builtInRolePermissions, classifyPermissions } from "@pubcommand/core";
import { describe, expect, it } from "vitest";
import { moduleRegistry } from "./index";

/**
 * Pins how every real permission is classified for the built-in User/Editor roles
 * and per-member app access. A new permission must land in one of these lists.
 */
const READ = [
  "billing.read", "editorial.read", "example.view", "forms.read", "funnels.read", "intel.read", "knowledge.read", "miniblog.read",
  "performance.read", "promo.read", "research.read", "support.read", "testimonials.read", "websites.read", "wiki.read",
];
const ADMIN = [
  "domains.manage", "pubsetup.manage", "settings.audit.read", "settings.manage", "settings.modules.manage", "settings.roles.manage", "settings.users.manage",
];

describe("permission classification of the real manifests", () => {
  const classified = classifyPermissions(moduleRegistry.all());
  const by = (access: string) => classified.filter((row) => row.access === access).map((row) => row.key).sort();

  it("read, admin and write lists", () => {
    expect(by("read")).toEqual(READ);
    expect(by("admin")).toEqual(ADMIN);
    expect(by("write")).toEqual(classified.map((row) => row.key).filter((key) => !READ.includes(key) && !ADMIN.includes(key)).sort());
    // charts.read lets people make and save charts, so it is flagged write in the manifest.
    expect(by("write")).toContain("charts.read");
  });

  it("User is read-only and Editor adds only websites.write", () => {
    expect(builtInRolePermissions("user", moduleRegistry.all())).toEqual(READ);
    expect(builtInRolePermissions("editor", moduleRegistry.all())).toEqual([...READ, "websites.write"].sort());
  });

  it("the backfill migration grants the same read list to existing organizations", () => {
    const sql = readFileSync(new URL("../../packages/db/prisma/schema/migrations/20261120170000_admin_access_and_deletes/migration.sql", import.meta.url), "utf8");
    const list = sql.match(/read_perms text\[\] := ARRAY\[([\s\S]*?)\];/)?.[1] ?? "";
    expect([...list.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()).toEqual(READ);
  });
});
