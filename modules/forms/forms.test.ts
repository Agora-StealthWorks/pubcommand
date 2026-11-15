import { describe, expect, it } from "vitest";
import { createExampleWorkspace } from "./example";
import {
  FIELD_LIBRARY,
  addField,
  fieldLabel,
  moveField,
  normalizeForm,
  parseOptions,
  previewControls,
  removeField,
  responseCount,
  responseCountLabel,
  updateField,
  validateForm,
} from "./logic";
import { manifest } from "./manifest";
import { createFormsStore } from "./store";

describe("forms contract", () => {
  it("declares the forms route, permissions, and plan entitlement", () => {
    expect(manifest.id).toBe("forms");
    expect(manifest.slug).toBe("forms");
    expect(manifest.planEntitlement).toBe("forms");
    expect(manifest.nav).toEqual([{ label: "Forms", href: "/forms", permission: "forms.read" }]);
    expect(manifest.routes.map((route) => route.path)).toEqual(["/forms"]);
    expect(manifest.permissions.map((permission) => permission.key)).toEqual([
      "forms.read",
      "forms.write",
      "forms.export",
    ]);
  });
});

describe("form builder", () => {
  it("offers text, email, and select in the field library", () => {
    expect(FIELD_LIBRARY.map((item) => item.type)).toEqual(["text", "email", "select"]);
  });

  it("seeds an example form with those field types and three responses", () => {
    const workspace = createExampleWorkspace("org-a");
    expect(workspace.form.example).toBe(true);
    expect(workspace.form.fields.map((field) => field.type)).toEqual(["text", "email", "select"]);
    expect(workspace.responses).toHaveLength(3);
    expect(responseCount(workspace.responses, workspace.form.id, "org-a")).toBe(3);
    expect(responseCountLabel(3)).toBe("3 responses");
    expect(responseCountLabel(1)).toBe("1 response");
  });

  it("reorders fields without mutating the original list", () => {
    const { form } = createExampleWorkspace("org-a");
    const [first, second, third] = form.fields;
    if (!first || !second || !third) throw new Error("expected three example fields");
    const moved = moveField(form.fields, first.id, third.id);
    expect(form.fields.map((field) => field.id)).toEqual([first.id, second.id, third.id]);
    expect(moved.map((field) => field.id)).toEqual([second.id, third.id, first.id]);
    expect(previewControls({ ...form, fields: moved }).map((control) => control.id)).toEqual([
      second.id,
      third.id,
      first.id,
    ]);
    expect(moveField(form.fields, "missing", first.id).map((field) => field.id)).toEqual([
      first.id,
      second.id,
      third.id,
    ]);
  });

  it("adds, updates, and removes fields", () => {
    const { form } = createExampleWorkspace("org-a");
    const added = addField(form, "text", "notes");
    expect(added.fields.at(-1)?.type).toBe("text");
    const renamed = updateField(added, "notes", { label: "Notes", required: true });
    expect(fieldLabel(renamed, "notes")).toBe("Notes");
    expect(removeField(renamed, "notes").fields.some((field) => field.id === "notes")).toBe(false);
  });

  it("parses select options and rejects a form that cannot be saved", () => {
    expect(parseOptions(" Markets, Policy , ,Housing ")).toEqual(["Markets", "Policy", "Housing"]);
    const { form } = createExampleWorkspace("org-a");
    expect(validateForm({ ...form, name: "   " })).toContain("Form name is required.");
    const cleared = updateField(form, form.fields[2]?.id ?? "", { options: ["  "] });
    expect(validateForm(cleared).some((error) => error.includes("needs an option."))).toBe(true);
    const normalized = normalizeForm({ ...form, name: "  Briefing  " }, "2026-11-15T12:00:00.000Z");
    expect(normalized.name).toBe("Briefing");
    expect(normalized.fields[2]?.options).toEqual(["Markets", "Policy", "Housing"]);
    expect(normalized.fields[0]?.options).toEqual([]);
  });
});

describe("org-scoped forms store", () => {
  it("saves for one organization and leaves the other on example data", () => {
    const store = createFormsStore();
    const orgA = store.load("org-a");
    const saved = store.save("org-a", { ...orgA.form, name: "Org A only" });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.form.name).toBe("Org A only");
    expect(saved.form.organizationId).toBe("org-a");
    expect(store.load("org-b").form.name).toBe("Reader briefing request");
    expect(store.responses("org-a", saved.form.id)).toHaveLength(3);
    expect(store.responses("org-b", saved.form.id)).toHaveLength(0);
    expect(responseCount(store.responses("org-b", store.load("org-b").form.id), store.load("org-b").form.id, "org-b")).toBe(3);
  });

  it("rejects a form that belongs to another organization and keeps failed saves off the store", () => {
    const store = createFormsStore();
    const orgA = store.load("org-a");
    const hijack = store.save("org-b", { ...orgA.form, name: "Hijack" });
    expect(hijack).toEqual({ ok: false, errors: ["Form is outside this organization."] });
    expect(store.load("org-b").form.name).toBe("Reader briefing request");

    const invalid = store.save("org-a", { ...orgA.form, name: " " });
    expect(invalid.ok).toBe(false);
    expect(store.load("org-a").form.name).toBe("Reader briefing request");
  });

  it("does not let callers mutate the stored form or responses", () => {
    const store = createFormsStore();
    const loaded = store.load("org-a");
    loaded.form.name = "mutated";
    loaded.form.fields.pop();
    loaded.responses.pop();
    const again = store.load("org-a");
    expect(again.form.name).toBe("Reader briefing request");
    expect(again.form.fields).toHaveLength(3);
    expect(again.responses).toHaveLength(3);
  });
});
