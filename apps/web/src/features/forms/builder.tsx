"use client";

import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useState, useTransition } from "react";
import { createField, fieldSpec, newChoiceId, paletteGroups } from "../../../../../modules/forms/fields";
import { LOGIC_OPS, MAX_END_RULES, SUBMIT_TARGET, buildPages, defaultRuleValue, endRuleProblems, logicProblems, ruleSources, skipTargets } from "../../../../../modules/forms/logic";
import type { EndRule, FieldDef, FormLayout, LogicRule, PublicForm, ResolvedTheme, SkipRule } from "../../../../../modules/forms/types";
import { saveForm, type SaveFormInput } from "./actions";
import { FormRenderer } from "./renderer";

export type BuilderSettings = SaveFormInput["settings"];

type Tab = "build" | "preview" | "settings";

const control = "pc-control w-full text-sm";

function isoToLocal(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
const small = "text-xs font-semibold uppercase tracking-wider text-muted";

export function FormBuilder({
  formId,
  initialFields,
  initialSettings,
  initialEndRules,
  themes,
  folders,
  canWrite,
  initialTab,
}: {
  formId: string;
  initialFields: FieldDef[];
  initialSettings: BuilderSettings;
  initialEndRules: EndRule[];
  themes: { id: string; name: string; preview: ResolvedTheme }[];
  folders: { id: string; name: string }[];
  canWrite: boolean;
  initialTab: Tab;
}) {
  const [fields, setFields] = useState(initialFields);
  // Dates arrive as ISO; datetime-local inputs need the viewer's local time.
  const [settings, setSettings] = useState(() => ({ ...initialSettings, opensAt: isoToLocal(initialSettings.opensAt), closesAt: isoToLocal(initialSettings.closesAt) }));
  const [endRules, setEndRules] = useState<EndRule[]>(initialEndRules);
  const [selectedId, setSelectedId] = useState<string | null>(initialFields[0]?.id ?? null);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string; warnings?: string[] } | null>(null);
  const [saving, startSaving] = useTransition();

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const layout: FormLayout = settings.layout === "single" ? "single" : "paginated";
  const problems = useMemo(() => [...logicProblems(fields, layout), ...endRuleProblems(fields, endRules)], [fields, layout, endRules]);
  const selected = fields.find((field) => field.id === selectedId) ?? null;
  const pages = useMemo(() => buildPages(fields, layout), [fields, layout]);
  const pageOf = useMemo(() => new Map(pages.flatMap((page) => page.fieldIds.map((id) => [id, page.index] as const))), [pages]);

  function change(next: FieldDef[]) {
    setFields(next);
    setDirty(true);
  }
  function patch(id: string, value: Partial<FieldDef>) {
    change(fields.map((field) => (field.id === id ? { ...field, ...value } : field)));
  }
  function patchSettings(value: Partial<BuilderSettings>) {
    setSettings((current) => ({ ...current, ...value }));
    setDirty(true);
  }
  function add(type: string) {
    const field = createField(type, crypto.randomUUID());
    const at = selectedId ? fields.findIndex((item) => item.id === selectedId) + 1 : fields.length;
    const next = [...fields];
    next.splice(at > 0 ? at : fields.length, 0, field);
    change(next);
    setSelectedId(field.id);
    setTab("build");
  }
  function move(id: string, delta: number) {
    const from = fields.findIndex((field) => field.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= fields.length) return;
    change(arrayMove(fields, from, to));
  }
  function remove(id: string) {
    change(fields.filter((field) => field.id !== id));
    if (selectedId === id) setSelectedId(null);
  }
  function duplicate(id: string) {
    const index = fields.findIndex((field) => field.id === id);
    const source = fields[index];
    if (!source) return;
    const copy: FieldDef = { ...structuredClone(source), id: crypto.randomUUID(), label: `${source.label} (copy)`, skipLogic: null };
    const next = [...fields];
    next.splice(index + 1, 0, copy);
    change(next);
    setSelectedId(copy.id);
  }

  function save() {
    const toIso = (value: string) => (value ? new Date(value).toISOString() : "");
    startSaving(async () => {
      try {
        const result = await saveForm({ formId, fields, endRules, settings: { ...settings, opensAt: toIso(settings.opensAt), closesAt: toIso(settings.closesAt) } });
        if (result.ok) {
          setDirty(false);
          setSettings((current) => ({ ...current, slug: result.slug }));
          setMessage({ tone: "ok", text: `Saved at ${new Date(result.savedAt).toLocaleTimeString()}.`, warnings: result.warnings });
        } else setMessage({ tone: "error", text: result.error });
      } catch {
        setMessage({ tone: "error", text: "Could not save. Check your connection and try again." });
      }
    });
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = fields.findIndex((field) => field.id === active.id);
    const to = fields.findIndex((field) => field.id === over.id);
    if (from >= 0 && to >= 0) change(arrayMove(fields, from, to));
  }

  const theme = themes.find((item) => item.id === settings.themeId)?.preview ?? themes[0]?.preview ?? null;
  const previewForm: PublicForm = {
    id: formId,
    slug: settings.slug,
    title: settings.title,
    description: settings.description,
    layout,
    showProgress: settings.showProgress,
    autoAdvance: settings.autoAdvance,
    submitLabel: settings.submitLabel,
    confirmTitle: settings.confirmTitle,
    confirmMessage: settings.confirmMessage,
    redirectUrl: null,
    disclaimer: settings.disclaimerOverride || null,
    fields,
    endRules,
  };

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-20 -mx-4 flex flex-wrap items-center gap-2 border-b border-line bg-canvas/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:bg-white sm:px-3">
        <nav className="flex gap-1" aria-label="Builder views">
          {(["build", "preview", "settings"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              aria-pressed={tab === item}
              className={`min-h-10 rounded-md px-3 text-sm font-semibold capitalize ${tab === item ? "bg-accent text-white" : "text-ink hover:bg-canvas"}`}
            >
              {item}
            </button>
          ))}
        </nav>
        <span className="ml-auto text-xs text-muted" aria-live="polite">
          {dirty ? "Unsaved changes" : message?.tone === "ok" ? message.text : "All changes saved"}
        </span>
        {canWrite ? (
          <button type="button" onClick={save} disabled={saving || !dirty} className="min-h-10 rounded-md bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
        ) : null}
      </div>

      {message?.tone === "error" ? <p className="rounded-md border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm text-[#912018]">{message.text}</p> : null}
      {message?.warnings?.length ? (
        <div className="rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
          <p className="font-semibold">Saved, but not ready to publish:</p>
          <ul className="mt-1 list-disc pl-5">
            {message.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "build" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[200px_minmax(0,1fr)_340px]">
          {canWrite ? <Palette onAdd={add} /> : <div className="hidden lg:block" />}
          <section className="min-w-0 space-y-2" aria-label="Questions">
            {fields.length === 0 ? <p className="rounded-xl border border-dashed border-line bg-white p-6 text-center text-sm text-muted">Add a question from the list to start.</p> : null}
            <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={onDragEnd}>
              <SortableContext items={fields.map((field) => field.id)} strategy={verticalListSortingStrategy}>
                {fields.map((field, index) => (
                  <FieldCard
                    key={field.id}
                    field={field}
                    index={index}
                    count={fields.length}
                    page={pageOf.get(field.id)}
                    selected={field.id === selectedId}
                    canWrite={canWrite}
                    onSelect={() => setSelectedId(field.id)}
                    onMove={(delta) => move(field.id, delta)}
                  />
                ))}
              </SortableContext>
            </DndContext>
            {problems.length ? (
              <div className="rounded-md border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
                <p className="font-semibold">Branching needs attention</p>
                <ul className="mt-1 list-disc pl-5">
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
          <aside className="min-w-0">
            {selected ? (
              <Inspector
                key={selected.id}
                field={selected}
                fields={fields}
                layout={layout}
                canWrite={canWrite}
                onChange={(value) => patch(selected.id, value)}
                onRemove={() => remove(selected.id)}
                onDuplicate={() => duplicate(selected.id)}
              />
            ) : (
              <p className="rounded-xl border border-line bg-white p-4 text-sm text-muted">Select a question to edit it.</p>
            )}
          </aside>
        </div>
      ) : null}

      {tab === "preview" ? (
        <div className="overflow-hidden rounded-xl border border-line">
          {theme ? (
            <FormRenderer form={previewForm} theme={theme} mode="preview" />
          ) : (
            <p className="bg-white p-6 text-sm text-muted">Create a theme to preview the form with its logo and privacy link.</p>
          )}
        </div>
      ) : null}

      {tab === "settings" ? (
        <>
          <SettingsPanel settings={settings} themes={themes} folders={folders} canWrite={canWrite} onChange={patchSettings} />
          <EndRulesEditor
            fields={fields}
            rules={endRules}
            disabled={!canWrite}
            onChange={(next) => {
              setEndRules(next);
              setDirty(true);
            }}
          />
        </>
      ) : null}
    </div>
  );
}

function Palette({ onAdd }: { onAdd: (type: string) => void }) {
  const groups = paletteGroups();
  // Open beside the canvas on desktop; folded on phones so the questions stay in view.
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (window.matchMedia("(max-width: 1023px)").matches) setOpen(false);
  }, []);
  return (
    <details
      className="group rounded-xl border border-line bg-white lg:sticky lg:top-16 lg:self-start"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-semibold lg:hidden">+ Add a question</summary>
      <div className="max-h-[70vh] space-y-3 overflow-y-auto p-3 pt-0 lg:pt-3">
        {groups.map((group) => (
          <div key={group.category}>
            <p className={small}>{group.category}</p>
            <div className="mt-1 grid grid-cols-2 gap-1 lg:grid-cols-1">
              {group.types.map((spec) => (
                <button key={spec.type} type="button" onClick={() => onAdd(spec.type)} title={spec.hint} className="min-h-9 rounded-md px-2 text-left text-sm hover:bg-canvas">
                  + {spec.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function FieldCard({
  field,
  index,
  count,
  page,
  selected,
  canWrite,
  onSelect,
  onMove,
}: {
  field: FieldDef;
  index: number;
  count: number;
  page: number | undefined;
  selected: boolean;
  canWrite: boolean;
  onSelect: () => void;
  onMove: (delta: number) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: field.id, disabled: !canWrite });
  const spec = fieldSpec(field.type);
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-stretch gap-1 rounded-xl border bg-white ${selected ? "border-accent ring-2 ring-accent/20" : "border-line"} ${isDragging ? "z-10 shadow-lg" : ""}`}
    >
      {canWrite ? (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Drag to reorder ${field.label || spec?.label}`}
          className="flex w-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-l-xl text-muted hover:bg-canvas active:cursor-grabbing"
        >
          ⋮⋮
        </button>
      ) : null}
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 px-2 py-2.5 text-left">
        <span className="flex flex-wrap items-center gap-x-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
          <span>{spec?.label ?? field.type}</span>
          {page !== undefined ? <span>· Page {page + 1}</span> : null}
          {field.required ? <span className="text-[#b42318]">· Required</span> : null}
          {field.visibility ? <span className="text-accent">· Conditional</span> : null}
          {field.skipLogic ? <span className="text-accent">· Skips</span> : null}
          {field.groupWithNext ? <span>· Grouped</span> : null}
        </span>
        <span className="[overflow-wrap:anywhere] mt-0.5 block text-sm font-medium text-ink">{field.label || <em className="text-muted">No label</em>}</span>
      </button>
      {canWrite ? (
        <div className="flex shrink-0 flex-col justify-center pr-1">
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move up" className="h-8 w-8 rounded text-muted hover:bg-canvas disabled:opacity-30">
            ↑
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={index === count - 1} aria-label="Move down" className="h-8 w-8 rounded text-muted hover:bg-canvas disabled:opacity-30">
            ↓
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex min-h-9 items-center gap-2 text-sm">
      <input type="checkbox" className="h-4 w-4 accent-accent" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

function Text({ label, value, onChange, disabled, multiline, type = "text", placeholder }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean; multiline?: boolean; type?: string; placeholder?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {multiline ? (
        <textarea className={`${control} min-h-20`} value={value} disabled={disabled} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input className={control} type={type} value={value} disabled={disabled} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}

function numberOrUndefined(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function Inspector({
  field,
  fields,
  layout,
  canWrite,
  onChange,
  onRemove,
  onDuplicate,
}: {
  field: FieldDef;
  fields: FieldDef[];
  layout: FormLayout;
  canWrite: boolean;
  onChange: (value: Partial<FieldDef>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const spec = fieldSpec(field.type);
  if (!spec) return null;
  const options = new Set(spec.inspector);
  const config = field.config;
  const setConfig = (value: Partial<FieldDef["config"]>) => onChange({ config: { ...config, ...value } });
  const disabled = !canWrite;

  return (
    <div className="space-y-4 rounded-xl border border-line bg-white p-4 lg:sticky lg:top-16 lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto">
      <div className="flex items-center justify-between gap-2">
        <p className={small}>{spec.label}</p>
        {canWrite ? (
          <div className="flex gap-1">
            <button type="button" onClick={onDuplicate} className="min-h-9 rounded-md border border-line px-2 text-xs font-semibold">
              Duplicate
            </button>
            <button type="button" onClick={onRemove} className="min-h-9 rounded-md border border-[#fecdca] px-2 text-xs font-semibold text-[#b42318]">
              Delete
            </button>
          </div>
        ) : null}
      </div>
      <Text label={field.type === "statement" ? "Heading" : "Question"} value={field.label} disabled={disabled} multiline={field.label.length > 60} onChange={(label) => onChange({ label })} />
      {options.has("body") ? <Text label="Paragraph" value={config.body ?? ""} disabled={disabled} multiline onChange={(body) => setConfig({ body })} /> : null}
      {spec.captures && field.type !== "hidden" ? (
        <>
          <Text label="Help text" value={field.helpText} disabled={disabled} onChange={(helpText) => onChange({ helpText })} />
          {options.has("placeholder") ? <Text label="Placeholder (a generic hint, never sample personal data)" value={field.placeholder} disabled={disabled} onChange={(placeholder) => onChange({ placeholder })} /> : null}
          <Toggle label="Required" checked={field.required} disabled={disabled} onChange={(required) => onChange({ required })} />
        </>
      ) : null}
      {layout === "paginated" && field.type !== "hidden" && field.type !== "page_break" ? (
        <Toggle label="Keep on the same page as the next question" checked={field.groupWithNext} disabled={disabled} onChange={(groupWithNext) => onChange({ groupWithNext })} />
      ) : null}

      {options.has("choices") ? <ChoicesEditor title={field.type === "ranking" ? "Options to rank" : "Options"} items={config.choices ?? []} disabled={disabled} onChange={(choices) => setConfig({ choices })} /> : null}
      {options.has("rows") ? <ChoicesEditor title="Rows (what is rated)" noun="Row" items={config.rows ?? []} disabled={disabled} onChange={(rows) => setConfig({ rows })} /> : null}
      {options.has("columns") ? <ChoicesEditor title="Columns (the answers)" noun="Column" items={config.columns ?? []} disabled={disabled} onChange={(columns) => setConfig({ columns })} /> : null}
      {options.has("allowOther") ? <Toggle label="Allow “Other” with a typed answer" checked={config.allowOther === true} disabled={disabled} onChange={(allowOther) => setConfig({ allowOther })} /> : null}
      {options.has("selections") ? (
        <div className="grid grid-cols-2 gap-2">
          <Text label="Min picks" type="number" value={config.minSelections?.toString() ?? ""} disabled={disabled} onChange={(value) => setConfig({ minSelections: numberOrUndefined(value) })} />
          <Text label="Max picks" type="number" value={config.maxSelections?.toString() ?? ""} disabled={disabled} onChange={(value) => setConfig({ maxSelections: numberOrUndefined(value) })} />
        </div>
      ) : null}
      {options.has("range") ? (
        field.type === "rating" ? (
          <Text label="Stars (3–10)" type="number" value={config.max?.toString() ?? "5"} disabled={disabled} onChange={(value) => setConfig({ max: numberOrUndefined(value) })} />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Text label="Minimum" type="number" value={config.min?.toString() ?? ""} disabled={disabled} onChange={(value) => setConfig({ min: numberOrUndefined(value) })} />
            <Text label="Maximum" type="number" value={config.max?.toString() ?? ""} disabled={disabled} onChange={(value) => setConfig({ max: numberOrUndefined(value) })} />
          </div>
        )
      ) : null}
      {options.has("step") ? <Text label="Step" type="number" value={config.step?.toString() ?? "1"} disabled={disabled} onChange={(value) => setConfig({ step: numberOrUndefined(value) })} /> : null}
      {options.has("maxSize") ? (
        <>
          <Text label="Max MB (1–10)" type="number" value={config.maxSizeMb?.toString() ?? "5"} disabled={disabled} onChange={(value) => setConfig({ maxSizeMb: numberOrUndefined(value) })} />
          <p className="text-xs text-muted">PNG, JPG, WebP or GIF. The file's real type is checked on the server.</p>
        </>
      ) : null}
      {options.has("scaleLabels") ? (
        <div className="grid grid-cols-2 gap-2">
          <Text label="Low label" value={config.leftLabel ?? ""} disabled={disabled} onChange={(leftLabel) => setConfig({ leftLabel })} />
          <Text label="High label" value={config.rightLabel ?? ""} disabled={disabled} onChange={(rightLabel) => setConfig({ rightLabel })} />
        </div>
      ) : null}
      {options.has("affixes") ? (
        <div className="grid grid-cols-2 gap-2">
          <Text label="Prefix" value={config.prefix ?? ""} placeholder="$" disabled={disabled} onChange={(prefix) => setConfig({ prefix })} />
          <Text label="Suffix" value={config.suffix ?? ""} placeholder="%" disabled={disabled} onChange={(suffix) => setConfig({ suffix })} />
        </div>
      ) : null}
      {options.has("length") ? (
        <div className="grid grid-cols-2 gap-2">
          <Text label="Min length" type="number" value={config.minLength?.toString() ?? ""} disabled={disabled} onChange={(value) => setConfig({ minLength: numberOrUndefined(value) })} />
          <Text label="Max length" type="number" value={config.maxLength?.toString() ?? ""} disabled={disabled} onChange={(value) => setConfig({ maxLength: numberOrUndefined(value) })} />
        </div>
      ) : null}
      {options.has("accept") ? (
        <div className="grid grid-cols-[minmax(0,1fr)_90px] gap-2">
          <Text label="File types" value={(config.accept ?? []).join(", ")} disabled={disabled} onChange={(value) => setConfig({ accept: value.split(/[,\s]+/).filter(Boolean) })} />
          <Text label="Max MB" type="number" value={config.maxSizeMb?.toString() ?? "10"} disabled={disabled} onChange={(value) => setConfig({ maxSizeMb: numberOrUndefined(value) })} />
        </div>
      ) : null}
      {options.has("consentText") ? <Text label="Checkbox text" multiline value={config.consentText ?? ""} disabled={disabled} onChange={(consentText) => setConfig({ consentText })} /> : null}
      {options.has("queryParam") ? (
        <div className="space-y-2">
          <Text label="Link parameter" value={config.queryParam ?? ""} disabled={disabled} onChange={(queryParam) => setConfig({ queryParam })} />
          <Text label="Default when the link has none" value={config.defaultValue ?? ""} disabled={disabled} onChange={(defaultValue) => setConfig({ defaultValue })} />
          <p className="text-xs text-muted">
            Captures <code>?{config.queryParam || "param"}=value</code> from the form link. UTM tags are captured on every response automatically.
          </p>
        </div>
      ) : null}
      {options.has("allowTyped") ? <Toggle label="Allow typing a name instead of drawing" checked={config.allowTyped !== false} disabled={disabled} onChange={(allowTyped) => setConfig({ allowTyped })} /> : null}

      {field.type !== "page_break" && field.type !== "hidden" ? <VisibilityEditor field={field} fields={fields} disabled={disabled} onChange={(visibility) => onChange({ visibility })} /> : null}
      {spec.logicUsable && field.type !== "hidden" ? <SkipEditor field={field} fields={fields} layout={layout} disabled={disabled} onChange={(skipLogic) => onChange({ skipLogic })} /> : null}
    </div>
  );
}

function ChoicesEditor({
  title,
  noun = "Option",
  items,
  disabled,
  onChange,
}: {
  title: string;
  noun?: string;
  items: { id: string; label: string }[];
  disabled: boolean;
  onChange: (choices: { id: string; label: string }[]) => void;
}) {
  const choices = items;
  return (
    <div>
      <p className="mb-1 text-sm font-medium">{title}</p>
      <ul className="space-y-1">
        {choices.map((choice, index) => (
          <li key={choice.id} className="flex items-center gap-1">
            <input
              aria-label={`${noun} ${index + 1}`}
              className={`${control} flex-1`}
              value={choice.label}
              disabled={disabled}
              onChange={(event) => onChange(choices.map((item) => (item.id === choice.id ? { ...item, label: event.target.value } : item)))}
            />
            <button type="button" aria-label={`Move ${noun.toLowerCase()} up`} disabled={disabled || index === 0} onClick={() => onChange(arrayMove(choices, index, index - 1))} className="h-9 w-7 text-muted disabled:opacity-30">
              ↑
            </button>
            <button type="button" aria-label={`Remove ${noun.toLowerCase()}`} disabled={disabled} onClick={() => onChange(choices.filter((item) => item.id !== choice.id))} className="h-9 w-7 text-[#b42318]">
              ×
            </button>
          </li>
        ))}
      </ul>
      {!disabled ? (
        <button type="button" onClick={() => onChange([...choices, { id: newChoiceId(), label: `${noun} ${choices.length + 1}` }])} className="mt-1 min-h-9 text-sm font-semibold text-accent">
          + Add {noun.toLowerCase()}
        </button>
      ) : null}
    </div>
  );
}

function RuleRow({ rule, sources, disabled, onChange, onRemove }: { rule: LogicRule; sources: FieldDef[]; disabled: boolean; onChange: (rule: LogicRule) => void; onRemove: () => void }) {
  const source = sources.find((field) => field.id === rule.fieldId);
  const op = LOGIC_OPS.find((item) => item.op === rule.op);
  const choiceList = source?.config.choices;
  const valueControl = !op?.needsValue ? null : source?.type === "yes_no" || source?.type === "consent" ? (
    <select className={control} disabled={disabled} value={String(rule.value)} onChange={(event) => onChange({ ...rule, value: event.target.value === "true" })} aria-label="Value">
      <option value="true">{source.type === "consent" ? "Agreed" : "Yes"}</option>
      <option value="false">{source.type === "consent" ? "Not agreed" : "No"}</option>
    </select>
  ) : choiceList ? (
    <select className={control} disabled={disabled} value={String(rule.value ?? "")} onChange={(event) => onChange({ ...rule, value: event.target.value })} aria-label="Value">
      {choiceList.map((choice) => (
        <option key={choice.id} value={choice.id}>
          {choice.label}
        </option>
      ))}
    </select>
  ) : (
    <input
      className={control}
      disabled={disabled}
      aria-label="Value"
      value={rule.value === null || rule.value === undefined ? "" : String(rule.value)}
      onChange={(event) => {
        const numeric = ["number", "rating", "scale", "nps", "slider", "currency"].includes(source?.type ?? "");
        onChange({ ...rule, value: numeric && event.target.value !== "" && Number.isFinite(Number(event.target.value)) ? Number(event.target.value) : event.target.value });
      }}
    />
  );
  return (
    <div className="space-y-1 rounded-md border border-line bg-canvas p-2">
      <select
        className={control}
        disabled={disabled}
        aria-label="Question"
        value={rule.fieldId}
        onChange={(event) => {
          const next = sources.find((field) => field.id === event.target.value);
          onChange({ ...rule, fieldId: event.target.value, value: defaultRuleValue(next) });
        }}
      >
        {sources.map((field) => (
          <option key={field.id} value={field.id}>
            {(field.label || fieldSpec(field.type)?.label || "Untitled").slice(0, 60)}
          </option>
        ))}
      </select>
      <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_auto] gap-1">
        <select className={control} disabled={disabled} aria-label="Condition" value={rule.op} onChange={(event) => onChange({ ...rule, op: event.target.value as LogicRule["op"] })}>
          {LOGIC_OPS.map((item) => (
            <option key={item.op} value={item.op}>
              {item.label}
            </option>
          ))}
        </select>
        <div className="min-w-0">{valueControl}</div>
        {!disabled ? (
          <button type="button" aria-label="Remove rule" onClick={onRemove} className="h-11 w-8 text-[#b42318]">
            ×
          </button>
        ) : null}
      </div>
    </div>
  );
}

function VisibilityEditor({ field, fields, disabled, onChange }: { field: FieldDef; fields: FieldDef[]; disabled: boolean; onChange: (value: FieldDef["visibility"]) => void }) {
  const sources = ruleSources(fields, field.id);
  const visibility = field.visibility;
  const rules = visibility?.rules ?? [];
  const setRules = (next: LogicRule[]) => onChange(next.length ? { action: visibility?.action ?? "show", match: visibility?.match ?? "all", rules: next } : null);
  return (
    <div className="border-t border-line pt-3">
      <p className={small}>Show or hide</p>
      {!sources.length ? (
        <p className="mt-1 text-xs text-muted">Rules can only use questions above this one.</p>
      ) : (
        <>
          {rules.length ? (
            <div className="mt-2 grid grid-cols-2 gap-1">
              <select className={control} disabled={disabled} aria-label="Show or hide" value={visibility?.action ?? "show"} onChange={(event) => onChange({ ...visibility!, action: event.target.value as "show" | "hide" })}>
                <option value="show">Show only if</option>
                <option value="hide">Hide if</option>
              </select>
              <select className={control} disabled={disabled} aria-label="Match" value={visibility?.match ?? "all"} onChange={(event) => onChange({ ...visibility!, match: event.target.value as "all" | "any" })}>
                <option value="all">all match</option>
                <option value="any">any matches</option>
              </select>
            </div>
          ) : null}
          <div className="mt-2 space-y-2">
            {rules.map((rule, index) => (
              <RuleRow
                key={index}
                rule={rule}
                sources={sources}
                disabled={disabled}
                onChange={(next) => setRules(rules.map((item, i) => (i === index ? next : item)))}
                onRemove={() => setRules(rules.filter((_, i) => i !== index))}
              />
            ))}
          </div>
          {!disabled ? (
            <button
              type="button"
              className="mt-1 min-h-9 text-sm font-semibold text-accent"
              onClick={() => {
                const source = sources.at(-1)!;
                setRules([...rules, { fieldId: source.id, op: "equals", value: defaultRuleValue(source) }]);
              }}
            >
              + Add a condition
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

function SkipEditor({ field, fields, layout, disabled, onChange }: { field: FieldDef; fields: FieldDef[]; layout: FormLayout; disabled: boolean; onChange: (value: FieldDef["skipLogic"]) => void }) {
  const sources = ruleSources(fields, field.id, true);
  const targets = skipTargets(fields, layout, field.id);
  const rules = field.skipLogic?.rules ?? [];
  const setRules = (next: SkipRule[]) => onChange(next.length ? { rules: next } : null);
  return (
    <div className="border-t border-line pt-3">
      <p className={small}>After this page, jump</p>
      <div className="mt-2 space-y-2">
        {rules.map((rule, index) => (
          <div key={index} className="space-y-1">
            <RuleRow
              rule={rule}
              sources={sources}
              disabled={disabled}
              onChange={(next) => setRules(rules.map((item, i) => (i === index ? { ...next, goTo: item.goTo } : item)))}
              onRemove={() => setRules(rules.filter((_, i) => i !== index))}
            />
            <select className={control} disabled={disabled} aria-label="Jump to" value={rule.goTo} onChange={(event) => setRules(rules.map((item, i) => (i === index ? { ...item, goTo: event.target.value } : item)))}>
              <option value={SUBMIT_TARGET}>→ Submit the form</option>
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  → {target.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      {!disabled ? (
        <button type="button" className="mt-1 min-h-9 text-sm font-semibold text-accent" onClick={() => setRules([...rules, { fieldId: field.id, op: "equals", value: defaultRuleValue(field), goTo: targets.at(-1)?.id ?? SUBMIT_TARGET }])}>
          + Add a jump
        </button>
      ) : null}
      <p className="mt-1 text-xs text-muted">Jumps only go forward. First matching rule wins.</p>
    </div>
  );
}

function SettingsPanel({
  settings,
  themes,
  folders,
  canWrite,
  onChange,
}: {
  settings: BuilderSettings;
  themes: { id: string; name: string }[];
  folders: { id: string; name: string }[];
  canWrite: boolean;
  onChange: (value: Partial<BuilderSettings>) => void;
}) {
  const disabled = !canWrite;
  const card = "space-y-3 rounded-xl border border-line bg-white p-4";
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section className={card}>
        <h2 className="font-semibold">Basics</h2>
        <Text label="Title" value={settings.title} disabled={disabled} onChange={(title) => onChange({ title })} />
        <Text label="Internal name (only your team sees this)" value={settings.internalName} disabled={disabled} onChange={(internalName) => onChange({ internalName })} />
        <Text label="Link name (…/f/link-name)" value={settings.slug} disabled={disabled} onChange={(slug) => onChange({ slug })} />
        <Text label="Intro paragraph" multiline value={settings.description} disabled={disabled} onChange={(description) => onChange({ description })} />
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Folder</span>
          <select className={control} disabled={disabled} value={settings.folderId} onChange={(event) => onChange({ folderId: event.target.value })}>
            <option value="">Unfiled</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        </label>
      </section>
      <section className={card}>
        <h2 className="font-semibold">Look and layout</h2>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Theme (logo, colours, privacy link)</span>
          <select className={control} disabled={disabled} value={settings.themeId} onChange={(event) => onChange({ themeId: event.target.value })}>
            <option value="">No theme (cannot publish)</option>
            {themes.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Layout</span>
          <select className={control} disabled={disabled} value={settings.layout} onChange={(event) => onChange({ layout: event.target.value })}>
            <option value="paginated">One question per page</option>
            <option value="single">All on one page (split at page breaks)</option>
          </select>
        </label>
        <Toggle label="Show progress" checked={settings.showProgress} disabled={disabled} onChange={(showProgress) => onChange({ showProgress })} />
        <Toggle label="Move on when a single choice is picked" checked={settings.autoAdvance} disabled={disabled} onChange={(autoAdvance) => onChange({ autoAdvance })} />
        <Text label="Submit button" value={settings.submitLabel} disabled={disabled} onChange={(submitLabel) => onChange({ submitLabel })} />
        <Text label="Disclaimer wording (the privacy link is always added)" multiline value={settings.disclaimerOverride} disabled={disabled} onChange={(disclaimerOverride) => onChange({ disclaimerOverride })} />
      </section>
      <section className={card}>
        <h2 className="font-semibold">After submitting</h2>
        <Text label="Thank-you title" value={settings.confirmTitle} disabled={disabled} onChange={(confirmTitle) => onChange({ confirmTitle })} />
        <Text label="Thank-you message" multiline value={settings.confirmMessage} disabled={disabled} onChange={(confirmMessage) => onChange({ confirmMessage })} />
        <Text label="Then redirect to (optional)" value={settings.redirectUrl} placeholder="https://" disabled={disabled} onChange={(redirectUrl) => onChange({ redirectUrl })} />
      </section>
      <section className={card}>
        <h2 className="font-semibold">Schedule and limits</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Text label="Opens" type="datetime-local" value={settings.opensAt} disabled={disabled} onChange={(opensAt) => onChange({ opensAt })} />
          <Text label="Closes" type="datetime-local" value={settings.closesAt} disabled={disabled} onChange={(closesAt) => onChange({ closesAt })} />
        </div>
        <Toggle label="Publish automatically at the opening time (if the publish checks pass)" checked={settings.autoPublish} disabled={disabled || !settings.opensAt} onChange={(autoPublish) => onChange({ autoPublish })} />
        <p className="-mt-2 text-xs text-muted">Forms also close themselves at the closing time or when they reach the response limit.</p>
        <Text label="Stop after this many responses" type="number" value={settings.responseLimit} disabled={disabled} onChange={(responseLimit) => onChange({ responseLimit })} />
        <Text label="Message when closed" multiline value={settings.closedMessage} disabled={disabled} onChange={(closedMessage) => onChange({ closedMessage })} />
        <Toggle label="Teach the Brain this form's results (aggregates and AI summary only, never answers)" checked={settings.brainSyncEnabled} disabled={disabled} onChange={(brainSyncEnabled) => onChange({ brainSyncEnabled })} />
      </section>
    </div>
  );
}

function EndRulesEditor({ fields, rules, disabled, onChange }: { fields: FieldDef[]; rules: EndRule[]; disabled: boolean; onChange: (rules: EndRule[]) => void }) {
  const sources = fields.filter((field) => fieldSpec(field.type)?.logicUsable);
  const patch = (index: number, value: Partial<EndRule>) => onChange(rules.map((rule, i) => (i === index ? { ...rule, ...value } : rule)));
  const move = (index: number, delta: number) => {
    const to = index + delta;
    if (to >= 0 && to < rules.length) onChange(arrayMove(rules, index, to));
  };
  return (
    <section className="mt-4 space-y-3 rounded-xl border border-line bg-white p-4">
      <div>
        <h2 className="font-semibold">Endings by answer</h2>
        <p className="text-xs text-muted">
          Send people to a different page, or show a different thank-you, depending on their answers. Checked on the server, top to bottom; the first match wins. No match uses the thank-you and redirect above.
        </p>
      </div>
      {!sources.length ? <p className="text-sm text-muted">Add a choice, yes/no, scale or number question to use endings.</p> : null}
      {rules.map((rule, index) => (
        <div key={rule.id} className="space-y-2 rounded-md border border-line bg-canvas p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">Ending {index + 1}</p>
            <select className="pc-control text-sm" disabled={disabled} aria-label="Match" value={rule.match} onChange={(event) => patch(index, { match: event.target.value === "any" ? "any" : "all" })}>
              <option value="all">when all match</option>
              <option value="any">when any matches</option>
            </select>
            {!disabled ? (
              <span className="ml-auto flex gap-1">
                <button type="button" aria-label="Move ending up" onClick={() => move(index, -1)} disabled={index === 0} className="h-9 w-8 rounded text-muted disabled:opacity-30">
                  ↑
                </button>
                <button type="button" aria-label="Move ending down" onClick={() => move(index, 1)} disabled={index === rules.length - 1} className="h-9 w-8 rounded text-muted disabled:opacity-30">
                  ↓
                </button>
                <button type="button" onClick={() => onChange(rules.filter((_, i) => i !== index))} className="min-h-9 rounded-md border border-[#fecdca] px-2 text-xs font-semibold text-[#b42318]">
                  Remove
                </button>
              </span>
            ) : null}
          </div>
          {rule.rules.map((condition, conditionIndex) => (
            <RuleRow
              key={conditionIndex}
              rule={condition}
              sources={sources}
              disabled={disabled}
              onChange={(next) => patch(index, { rules: rule.rules.map((item, i) => (i === conditionIndex ? next : item)) })}
              onRemove={() => patch(index, { rules: rule.rules.filter((_, i) => i !== conditionIndex) })}
            />
          ))}
          {!disabled && sources.length ? (
            <button type="button" className="min-h-9 text-sm font-semibold text-accent" onClick={() => patch(index, { rules: [...rule.rules, { fieldId: sources[0]!.id, op: "equals", value: defaultRuleValue(sources[0]) }] })}>
              + Add a condition
            </button>
          ) : null}
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Then</span>
            <select className={control} disabled={disabled} value={rule.action} onChange={(event) => patch(index, { action: event.target.value === "redirect" ? "redirect" : "message" })}>
              <option value="message">Show this thank-you</option>
              <option value="redirect">Send them to a web page</option>
            </select>
          </label>
          {rule.action === "redirect" ? <Text label="Web address" placeholder="https://" value={rule.url} disabled={disabled} onChange={(url) => patch(index, { url })} /> : null}
          <Text label={rule.action === "redirect" ? "Title shown before the redirect (optional)" : "Thank-you title"} value={rule.title} disabled={disabled} onChange={(title) => patch(index, { title })} />
          <Text label={rule.action === "redirect" ? "Message shown before the redirect (optional)" : "Thank-you message"} multiline value={rule.message} disabled={disabled} onChange={(message) => patch(index, { message })} />
        </div>
      ))}
      {!disabled && sources.length && rules.length < MAX_END_RULES ? (
        <button
          type="button"
          className="min-h-10 rounded-md border border-line px-3 text-sm font-semibold"
          onClick={() => onChange([...rules, { id: newChoiceId(), match: "all", rules: [{ fieldId: sources[0]!.id, op: "equals", value: defaultRuleValue(sources[0]) }], action: "message", url: "", title: "Thank you!", message: "" }])}
        >
          + Add an ending
        </button>
      ) : null}
    </section>
  );
}
