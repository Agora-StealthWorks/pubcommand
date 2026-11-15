import type { AccessSubject } from "@pubcommand/core";
import { beforeEach, describe, expect, it } from "vitest";
import { canReadKnowledge, canWriteKnowledge } from "./access";
import { manifest } from "./manifest";
import {
  KNOWLEDGE_SAVED_EVENT,
  createKnowledgePage,
  listKnowledgeEvents,
  listKnowledgePages,
  resetKnowledgeStore,
  searchKnowledge,
} from "./store";

function subject(grants: AccessSubject["grants"], overrides: Partial<AccessSubject> = {}): AccessSubject {
  return {
    userId: "user-a",
    organizationId: "org-a",
    roleId: "role-reader",
    membershipBrandId: null,
    membershipWorkspaceId: null,
    grants,
    exclusions: [],
    entitledModuleIds: ["knowledge"],
    permissionModules: {
      "knowledge.read": "knowledge",
      "knowledge.write": "knowledge",
    },
    ...overrides,
  };
}

const scope = { organizationId: "org-a" };
const allow = (permission: string): AccessSubject["grants"][number] => ({
  permission,
  effect: "allow",
  brandId: null,
  workspaceId: null,
  roleId: "role-reader",
});

describe("knowledge module", () => {
  beforeEach(() => {
    resetKnowledgeStore();
  });

  it("keeps the manifest contract", () => {
    expect(manifest.id).toBe("knowledge");
    expect(manifest.slug).toBe("knowledge");
    expect(manifest.planEntitlement).toBe("knowledge");
    expect(manifest.nav.map((item) => item.href)).toEqual(["/knowledge"]);
    expect(manifest.permissions.map((item) => item.key)).toEqual(["knowledge.read", "knowledge.write"]);
    expect(manifest.events.map((item) => item.name)).toContain(KNOWLEDGE_SAVED_EVENT);
  });

  it("lists EXAMPLE pages scoped to the organization", () => {
    const alpha = listKnowledgePages("org-a");
    const beta = listKnowledgePages("org-b");
    expect(alpha.length).toBeGreaterThan(0);
    expect(alpha.every((page) => page.organizationId === "org-a" && page.title.startsWith("EXAMPLE:"))).toBe(true);
    expect(beta.every((page) => page.organizationId === "org-b")).toBe(true);
    expect(alpha.map((page) => page.id).some((id) => beta.some((page) => page.id === id))).toBe(false);
  });

  it("creates a markdown page for one organization and records a saved event", () => {
    const created = createKnowledgePage({
      organizationId: "org-a",
      title: "Field notes",
      body: "A short markdown note about the sample desk.",
      actorId: "user-a",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.page.organizationId).toBe("org-a");
    expect(created.page.slug).toBe("field-notes");
    expect(created.page.source).toBe("member");
    const visible = listKnowledgePages("org-a").map((page) => page.slug);
    expect(visible).toContain("field-notes");
    expect(listKnowledgePages("org-b").map((page) => page.slug)).not.toContain("field-notes");
    const events = listKnowledgeEvents("org-a");
    expect(events).toHaveLength(1);
    expect(events[0]?.name).toBe(KNOWLEDGE_SAVED_EVENT);
    expect(events[0]?.actorId).toBe("user-a");
    expect(events[0]?.payload.pageId).toBe(created.page.id);
    expect(listKnowledgeEvents("org-b")).toHaveLength(0);
  });

  it("returns citation-shaped keyword hits and hides other organizations", () => {
    createKnowledgePage({
      organizationId: "org-a",
      title: "Harbor log",
      body: "The lighthouse lamp is checked at dusk.",
    });
    createKnowledgePage({
      organizationId: "org-b",
      title: "Other harbor",
      body: "The lighthouse lamp belongs to another organization.",
    });
    const hits = searchKnowledge("org-a", "lighthouse lamp");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      organizationId: "org-a",
      title: "Harbor log",
      slug: "harbor-log",
      href: "/knowledge?page=harbor-log",
    });
    expect(hits[0]?.excerpt.toLowerCase()).toContain("lighthouse");
    expect(searchKnowledge("org-b", "Harbor log")).toHaveLength(0);
    expect(searchKnowledge("org-a", "   ")).toEqual([]);
  });

  it("rejects a blank title and keeps slugs unique in the organization", () => {
    expect(createKnowledgePage({ organizationId: "org-a", title: "  ", body: "Notes" })).toEqual({
      ok: false,
      error: "Title is required.",
    });
    const first = createKnowledgePage({ organizationId: "org-a", title: "Field notes", body: "One" });
    const second = createKnowledgePage({ organizationId: "org-a", title: "Field notes", body: "Two" });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.page.slug).toBe("field-notes");
    expect(second.page.slug).toBe("field-notes-2");
    expect(listKnowledgePages("org-b").some((page) => page.slug.startsWith("field-notes"))).toBe(false);
  });

  it("uses can() for read and write", () => {
    const reader = subject([allow("knowledge.read")]);
    expect(canReadKnowledge(reader, scope)).toBe(true);
    expect(canWriteKnowledge(reader, scope)).toBe(false);
    const writer = subject([allow("knowledge.read"), allow("knowledge.write")]);
    expect(canWriteKnowledge(writer, scope)).toBe(true);
    expect(canReadKnowledge(reader, { organizationId: "org-b" })).toBe(false);
    expect(canReadKnowledge(subject([allow("knowledge.read")], { entitledModuleIds: [] }), scope)).toBe(false);
  });
});
