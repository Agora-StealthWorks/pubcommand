import { readFileSync } from "node:fs";
import { builtInRolePermissions, classifyPermissions } from "@pubcommand/core";
import { describe, expect, it } from "vitest";
import { moduleRegistry } from "./index";

/**
 * Pins how every real permission is classified for the built-in User/Editor roles
 * and per-member app access. A new permission must land in one of these lists.
 */
const READ = [
  "billing.read", "charts.read", "editorial.read", "example.view", "forms.read", "funnels.read", "intel.read", "knowledge.read", "miniblog.read",
  "performance.read", "promo.read", "research.read", "support.read", "testimonials.read", "websites.read", "wiki.read",
];
const ADMIN = [
  "domains.manage", "miniblog.manage", "pubsetup.manage", "settings.audit.read", "settings.manage", "settings.modules.manage", "settings.roles.manage", "settings.users.manage", "websites.settings",
];

describe("permission classification of the real manifests", () => {
  const classified = classifyPermissions(moduleRegistry.all());
  const by = (access: string) => classified.filter((row) => row.access === access).map((row) => row.key).sort();

  it("read, admin and write lists", () => {
    expect(by("read")).toEqual(READ);
    expect(by("admin")).toEqual(ADMIN);
    expect(by("write")).toEqual(classified.map((row) => row.key).filter((key) => !READ.includes(key) && !ADMIN.includes(key)).sort());
    // Stephen 2026-11-20: anyone with ChartBuilder can make charts, so charts.read is read.
    // Publishing is not admin: site settings and Mini-Blog going live moved to *.settings / *.manage.
    expect(by("write")).toEqual(expect.arrayContaining(["websites.publish", "miniblog.publish"]));
  });

  const EDITOR_EXTRA = ["miniblog.publish", "miniblog.write", "websites.publish", "websites.write"];

  it("User is read-only and Editor adds website and Mini-Blog writing and publishing", () => {
    expect(builtInRolePermissions("user", moduleRegistry.all())).toEqual(READ);
    expect(builtInRolePermissions("editor", moduleRegistry.all())).toEqual([...READ, ...EDITOR_EXTRA].sort());
  });

  it("the backfill migration grants the same read list to existing organizations", () => {
    const sql = readFileSync(new URL("../../packages/db/prisma/schema/migrations/20261120170000_admin_access_and_deletes/migration.sql", import.meta.url), "utf8");
    const list = sql.match(/read_perms text\[\] := ARRAY\[([\s\S]*?)\];/)?.[1] ?? "";
    // charts.read was added to existing User/Editor roles by the later migration below.
    expect([...list.matchAll(/'([^']+)'/g)].map((m) => m[1]).concat("charts.read").sort()).toEqual(READ);
  });

  it("the follow-up migration gives existing built-in roles the same additions", () => {
    const sql = readFileSync(new URL("../../packages/db/prisma/schema/migrations/20261121090000_editor_publishing_and_charts/migration.sql", import.meta.url), "utf8");
    expect(sql).toContain("'charts.read'");
    const editorList = sql.match(/unnest\(ARRAY\[([^\]]*)\]\)/)?.[1] ?? "";
    // websites.write was already on Editor from the first migration.
    expect([...editorList.matchAll(/'([^']+)'/g)].map((m) => m[1]).concat("websites.write").sort()).toEqual(EDITOR_EXTRA);
  });
});
