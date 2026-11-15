"use client";

import { Badge, Button, Card, Input, Label } from "@pubcommand/ui";
import { useEffect, useRef, useState } from "react";
import { Flash } from "@/components/ui";
import { createExampleWorkspace } from "../../../../../../../../modules/forms/example";
import {
  FIELD_LIBRARY,
  createField,
  fieldLabel,
  moveField,
  parseOptions,
  previewControls,
  removeField,
  renameForm,
  responseCount,
  responseCountLabel,
  updateField,
} from "../../../../../../../../modules/forms/logic";
import { createFormsStore, type SaveResult } from "../../../../../../../../modules/forms/store";
import type { FieldType, FormDefinition, FormResponse } from "../../../../../../../../modules/forms/types";

function optionText(form: FormDefinition): Record<string, string> {
  return Object.fromEntries(
    form.fields.filter((field) => field.type === "select").map((field) => [field.id, field.options.join(", ")]),
  );
}

function readExample(organizationId: string) {
  const workspace = createExampleWorkspace(organizationId);
  return {
    draft: workspace.form,
    saved: workspace.form,
    responses: workspace.responses,
    optionDrafts: optionText(workspace.form),
  };
}

export function FormsBuilder({
  organizationId,
  canWrite,
  canExport,
}: {
  organizationId: string;
  canWrite: boolean;
  canExport: boolean;
}) {
  const storeRef = useRef<ReturnType<typeof createFormsStore> | null>(null);
  if (storeRef.current === null) storeRef.current = createFormsStore();
  const [draft, setDraft] = useState<FormDefinition>(() => readExample(organizationId).draft);
  const [saved, setSaved] = useState<FormDefinition>(() => readExample(organizationId).saved);
  const [responses, setResponses] = useState<FormResponse[]>(() => readExample(organizationId).responses);
  const [optionDrafts, setOptionDrafts] = useState<Record<string, string>>(() => readExample(organizationId).optionDrafts);
  const dragIdRef = useRef<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const workspace = storeRef.current?.load(organizationId);
    if (!workspace) return;
    setDraft(workspace.form);
    setSaved(workspace.form);
    setResponses(workspace.responses);
    setOptionDrafts(optionText(workspace.form));
    dragIdRef.current = null;
    setOverId(null);
    setError(null);
    setNotice(null);
  }, [organizationId]);

  function store() {
    const current = storeRef.current;
    if (!current) throw new Error("Forms store is not ready.");
    return current;
  }

  function applySave(result: SaveResult) {
    if (!result.ok) {
      setError(result.errors.join(" "));
      setNotice(null);
      return;
    }
    setDraft(result.form);
    setSaved(result.form);
    setResponses(store().responses(organizationId, result.form.id));
    setError(null);
    setNotice("Saved");
  }

  function add(type: FieldType) {
    const field = createField(type);
    setDraft((current) => ({ ...current, fields: [...current.fields, field] }));
    if (field.type === "select") {
      setOptionDrafts((current) => ({ ...current, [field.id]: field.options.join(", ") }));
    }
  }

  function shift(id: string, offset: -1 | 1) {
    setDraft((current) => {
      const index = current.fields.findIndex((field) => field.id === id);
      const target = current.fields[index + offset];
      if (!target) return current;
      return { ...current, fields: moveField(current.fields, id, target.id) };
    });
  }

  function dropOn(targetId: string, transferId?: string) {
    const fromId = transferId || dragIdRef.current;
    if (canWrite && fromId) {
      setDraft((current) => ({ ...current, fields: moveField(current.fields, fromId, targetId) }));
    }
    dragIdRef.current = null;
    setOverId(null);
  }

  const preview = previewControls(draft);
  const count = responseCount(responses, saved.id, organizationId);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <Badge tone="warn">EXAMPLE</Badge>
        <span>Sample form and responses for this organization. A save lasts for this session.</span>
      </div>
      {!canWrite ? <p className="text-sm text-muted">You can view this form. Editing needs forms.write.</p> : null}
      <Flash error={error ?? undefined} notice={notice ?? undefined} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.85fr)]">
        <Card className="p-4">
          <div className="grid gap-4">
            <div>
              <Label htmlFor="form-name">Form name</Label>
              <Input
                id="form-name"
                className="mt-1"
                value={draft.name}
                disabled={!canWrite}
                onChange={(event) => setDraft((current) => renameForm(current, event.target.value))}
              />
            </div>
            <div>
              <p className="text-sm font-semibold">Field library</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {FIELD_LIBRARY.map((item) => (
                  <Button key={item.type} type="button" variant="secondary" size="sm" disabled={!canWrite} onClick={() => add(item.type)}>
                    Add {item.label.toLowerCase()}
                  </Button>
                ))}
              </div>
            </div>
            <ul className="grid gap-3">
              {draft.fields.map((field, index) => (
                <li
                  key={field.id}
                  className={`rounded-md border bg-canvas p-3 ${overId === field.id ? "border-accent" : "border-line"}`}
                  onDragOver={(event) => {
                    if (!canWrite) return;
                    event.preventDefault();
                    setOverId(field.id);
                  }}
                  onDragLeave={() => setOverId((current) => (current === field.id ? null : current))}
                  onDrop={(event) => {
                    event.preventDefault();
                    dropOn(field.id, event.dataTransfer.getData("text/plain"));
                  }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        draggable={canWrite}
                        disabled={!canWrite}
                        aria-label={`Drag to reorder ${field.label || "field"}`}
                        className="cursor-grab text-xs font-semibold uppercase tracking-wide text-muted disabled:cursor-not-allowed"
                        onDragStart={(event) => {
                          event.dataTransfer.setData("text/plain", field.id);
                          event.dataTransfer.effectAllowed = "move";
                          dragIdRef.current = field.id;
                        }}
                        onDragEnd={() => {
                          dragIdRef.current = null;
                          setOverId(null);
                        }}
                      >
                        Drag
                      </button>
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{field.type}</span>
                    </div>
                    <div className="flex gap-1">
                      <Button type="button" variant="ghost" size="sm" disabled={!canWrite || index === 0} onClick={() => shift(field.id, -1)}>
                        Up
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!canWrite || index === draft.fields.length - 1}
                        onClick={() => shift(field.id, 1)}
                      >
                        Down
                      </Button>
                      <Button type="button" variant="danger" size="sm" disabled={!canWrite} onClick={() => setDraft((current) => removeField(current, field.id))}>
                        Remove
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <div>
                      <Label htmlFor={`label-${field.id}`}>Label</Label>
                      <Input
                        id={`label-${field.id}`}
                        className="mt-1"
                        value={field.label}
                        disabled={!canWrite}
                        onChange={(event) => setDraft((current) => updateField(current, field.id, { label: event.target.value }))}
                      />
                    </div>
                    <label className="flex items-end gap-2 pb-2 text-sm">
                      <input
                        type="checkbox"
                        checked={field.required}
                        disabled={!canWrite}
                        onChange={(event) => setDraft((current) => updateField(current, field.id, { required: event.target.checked }))}
                      />
                      Required
                    </label>
                  </div>
                  {field.type === "select" ? (
                    <div className="mt-3">
                      <Label htmlFor={`options-${field.id}`}>Options</Label>
                      <Input
                        id={`options-${field.id}`}
                        className="mt-1"
                        value={optionDrafts[field.id] ?? field.options.join(", ")}
                        disabled={!canWrite}
                        placeholder="Markets, Policy, Housing"
                        onChange={(event) => {
                          const text = event.target.value;
                          setOptionDrafts((current) => ({ ...current, [field.id]: text }));
                          setDraft((current) => updateField(current, field.id, { options: parseOptions(text) }));
                        }}
                      />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">TODO: Branching logic is not in this slice.</p>
            {canWrite ? (
              <div>
                <Button type="button" onClick={() => applySave(store().save(organizationId, { ...draft, organizationId }))}>
                  Save
                </Button>
              </div>
            ) : null}
          </div>
        </Card>
        <div className="grid content-start gap-6">
          <Card className="p-4">
            <h2 className="text-sm font-semibold">Live preview</h2>
            <div aria-live="polite" aria-label="Live preview" className="mt-4 grid gap-3">
              <p className="text-base font-semibold">{draft.name.trim() || "Untitled form"}</p>
              {preview.length === 0 ? <p className="text-sm text-muted">Add a field to preview the form.</p> : null}
              {preview.map((control) => (
                <label key={control.id} className="grid gap-1 text-sm">
                  <span className="font-semibold">
                    {control.label || "Untitled"}
                    {control.required ? " *" : ""}
                  </span>
                  {control.type === "select" ? (
                    <select disabled className="h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-ink">
                      {control.options.map((option, index) => (
                        <option key={`${option}-${index}`}>{option}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      disabled
                      type={control.type === "email" ? "email" : "text"}
                      className="h-10 w-full rounded-md border border-line bg-white px-3 text-sm"
                    />
                  )}
                </label>
              ))}
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">{responseCountLabel(count)}</h2>
              {canExport ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(responses, null, 2)], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = "form-responses.json";
                    link.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Export JSON
                </Button>
              ) : null}
            </div>
            {responses.length === 0 ? <p className="mt-3 text-sm text-muted">No responses yet.</p> : null}
            <ul className="mt-2 divide-y divide-line">
              {responses.map((response) => (
                <li key={response.id} className="py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <time dateTime={response.submittedAt}>{response.submittedAt.slice(0, 10)}</time>
                    {response.example ? <Badge tone="warn">EXAMPLE</Badge> : null}
                  </div>
                  <p className="mt-1 text-muted">
                    {response.answers.map((answer) => `${fieldLabel(saved, answer.fieldId)}: ${answer.value}`).join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
