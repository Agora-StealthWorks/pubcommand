import { createExampleWorkspace } from "./example";
import { normalizeForm, validateForm } from "./logic";
import type { FormDefinition, FormResponse, Workspace } from "./types";

export type SaveResult = { ok: true; form: FormDefinition } | { ok: false; errors: string[] };

function cloneForm(form: FormDefinition): FormDefinition {
  return {
    ...form,
    fields: form.fields.map((field) => ({ ...field, options: [...field.options] })),
  };
}

function cloneResponse(response: FormResponse): FormResponse {
  return { ...response, answers: response.answers.map((answer) => ({ ...answer })) };
}

export function createFormsStore() {
  const byOrg = new Map<string, Workspace>();

  function ensure(organizationId: string): Workspace {
    const existing = byOrg.get(organizationId);
    if (existing) return existing;
    const seeded = createExampleWorkspace(organizationId);
    byOrg.set(organizationId, seeded);
    return seeded;
  }

  return {
    load(organizationId: string): Workspace {
      const entry = ensure(organizationId);
      return { form: cloneForm(entry.form), responses: entry.responses.map(cloneResponse) };
    },
    save(organizationId: string, draft: FormDefinition): SaveResult {
      if (draft.organizationId !== organizationId) {
        return { ok: false, errors: ["Form is outside this organization."] };
      }
      const errors = validateForm(draft);
      if (errors.length > 0) return { ok: false, errors };
      const current = ensure(organizationId);
      if (draft.id !== current.form.id) {
        return { ok: false, errors: ["Form is outside this organization."] };
      }
      const form = normalizeForm(cloneForm(draft), new Date().toISOString());
      byOrg.set(organizationId, { form, responses: current.responses });
      return { ok: true, form: cloneForm(form) };
    },
    responses(organizationId: string, formId: string): FormResponse[] {
      const entry = byOrg.get(organizationId);
      if (!entry) return [];
      return entry.responses
        .filter((response) => response.formId === formId && response.organizationId === organizationId)
        .map(cloneResponse);
    },
  };
}
