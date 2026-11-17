/**
 * Starter forms offered when creating a new form. Niche-neutral on purpose:
 * brands may be finance, health or general publishers. Placeholders are
 * generic hints, never realistic sample data.
 */
import { createField, newChoiceId } from "./fields";
import type { FieldDef } from "./types";

export type Starter = { key: string; name: string; description: string; build: (id: () => string) => FieldDef[] };

function field(id: () => string, type: string, patch: Partial<FieldDef> = {}): FieldDef {
  return { ...createField(type, id()), ...patch };
}

function options(...labels: string[]) {
  return labels.map((label) => ({ id: newChoiceId(), label }));
}

export const STARTERS: readonly Starter[] = [
  { key: "blank", name: "Blank form", description: "Start from nothing.", build: () => [] },
  {
    key: "contact",
    name: "Contact request",
    description: "Name, email, topic and message, on one page.",
    build: (id) => [
      field(id, "name", { required: true, groupWithNext: true }),
      field(id, "email", { required: true, groupWithNext: true }),
      field(id, "dropdown", { label: "What is this about?", config: { choices: options("A question", "Feedback", "Something else") }, groupWithNext: true }),
      field(id, "long_text", { label: "Your message", required: true }),
      field(id, "consent", { required: true }),
      field(id, "hidden", { label: "Source", config: { queryParam: "source", defaultValue: "" } }),
    ],
  },
  {
    key: "feedback",
    name: "Reader feedback",
    description: "NPS, a rating and a follow-up that only appears for low scores.",
    build: (id) => {
      const nps = field(id, "nps", { required: true });
      const why = field(id, "long_text", {
        label: "What would make it better?",
        visibility: { action: "show", match: "all", rules: [{ fieldId: nps.id, op: "lte", value: 6 }] },
      });
      return [
        nps,
        why,
        field(id, "rating", { label: "How useful was the last issue you read?", config: { max: 5 } }),
        field(id, "multi_choice", { label: "Which topics do you want more of?", config: { choices: options("How-to guides", "News and analysis", "Interviews", "Reviews") } }),
        field(id, "email", { label: "Email (optional, if you want a reply)" }),
      ];
    },
  },
  {
    key: "event",
    name: "Event registration",
    description: "Sign-up with a yes/no that skips straight to submit.",
    build: (id) => {
      const attending = field(id, "yes_no", { label: "Will you attend live?", required: true });
      const session = field(id, "single_choice", { label: "Which session?", required: true, config: { choices: options("Morning", "Afternoon", "Evening") } });
      attending.skipLogic = { rules: [{ fieldId: attending.id, op: "equals", value: false, goTo: "submit" }] };
      return [
        field(id, "name", { required: true, groupWithNext: true }),
        field(id, "email", { required: true }),
        attending,
        session,
        field(id, "short_text", { label: "Anything we should know?" }),
      ];
    },
  },
];

export function starterFields(key: string, id: () => string): FieldDef[] {
  return (STARTERS.find((starter) => starter.key === key) ?? STARTERS[0]!).build(id);
}
