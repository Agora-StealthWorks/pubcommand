export const FIELD_TYPES = ["text", "email", "select"] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export type FormField = {
  id: string;
  type: FieldType;
  label: string;
  required: boolean;
  options: string[];
};

export type FormDefinition = {
  id: string;
  organizationId: string;
  name: string;
  example: boolean;
  updatedAt: string;
  fields: FormField[];
};

export type FormAnswer = {
  fieldId: string;
  value: string;
};

export type FormResponse = {
  id: string;
  organizationId: string;
  formId: string;
  submittedAt: string;
  example: boolean;
  answers: FormAnswer[];
};

export type Workspace = {
  form: FormDefinition;
  responses: FormResponse[];
};
