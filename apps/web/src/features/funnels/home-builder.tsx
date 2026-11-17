"use client";

import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  BLOCK_ALIGNS,
  BLOCK_INFO,
  BLOCK_PADDINGS,
  BLOCK_TYPES,
  BLOCK_WIDTHS,
  MAX_BLOCKS,
  blockSummary,
  duplicateBlock,
  moveBlockBy,
  moveBlockTo,
  newBlock,
  removeBlock,
  updateBlock,
  type Block,
  type BlockStyle,
  type BlockType,
} from "../../../../../modules/funnels/blocks";
import { utcToZonedLocal, zonedLocalToUtc } from "../../../../../modules/funnels/time";
import { LivePreview, useDraftSaver } from "./live-preview";
import { RichTextArea } from "./rich-text-area";
import { discardDrafts, saveHomeDraft, saveHomePage, uploadFunnelImage } from "./site-actions";

type Option = { value: string; label: string };
export type HomeBuilderProps = {
  funnelId: string;
  publicPath: string;
  timeZone: string;
  zone: string;
  initial: { blocks: Block[]; shell: boolean; title: string };
  forms: Option[];
  /** The funnel's SMS opt-in forms. */
  smsForms?: Option[];
  modules: Option[];
  pages: Option[];
  hostCount: number;
  canWrite: boolean;
  hasDraft: boolean;
};

const input = "block h-11 w-full min-w-0 rounded-md border border-line bg-white px-3 text-sm text-ink";
const small = "inline-flex min-h-9 items-center justify-center rounded-md border border-line bg-white px-2.5 text-xs font-semibold hover:bg-canvas disabled:opacity-40";

function Labelled({ label, htmlFor, hint, children, className = "" }: { label: string; htmlFor: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function TextInput({ id, label, value, onChange, hint, type = "text", placeholder, className }: { id: string; label: string; value: string; onChange: (value: string) => void; hint?: string; type?: string; placeholder?: string; className?: string }) {
  return (
    <Labelled label={label} htmlFor={id} hint={hint} className={className}>
      <input id={id} type={type} className={input} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </Labelled>
  );
}

function SelectInput({ id, label, value, options, onChange, hint, className }: { id: string; label: string; value: string; options: Option[]; onChange: (value: string) => void; hint?: string; className?: string }) {
  return (
    <Labelled label={label} htmlFor={id} hint={hint} className={className}>
      <select id={id} className="pc-control w-full text-sm" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Labelled>
  );
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (value: boolean) => void; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-accent" />
      <span>
        <span className="font-semibold">{label}</span>
        {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

function ColorOrNone({ id, label, value, onChange, noneLabel }: { id: string; label: string; value: string | null; onChange: (value: string | null) => void; noneLabel: string }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <div className="mt-1 flex items-center gap-2">
        <input id={id} type="color" value={value ?? "#ffffff"} onChange={(event) => onChange(event.target.value)} className="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-line bg-white p-1" style={value ? undefined : { opacity: 0.4 }} />
        {value ? (
          <button type="button" className={small} onClick={() => onChange(null)}>
            {noneLabel}
          </button>
        ) : (
          <span className="text-xs text-muted">{noneLabel}</span>
        )}
      </div>
    </div>
  );
}

const cap = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

function StyleFields({ block, set }: { block: Block; set: (style: Partial<BlockStyle>) => void }) {
  const id = (name: string) => `${block.id}-style-${name}`;
  return (
    <fieldset className="rounded-lg border border-line p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">Style</legend>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <ColorOrNone id={id("bg")} label="Background" value={block.style.bg} onChange={(bg) => set({ bg })} noneLabel="Page colour" />
        <ColorOrNone id={id("text")} label="Text" value={block.style.text} onChange={(text) => set({ text })} noneLabel="Page text" />
        <SelectInput id={id("padding")} label="Padding" value={block.style.padding} options={BLOCK_PADDINGS.map((value) => ({ value, label: cap(value) }))} onChange={(padding) => set({ padding: padding as BlockStyle["padding"] })} />
        <SelectInput id={id("width")} label="Width" value={block.style.width} options={BLOCK_WIDTHS.map((value) => ({ value, label: cap(value) }))} onChange={(width) => set({ width: width as BlockStyle["width"] })} />
        <SelectInput id={id("align")} label="Align" value={block.style.align} options={BLOCK_ALIGNS.map((value) => ({ value, label: cap(value) }))} onChange={(align) => set({ align: align as BlockStyle["align"] })} />
      </div>
    </fieldset>
  );
}

function targetOptions(props: HomeBuilderProps): Option[] {
  return [{ value: "", label: "A web address…" }, ...props.modules.map((item) => ({ value: `module:${item.value}`, label: `Module: ${item.label}` })), ...props.pages.map((item) => ({ value: `page:${item.value}`, label: `Page: ${item.label}` }))];
}

function TargetField({ id, label, value, onChange, props }: { id: string; label: string; value: string; onChange: (value: string) => void; props: HomeBuilderProps }) {
  const options = targetOptions(props);
  const internal = options.some((option) => option.value && option.value === value);
  const [custom, setCustom] = useState(!internal);
  return (
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <SelectInput
        id={`${id}-kind`}
        label={label}
        value={custom ? "" : value}
        options={options}
        onChange={(next) => {
          setCustom(next === "");
          onChange(next === "" ? "" : next);
        }}
      />
      {custom ? <TextInput id={id} label="Web address" type="url" value={value} placeholder="https://" onChange={onChange} /> : null}
    </div>
  );
}

function ImageField({ block, set, funnelId, publicPath }: { block: Extract<Block, { type: "image" }>; set: (patch: Record<string, unknown>) => void; funnelId: string; publicPath: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = block.assetId ? `${publicPath}/asset/${block.assetId}` : block.src;
  return (
    <div className="grid min-w-0 gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
      <div className="flex h-24 w-full items-center justify-center overflow-hidden rounded-md border border-line bg-canvas sm:w-[120px]">{preview ? <img src={preview} alt="" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-muted">No image</span>}</div>
      <div className="min-w-0 space-y-2">
        <label className="text-sm font-medium" htmlFor={`${block.id}-file`}>
          Upload
        </label>
        <input
          id={`${block.id}-file`}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          disabled={busy}
          className="block w-full text-sm"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setBusy(true);
            setError(null);
            const body = new FormData();
            body.set("funnelId", funnelId);
            body.set("kind", "block");
            body.set("file", file);
            const result = await uploadFunnelImage(body);
            setBusy(false);
            if (result.ok) set({ assetId: result.id, src: "" });
            else setError(result.error);
          }}
        />
        {error ? <p className="text-xs text-[#912018]">{error}</p> : null}
        <TextInput id={`${block.id}-src`} label="…or image link (https)" value={block.src} onChange={(src) => set({ src, assetId: "" })} placeholder="https://" />
      </div>
    </div>
  );
}

function BlockFields({ block, set, props }: { block: Block; set: (patch: Record<string, unknown>) => void; props: HomeBuilderProps }) {
  const id = (name: string) => `${block.id}-${name}`;
  const local = (iso: string) => (iso ? utcToZonedLocal(new Date(iso), props.timeZone) : "");
  const fromLocal = (value: string) => zonedLocalToUtc(value, props.timeZone)?.toISOString() ?? "";
  switch (block.type) {
    case "headline":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput id={id("eyebrow")} label="Eyebrow" hint="Small line above the headline." value={block.eyebrow} onChange={(eyebrow) => set({ eyebrow })} />
          <span className="hidden sm:block" />
          <TextInput id={id("heading")} label="Headline" value={block.heading} onChange={(heading) => set({ heading })} />
          <TextInput id={id("accent")} label="Accent part" hint="Shown after the headline in the accent colour." value={block.accent} onChange={(accent) => set({ accent })} />
          <Labelled label="Subhead" htmlFor={id("sub")} className="sm:col-span-2">
            <textarea id={id("sub")} rows={2} className="block w-full rounded-md border border-line px-3 py-2 text-sm" value={block.sub} onChange={(event) => set({ sub: event.target.value })} />
          </Labelled>
        </div>
      );
    case "text":
      return <RichTextArea funnelId={props.funnelId} id={id("html")} value={block.html} onChange={(html) => set({ html })} rows={8} />;
    case "event":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput id={id("eyebrow")} label="Eyebrow" value={block.eyebrow} onChange={(eyebrow) => set({ eyebrow })} />
          <TextInput id={id("title")} label="Title" hint="Empty = the funnel name." value={block.title} onChange={(title) => set({ title })} />
          <TextInput id={id("at")} label={`Date and time (${props.zone})`} type="datetime-local" hint="Empty = the funnel start." value={local(block.at)} onChange={(value) => set({ at: fromLocal(value) })} />
          <TextInput id={id("minutes")} label="Length (minutes)" type="number" value={String(block.minutes)} onChange={(value) => set({ minutes: Number(value) || 60 })} />
          <TextInput id={id("when")} label="Date line" hint="Optional text instead of the formatted date." value={block.when} onChange={(when) => set({ when })} className="sm:col-span-2" />
          <Toggle label="Show a countdown" checked={block.countdown} onChange={(countdown) => set({ countdown })} />
          <Toggle label="Add to calendar buttons" hint="Google Calendar and an .ics file, in the organization's time zone." checked={block.calendar} onChange={(calendar) => set({ calendar })} />
        </div>
      );
    case "countdown":
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <TextInput id={id("heading")} label="Heading" value={block.heading} onChange={(heading) => set({ heading })} />
          <SelectInput
            id={id("target")}
            label="Counts down to"
            value={block.target}
            options={[
              { value: "start", label: "The funnel start" },
              { value: "end", label: "The funnel close" },
              { value: "custom", label: "A set time" },
            ]}
            onChange={(target) => set({ target })}
          />
          {block.target === "custom" ? <TextInput id={id("at")} label={`Time (${props.zone})`} type="datetime-local" value={local(block.at)} onChange={(value) => set({ at: fromLocal(value) })} /> : null}
        </div>
      );
    case "agenda":
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <TextInput id={id("heading")} label="Heading" value={block.heading} onChange={(heading) => set({ heading })} />
          <SelectInput
            id={id("layout")}
            label="Layout"
            value={block.layout}
            options={[
              { value: "cards", label: "Thumbnail cards" },
              { value: "list", label: "List" },
            ]}
            onChange={(layout) => set({ layout })}
          />
          <div className="pt-6">
            <Toggle label="Link open modules" checked={block.linkModules} onChange={(linkModules) => set({ linkModules })} />
          </div>
          <p className="text-xs text-muted sm:col-span-3">Built from the modules (Days tab) and placeholders marked “list in the agenda” (Pages & links).</p>
        </div>
      );
    case "optin":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput id={id("heading")} label="Heading" value={block.heading} onChange={(heading) => set({ heading })} />
          <SelectInput
            id={id("mode")}
            label="Collect with"
            value={block.mode}
            options={[
              { value: "email", label: "Simple email capture" },
              { value: "form", label: "A published form" },
              { value: "sms", label: "An SMS opt-in form" },
            ]}
            onChange={(mode) => set({ mode })}
          />
          {block.mode === "sms" ? (
            <SelectInput id={id("sms")} label="SMS form" hint={props.smsForms?.length ? "Phone + consent, built on the SMS forms tab." : "Add an SMS form on the SMS forms tab first."} value={block.smsFormId} options={[{ value: "", label: "Pick an SMS form" }, ...(props.smsForms ?? [])]} onChange={(smsFormId) => set({ smsFormId })} />
          ) : block.mode === "form" ? (
            <SelectInput id={id("form")} label="Form" hint={props.forms.length ? "Responses are stored in Forms." : "No published forms for this brand yet."} value={block.formSlug} options={[{ value: "", label: "Pick a form" }, ...props.forms]} onChange={(formSlug) => set({ formSlug })} />
          ) : (
            <TextInput id={id("button")} label="Button text" value={block.buttonText} onChange={(buttonText) => set({ buttonText })} />
          )}
          <Labelled label="Intro" htmlFor={id("intro")} className="sm:col-span-2">
            <textarea id={id("intro")} rows={2} className="block w-full rounded-md border border-line px-3 py-2 text-sm" value={block.intro} onChange={(event) => set({ intro: event.target.value })} />
          </Labelled>
        </div>
      );
    case "hosts":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput id={id("heading")} label="Heading" value={block.heading} onChange={(heading) => set({ heading })} />
          <SelectInput
            id={id("layout")}
            label="Layout"
            value={block.layout}
            options={[
              { value: "grid", label: "Grid" },
              { value: "stacked", label: "Stacked" },
            ]}
            onChange={(layout) => set({ layout })}
          />
          <p className="text-xs text-muted sm:col-span-2">{props.hostCount ? `Shows the ${props.hostCount} host${props.hostCount === 1 ? "" : "s"} from the Hosts tab.` : "Add hosts on the Hosts tab; this block stays hidden until then."}</p>
        </div>
      );
    case "button":
      return (
        <div className="space-y-3">
          <TextInput id={id("label")} label="Button text" value={block.label} onChange={(label) => set({ label })} />
          <TargetField id={id("target")} label="Goes to" value={block.target} onChange={(target) => set({ target })} props={props} />
          <Toggle label="Open web addresses in a new tab" checked={block.newTab} onChange={(newTab) => set({ newTab })} />
        </div>
      );
    case "image":
      return (
        <div className="space-y-3">
          <ImageField block={block} set={set} funnelId={props.funnelId} publicPath={props.publicPath} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput id={id("alt")} label="Description (alt text)" value={block.alt} onChange={(alt) => set({ alt })} />
            <TextInput id={id("width")} label="Width (%)" type="number" value={String(block.widthPercent)} onChange={(value) => set({ widthPercent: Number(value) || 100 })} />
          </div>
          <TargetField id={id("href")} label="Link (optional)" value={block.href} onChange={(href) => set({ href })} props={props} />
        </div>
      );
    case "html":
      return (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput id={id("title")} label="Name (for screen readers)" value={block.title} onChange={(title) => set({ title })} />
            <TextInput id={id("height")} label="Height (px)" type="number" hint="0 = fit the content." value={String(block.height)} onChange={(value) => set({ height: Number(value) || 0 })} />
          </div>
          <Labelled label="HTML" htmlFor={id("html")} hint="Runs in a sandbox: scripts and forms work, but cannot reach the page or its visitors' cookies.">
            <textarea id={id("html")} rows={8} spellCheck={false} className="block w-full rounded-md border border-line px-3 py-2 font-mono text-[12.5px]" value={block.html} onChange={(event) => set({ html: event.target.value })} />
          </Labelled>
        </div>
      );
    case "divider":
      return <p className="text-sm text-muted">A thin line. Use the style below for spacing.</p>;
  }
}

function BlockCard({
  block,
  index,
  count,
  open,
  toggle,
  props,
  onChange,
  onStyle,
  onMove,
  onDuplicate,
  onRemove,
}: {
  block: Block;
  index: number;
  count: number;
  open: boolean;
  toggle: () => void;
  props: HomeBuilderProps;
  onChange: (patch: Record<string, unknown>) => void;
  onStyle: (patch: Partial<BlockStyle>) => void;
  onMove: (delta: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const sortable = useSortable({ id: block.id, disabled: !props.canWrite });
  const style = { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition, zIndex: sortable.isDragging ? 10 : undefined };
  return (
    <li ref={sortable.setNodeRef} style={style} className={`rounded-xl border bg-white ${sortable.isDragging ? "border-accent shadow-lg" : "border-line"}`} id={`block-${block.id}`}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        {props.canWrite ? (
          <button type="button" className="flex h-9 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted hover:bg-canvas" aria-label={`Drag to reorder ${BLOCK_INFO[block.type].label}`} {...sortable.attributes} {...sortable.listeners}>
            <svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true">
              <circle cx="7" cy="5" r="1.5" />
              <circle cx="13" cy="5" r="1.5" />
              <circle cx="7" cy="10" r="1.5" />
              <circle cx="13" cy="10" r="1.5" />
              <circle cx="7" cy="15" r="1.5" />
              <circle cx="13" cy="15" r="1.5" />
            </svg>
          </button>
        ) : null}
        <button type="button" onClick={toggle} className="min-w-0 flex-1 text-left" aria-expanded={open}>
          <span className="block text-xs font-semibold uppercase tracking-wider text-muted">
            {index + 1}. {BLOCK_INFO[block.type].label}
          </span>
          <span className="block truncate text-sm font-semibold">{blockSummary(block)}</span>
        </button>
        {props.canWrite ? (
          <div className="flex shrink-0 flex-wrap justify-end gap-1">
            <button type="button" className={small} onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move up">
              ↑
            </button>
            <button type="button" className={small} onClick={() => onMove(1)} disabled={index === count - 1} aria-label="Move down">
              ↓
            </button>
            <button type="button" className={`${small} hidden sm:inline-flex`} onClick={onDuplicate} disabled={count >= MAX_BLOCKS}>
              Duplicate
            </button>
            <button type="button" className={`${small} sm:hidden`} onClick={onDuplicate} disabled={count >= MAX_BLOCKS} aria-label="Duplicate">
              ⧉
            </button>
            <button type="button" className={`${small} text-[#912018]`} onClick={onRemove} aria-label="Delete block">
              ✕
            </button>
          </div>
        ) : null}
      </div>
      {open ? (
        <fieldset disabled={!props.canWrite} className="space-y-3 border-t border-line p-3">
          <BlockFields block={block} set={onChange} props={props} />
          <StyleFields block={block} set={onStyle} />
        </fieldset>
      ) : null}
    </li>
  );
}

/** The Home page tab: ordered blocks with drag, up/down, duplicate and delete, and a live preview. */
export function HomeBuilder(props: HomeBuilderProps) {
  const router = useRouter();
  const [blocks, setBlocks] = useState<Block[]>(props.initial.blocks);
  const [shell, setShell] = useState(props.initial.shell);
  const [title, setTitle] = useState(props.initial.title);
  const [open, setOpen] = useState<string | null>(null);
  const [dirty, setDirty] = useState(props.hasDraft);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const draft = useDraftSaver((payload: { blocks: Block[]; shell: boolean; title: string }) => saveHomeDraft(props.funnelId, payload));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const commit = (next: { blocks?: Block[]; shell?: boolean; title?: string }) => {
    const state = { blocks: next.blocks ?? blocks, shell: next.shell ?? shell, title: next.title ?? title };
    if (next.blocks) setBlocks(next.blocks);
    if (next.shell !== undefined) setShell(next.shell);
    if (next.title !== undefined) setTitle(next.title);
    setDirty(true);
    setMessage(null);
    draft.queue(state);
  };

  const add = (type: BlockType) => {
    const block = newBlock(type);
    commit({ blocks: [...blocks, block] });
    setOpen(block.id);
    requestAnimationFrame(() => document.getElementById(`block-${block.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    commit({ blocks: moveBlockTo(blocks, String(active.id), blocks.findIndex((block) => block.id === over.id)) });
  };

  const save = async () => {
    draft.cancel();
    setSaving(true);
    const result = await saveHomePage(props.funnelId, { blocks, shell, title });
    setSaving(false);
    if (result.ok) {
      setDirty(false);
      setMessage({ kind: "ok", text: "Saved. The home page is updated." });
      router.refresh();
    } else setMessage({ kind: "error", text: result.error });
  };

  const discard = async () => {
    await discardDrafts(props.funnelId, "home");
    window.location.reload();
  };

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <section className="rounded-xl border border-line bg-white p-4">
          <h2 className="text-base font-semibold">Home page</h2>
          <p className="mt-1 text-sm text-muted">Visitors to this microsite's link (or custom domain) land here. The modules and pages sit around it, and the close page takes over when the funnel closes.</p>
          <fieldset disabled={!props.canWrite} className="mt-3 grid gap-3 sm:grid-cols-2">
            <Toggle label="Show the site header and module navigation above the blocks" checked={shell} onChange={(value) => commit({ shell: value })} />
            <TextInput id="home-title" label="Browser title" hint="Empty = the funnel name." value={title} onChange={(value) => commit({ title: value })} />
          </fieldset>
        </section>

        {props.canWrite ? (
          <section className="rounded-xl border border-line bg-white p-4">
            <h3 className="text-sm font-semibold">Add a block</h3>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {BLOCK_TYPES.map((type) => (
                <button key={type} type="button" disabled={blocks.length >= MAX_BLOCKS} onClick={() => add(type)} className="min-h-14 rounded-lg border border-line bg-white px-3 py-2 text-left hover:border-accent hover:bg-canvas disabled:opacity-40">
                  <span className="block text-sm font-semibold">+ {BLOCK_INFO[type].label}</span>
                  <span className="block text-xs leading-snug text-muted">{BLOCK_INFO[type].description}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <DndContext id="home-blocks" sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={onDragEnd}>
          <SortableContext items={blocks.map((block) => block.id)} strategy={verticalListSortingStrategy}>
            <ol className="space-y-2" aria-label="Home page blocks">
              {blocks.map((block, index) => (
                <BlockCard
                  key={block.id}
                  block={block}
                  index={index}
                  count={blocks.length}
                  open={open === block.id}
                  toggle={() => setOpen(open === block.id ? null : block.id)}
                  props={props}
                  onChange={(patch) => commit({ blocks: updateBlock(blocks, block.id, patch) })}
                  onStyle={(patch) => commit({ blocks: updateBlock(blocks, block.id, { style: { ...block.style, ...patch } }) })}
                  onMove={(delta) => commit({ blocks: moveBlockBy(blocks, block.id, delta) })}
                  onDuplicate={() => commit({ blocks: duplicateBlock(blocks, block.id) })}
                  onRemove={() => {
                    if (window.confirm(`Delete this ${BLOCK_INFO[block.type].label} block?`)) commit({ blocks: removeBlock(blocks, block.id) });
                  }}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
        {blocks.length === 0 ? <p className="rounded-xl border border-dashed border-line bg-white p-6 text-center text-sm text-muted">No blocks yet. Add a headline to start.</p> : null}

        {props.canWrite ? (
          <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white/95 p-3 shadow-sm backdrop-blur">
            <button type="button" onClick={save} disabled={saving} className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-semibold text-white disabled:opacity-60">
              {saving ? "Saving…" : "Save home page"}
            </button>
            {dirty ? (
              <button type="button" onClick={discard} className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-4 text-sm font-semibold">
                Discard changes
              </button>
            ) : null}
            <span className={`text-sm ${message?.kind === "error" ? "text-[#912018]" : message ? "text-[#067647]" : "text-muted"}`} role="status">
              {message?.text ?? (dirty ? "Unsaved changes." : "All changes saved.")}
            </span>
          </div>
        ) : null}
      </div>
      <div className="min-w-0 xl:sticky xl:top-4 xl:self-start">
        <LivePreview src={props.publicPath} version={draft.version} status={draft.status} />
      </div>
    </div>
  );
}
