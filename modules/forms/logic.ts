import type { FieldType, FormDefinition, FormField, FormResponse } from "./types";

// TODO: Branching logic (show or hide a field from an earlier answer) is not implemented in this slice.

export const FIELD_LIBRARY: readonly { type: FieldType; label: string }[] = [
  { type: "text", label: "Text" },
  { type: "email", label: "Email" },
  { type: "select", label: "Select" },
];

export function createField(type: FieldType, id: string = crypto.randomUUID()): FormField {
  if (type === "email") return { id, type, label: "Email", required: true, options: [] };
  if (type === "select") return { id, type, label: "Select", required: false, options: ["Option A", "Option B"] };
  return { id, type, label: "Text", required: false, options: [] };
}

export function addField(form: FormDefinition, type: FieldType, id?: string): FormDefinition {
  return { ...form, fields: [...form.fields, createField(type, id)] };
}

export function removeField(form: FormDefinition, id: string): FormDefinition {
  return { ...form, fields: form.fields.filter((field) => field.id !== id) };
}

export function renameForm(form: FormDefinition, name: string): FormDefinition {
  return { ...form, name };
}

export function updateField(
  form: FormDefinition,
  id: string,
  patch: Partial<Pick<FormField, "label" | "required" | "options">>,
): FormDefinition {
  return {
    ...form,
    fields: form.fields.map((field) => {
      if (field.id !== id) return field;
      return {
        ...field,
        ...patch,
        options: patch.options !== undefined ? [...patch.options] : field.options,
      };
    }),
  };
}

export function moveField(fields: readonly FormField[], fromId: string, toId: string): FormField[] {
  const from = fields.findIndex((field) => field.id === fromId);
  const to = fields.findIndex((field) => field.id === toId);
  if (from < 0 || to < 0 || from === to) return [...fields];
  const next = [...fields];
  const [moved] = next.splice(from, 1);
  if (!moved) return next;
  next.splice(to, 0, moved);
  return next;
}

export function parseOptions(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function validateForm(draft: FormDefinition): string[] {
  const errors: string[] = [];
  if (!draft.organizationId.trim()) errors.push("Organization is required.");
  if (!draft.name.trim()) errors.push("Form name is required.");
  if (draft.fields.length === 0) errors.push("Add at least one field.");
  const ids = new Set<string>();
  let missingLabel = false;
  for (const field of draft.fields) {
    if (ids.has(field.id)) errors.push("Field ids must be unique.");
    ids.add(field.id);
    if (!field.label.trim()) missingLabel = true;
    if (field.type === "select" && field.options.every((option) => option.trim().length === 0)) {
      errors.push(`${field.label.trim() || "Select"} needs an option.`);
    }
  }
  if (missingLabel) errors.push("Every field needs a label.");
  return errors;
}

export function normalizeForm(draft: FormDefinition, updatedAt: string): FormDefinition {
  return {
    ...draft,
    name: draft.name.trim(),
    updatedAt,
    fields: draft.fields.map((field) => ({
      ...field,
      label: field.label.trim(),
      options:
        field.type === "select"
          ? field.options.map((option) => option.trim()).filter((option) => option.length > 0)
          : [],
    })),
  };
}

export type PreviewControl = {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: string[];
};

export function previewControls(form: FormDefinition): PreviewControl[] {
  return form.fields.map((field) => ({
    id: field.id,
    label: field.label,
    type: field.type,
    required: field.required,
    options: field.type === "select" ? [...field.options] : [],
  }));
}

export function fieldLabel(form: FormDefinition, fieldId: string): string {
  return form.fields.find((field) => field.id === fieldId)?.label ?? fieldId;
}

export function responseCount(responses: readonly FormResponse[], formId: string, organizationId: string): number {
  return responses.filter((response) => response.formId === formId && response.organizationId === organizationId).length;
}

export function responseCountLabel(count: number): string {
  return `${count} ${count === 1 ? "response" : "responses"}`;
}
