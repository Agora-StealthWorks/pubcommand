import type { FormDefinition, FormResponse, Workspace } from "./types";

const EXAMPLE_UPDATED_AT = "2026-11-15T00:00:00.000Z";

function fieldId(organizationId: string, name: string): string {
  return `example-${name}:${organizationId}`;
}

function response(
  organizationId: string,
  formId: string,
  number: number,
  submittedAt: string,
  name: string,
  email: string,
  topic: string,
): FormResponse {
  return {
    id: `example-response-${number}:${organizationId}`,
    organizationId,
    formId,
    submittedAt,
    example: true,
    answers: [
      { fieldId: fieldId(organizationId, "name"), value: name },
      { fieldId: fieldId(organizationId, "email"), value: email },
      { fieldId: fieldId(organizationId, "topic"), value: topic },
    ],
  };
}

/** Example form and responses for one organization. Each call returns new objects. */
export function createExampleWorkspace(organizationId: string): Workspace {
  const formId = `example-reader-briefing:${organizationId}`;
  const form: FormDefinition = {
    id: formId,
    organizationId,
    name: "Reader briefing request",
    example: true,
    updatedAt: EXAMPLE_UPDATED_AT,
    fields: [
      { id: fieldId(organizationId, "name"), type: "text", label: "Name", required: true, options: [] },
      { id: fieldId(organizationId, "email"), type: "email", label: "Email", required: true, options: [] },
      {
        id: fieldId(organizationId, "topic"),
        type: "select",
        label: "Topic",
        required: false,
        options: ["Markets", "Policy", "Housing"],
      },
    ],
  };
  const responses: FormResponse[] = [
    response(organizationId, formId, 1, "2026-11-12T15:00:00.000Z", "Maya Chen", "maya@example.com", "Markets"),
    response(organizationId, formId, 2, "2026-11-13T15:00:00.000Z", "Luis Ortega", "luis@example.com", "Policy"),
    response(organizationId, formId, 3, "2026-11-14T15:00:00.000Z", "Priya Shah", "priya@example.com", "Housing"),
  ];
  return { form, responses };
}
