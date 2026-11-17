"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  ACTIVE_STYLES,
  ALIGNS,
  BUTTON_STYLES,
  FONTS,
  FONT_KEYS,
  GRADIENT_DIRS,
  HEADER_WIDTHS,
  IMAGE_FITS,
  IMAGE_POSITIONS,
  LOCKED_STYLES,
  LOGO_LINKS,
  NAV_FADES,
  THUMB_STYLES,
  type Design,
  type FooterLink,
} from "../../../../../modules/funnels/design";
import { LivePreview, useDraftSaver } from "./live-preview";
import { RichTextArea } from "./rich-text-area";
import { discardDrafts, saveDesign, saveDesignDraft, uploadFunnelImage } from "./site-actions";

export type DesignPayload = {
  design: Design;
  logoAssetId: string | null;
  logoUrl: string | null;
  companyName: string;
  privacyUrl: string | null;
  termsUrl: string | null;
  footerHtml: string;
  formThemeId: string | null;
};

type Option = { value: string; label: string };
const input = "block h-11 w-full min-w-0 rounded-md border border-line bg-white px-3 text-sm text-ink";
const small = "inline-flex min-h-9 items-center justify-center rounded-md border border-line bg-white px-2.5 text-xs font-semibold hover:bg-canvas disabled:opacity-40";

const LABELS: Record<string, string> = {
  "to right": "Left to right",
  "to bottom": "Top to bottom",
  "135deg": "Diagonal ↘",
  "45deg": "Diagonal ↗",
  fill: "Fill (crop to cover)",
  fit: "Fit (whole image)",
  tile: "Tile (repeat)",
  standard: "Standard (960px)",
  wide: "Wide (1280px)",
  full: "Full width",
  none: "Not a link",
  home: "The home page / front door",
  url: "A web address",
  outline: "Outline",
  rounded: "Rounded",
  square: "Square",
  pill: "Pill",
  ring: "Accent ring",
  underline: "Accent underline",
  bold: "Bold accent label",
  lock_dim: "Lock icon and faded",
  lock: "Lock icon only",
  dim: "Faded only",
  others: "Fade every tile but the current one",
  locked: "Fade locked tiles only",
};
const label = (value: string) => LABELS[value] ?? value.charAt(0).toUpperCase() + value.slice(1);
const options = (values: readonly string[]): Option[] => values.map((value) => ({ value, label: label(value) }));

function Field({ id, title, hint, children, className = "" }: { id: string; title: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {title}
      </label>
      <div className="mt-1">{children}</div>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function Select({ id, title, value, values, onChange, hint }: { id: string; title: string; value: string; values: Option[]; onChange: (value: string) => void; hint?: string }) {
  return (
    <Field id={id} title={title} hint={hint}>
      <select id={id} className="pc-control w-full text-sm" value={value} onChange={(event) => onChange(event.target.value)}>
        {values.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

function Num({ id, title, value, min, max, onChange, hint }: { id: string; title: string; value: number; min: number; max: number; onChange: (value: number) => void; hint?: string }) {
  return (
    <Field id={id} title={title} hint={hint}>
      <input id={id} type="number" min={min} max={max} className={input} value={value} onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.target.value) || 0)))} />
    </Field>
  );
}

function Text({ id, title, value, onChange, hint, type = "text", placeholder }: { id: string; title: string; value: string; onChange: (value: string) => void; hint?: string; type?: string; placeholder?: string }) {
  return (
    <Field id={id} title={title} hint={hint}>
      <input id={id} type={type} className={input} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

/** A colour; `optional` adds a "not set" state shown with `unsetLabel`. */
function Color({ id, title, value, onChange, optional, unsetLabel = "Automatic" }: { id: string; title: string; value: string | null; onChange: (value: string | null) => void; optional?: boolean; unsetLabel?: string }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {title}
      </label>
      <div className="mt-1 flex items-center gap-2">
        <input id={id} type="color" value={value ?? "#ffffff"} onChange={(event) => onChange(event.target.value)} className="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-line bg-white p-1" style={value ? undefined : { opacity: 0.35 }} />
        <span className="min-w-0 truncate font-mono text-xs text-muted">{value ?? unsetLabel}</span>
        {optional && value ? (
          <button type="button" className={`${small} shrink-0 whitespace-nowrap`} onClick={() => onChange(null)} aria-label={`Clear ${title}`}>
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Check({ title, checked, onChange, hint }: { title: string; checked: boolean; onChange: (value: boolean) => void; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-accent" />
      <span>
        <span className="font-semibold">{title}</span>
        {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

function Card({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-white p-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

/** Upload or link an image. `assetId` wins over `url`. */
function ImagePick({ id, title, funnelId, publicPath, kind, assetId, url, onAsset, onUrl, hint }: { id: string; title: string; funnelId: string; publicPath: string; kind: string; assetId: string | null; url: string | null; onAsset: (id: string | null) => void; onUrl: (url: string | null) => void; hint?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = assetId ? `${publicPath}/asset/${assetId}` : url;
  return (
    <div className="min-w-0">
      <p className="text-sm font-medium text-ink">{title}</p>
      <div className="mt-1 grid min-w-0 gap-2 sm:grid-cols-[96px_minmax(0,1fr)]">
        <div className="flex h-16 w-24 items-center justify-center overflow-hidden rounded-md border border-line bg-[repeating-conic-gradient(#f3f4f6_0_25%,#fff_0_50%)] bg-[length:12px_12px]">{preview ? <img src={preview} alt="" className="max-h-full max-w-full object-contain" /> : <span className="text-[11px] text-muted">None</span>}</div>
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`${id}-file`} className={`${small} cursor-pointer`}>
              {busy ? "Uploading…" : "Upload"}
            </label>
            <input
              id={`${id}-file`}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="sr-only"
              disabled={busy}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                setBusy(true);
                setError(null);
                const body = new FormData();
                body.set("funnelId", funnelId);
                body.set("kind", kind);
                body.set("file", file);
                const result = await uploadFunnelImage(body);
                setBusy(false);
                if (result.ok) onAsset(result.id);
                else setError(result.error);
              }}
            />
            {preview ? (
              <button
                type="button"
                className={small}
                onClick={() => {
                  onAsset(null);
                  onUrl(null);
                }}
              >
                Remove
              </button>
            ) : null}
          </div>
          <input aria-label={`${title} link`} type="url" placeholder="…or https:// link" className={input} value={assetId ? "" : (url ?? "")} onChange={(event) => onUrl(event.target.value || null)} disabled={Boolean(assetId)} />
          {error ? <p className="text-xs text-[#912018]">{error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
        </div>
      </div>
    </div>
  );
}

function LinksEditor({ links, onChange }: { links: FooterLink[]; onChange: (links: FooterLink[]) => void }) {
  const rows = links.length ? links : [];
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Footer links</p>
      {rows.map((link, index) => (
        <div key={index} className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
          <input aria-label={`Link ${index + 1} label`} className={input} value={link.label} placeholder="Label" onChange={(event) => onChange(rows.map((row, at) => (at === index ? { ...row, label: event.target.value } : row)))} />
          <input aria-label={`Link ${index + 1} address`} className={input} type="url" value={link.url} placeholder="https://" onChange={(event) => onChange(rows.map((row, at) => (at === index ? { ...row, url: event.target.value } : row)))} />
          <button type="button" className={small} onClick={() => onChange(rows.filter((_, at) => at !== index))}>
            Remove
          </button>
        </div>
      ))}
      {rows.length < 8 ? (
        <button type="button" className={small} onClick={() => onChange([...rows, { label: "", url: "" }])}>
          + Add a link
        </button>
      ) : null}
    </div>
  );
}

/** The Design tab: header, page, content box, navigation tiles and footer, with a live preview of unsaved changes. */
export function DesignEditor({
  funnelId,
  publicPath,
  initial,
  themes,
  previewPaths,
  canWrite,
  hasDraft,
  copyForm,
}: {
  funnelId: string;
  publicPath: string;
  initial: DesignPayload;
  themes: Option[];
  previewPaths: { label: string; path: string }[];
  canWrite: boolean;
  hasDraft: boolean;
  copyForm: ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = useState<DesignPayload>(initial);
  const [dirty, setDirty] = useState(hasDraft);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const draft = useDraftSaver((payload: DesignPayload) => saveDesignDraft(funnelId, payload));
  const d = state.design;

  const update = (next: DesignPayload) => {
    setState(next);
    setDirty(true);
    setMessage(null);
    draft.queue(next);
  };
  const set = <K extends keyof Design>(group: K, patch: Partial<Design[K]>) => update({ ...state, design: { ...d, [group]: { ...d[group], ...patch } } });
  const top = (patch: Partial<DesignPayload>) => update({ ...state, ...patch });

  const save = async () => {
    draft.cancel();
    setSaving(true);
    const result = await saveDesign(funnelId, state);
    setSaving(false);
    if (result.ok) {
      setDirty(false);
      setMessage({ kind: "ok", text: "Saved. Every page of this funnel uses the new design." });
      router.refresh();
    } else setMessage({ kind: "error", text: result.error });
  };

  const themed = Boolean(state.formThemeId);
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <fieldset disabled={!canWrite} className="min-w-0 space-y-4">
          <Card title="Start from" description="Borrow the logo, header colour, accent and privacy link from a Forms theme, or copy another funnel's whole design.">
            <Select
              id="formThemeId"
              title="Forms theme"
              value={state.formThemeId ?? ""}
              values={[{ value: "", label: "None: use this funnel's own design" }, ...themes]}
              onChange={(value) => top({ formThemeId: value || null })}
              hint={themed ? "The theme's logo, header colour, accent and privacy link win over the matching fields below." : themes.length ? undefined : "No Forms themes for this brand yet."}
            />
          </Card>

          <Card title="Header">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Color id="h-bg" title="Background" value={d.header.bg} onChange={(bg) => set("header", { bg: bg ?? "#111827" })} />
              <Color id="h-bg2" title="Gradient to (optional)" value={d.header.bg2} optional unsetLabel="No gradient" onChange={(bg2) => set("header", { bg2 })} />
              <Select id="h-dir" title="Gradient direction" value={d.header.gradientDir} values={options(GRADIENT_DIRS)} onChange={(value) => set("header", { gradientDir: value as Design["header"]["gradientDir"] })} />
            </div>
            <ImagePick id="h-img" title="Background image (optional)" funnelId={funnelId} publicPath={publicPath} kind="header_bg" assetId={d.header.imageAssetId} url={d.header.imageUrl} onAsset={(imageAssetId) => set("header", { imageAssetId })} onUrl={(imageUrl) => set("header", { imageUrl, imageAssetId: null })} hint="Drawn behind the logo, under the header colour." />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Select id="h-fit" title="Image fit" value={d.header.imageFit} values={options(IMAGE_FITS)} onChange={(value) => set("header", { imageFit: value as Design["header"]["imageFit"] })} />
              <Select id="h-pos" title="Image position" value={d.header.imagePos} values={options(IMAGE_POSITIONS)} onChange={(value) => set("header", { imagePos: value as Design["header"]["imagePos"] })} />
              <Num id="h-dim" title="Colour over image (%)" value={d.header.dim} min={0} max={100} onChange={(dim) => set("header", { dim })} hint="0 = image only, 100 = solid colour." />
              <Num id="h-pad" title="Padding (px)" value={d.header.paddingY} min={0} max={120} onChange={(paddingY) => set("header", { paddingY })} hint="Above and below the logo." />
              <Select id="h-width" title="Content width" value={d.header.width} values={options(HEADER_WIDTHS)} onChange={(value) => set("header", { width: value as Design["header"]["width"] })} />
            </div>
            <ImagePick id="h-logo" title="Logo" funnelId={funnelId} publicPath={publicPath} kind="logo" assetId={state.logoAssetId} url={state.logoUrl} onAsset={(logoAssetId) => top({ logoAssetId })} onUrl={(logoUrl) => top({ logoUrl, logoAssetId: null })} hint={themed ? "The Forms theme's logo is used while a theme is set." : "PNG, JPG, WebP or GIF up to 3 MB. No logo = the brand name in text."} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Num id="h-lh" title="Logo height (px)" value={d.header.logoHeight} min={16} max={240} onChange={(logoHeight) => set("header", { logoHeight })} />
              <Num id="h-lhm" title="On phones (px)" value={d.header.logoHeightMobile} min={0} max={200} onChange={(logoHeightMobile) => set("header", { logoHeightMobile })} hint="0 = automatic." />
              <Select id="h-align" title="Logo position" value={d.header.logoAlign} values={options(ALIGNS)} onChange={(value) => set("header", { logoAlign: value as Design["header"]["logoAlign"] })} />
              <Select id="h-link" title="Logo click goes to" value={d.header.logoLink} values={options(LOGO_LINKS)} onChange={(value) => set("header", { logoLink: value as Design["header"]["logoLink"] })} />
              {d.header.logoLink === "url" ? <Text id="h-link-url" title="Logo link" type="url" placeholder="https://" value={d.header.logoLinkUrl ?? ""} onChange={(value) => set("header", { logoLinkUrl: value || null })} /> : null}
            </div>
          </Card>

          <Card title="Page">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Color id="p-bg" title="Background" value={d.page.bg} onChange={(bg) => set("page", { bg: bg ?? "#f5f6f8" })} />
              <Color id="p-text" title="Text" value={d.page.text} onChange={(text) => set("page", { text: text ?? "#1f2937" })} />
              <Color id="p-accent" title="Accent" value={d.page.accent} onChange={(accent) => set("page", { accent: accent ?? "#1d4ed8" })} />
              <Color id="p-btext" title="Button text" value={d.page.buttonText} optional onChange={(buttonText) => set("page", { buttonText })} />
            </div>
            <p className="text-xs text-muted">The accent colours buttons, the active module and accent words in headlines.</p>
            <ImagePick id="p-img" title="Background image (optional)" funnelId={funnelId} publicPath={publicPath} kind="page_bg" assetId={d.page.imageAssetId} url={d.page.imageUrl} onAsset={(imageAssetId) => set("page", { imageAssetId })} onUrl={(imageUrl) => set("page", { imageUrl, imageAssetId: null })} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Num id="p-radius" title="Button corner radius (px)" value={d.page.buttonRadius} min={0} max={40} onChange={(buttonRadius) => set("page", { buttonRadius })} />
              <Select id="p-bstyle" title="Button style" value={d.page.buttonStyle} values={options(BUTTON_STYLES)} onChange={(value) => set("page", { buttonStyle: value as Design["page"]["buttonStyle"] })} />
              <Select id="p-font" title="Font" value={d.page.font} values={FONT_KEYS.map((key) => ({ value: key, label: FONTS[key].label }))} onChange={(value) => set("page", { font: value as Design["page"]["font"] })} hint="Web fonts load only when chosen." />
            </div>
          </Card>

          <Card title="Content box" description="Text modules, notes under videos, custom pages, agenda cards and host cards.">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Color id="c-bg" title="Background" value={d.content.bg} onChange={(bg) => set("content", { bg: bg ?? "#ffffff" })} />
              <Color id="c-text" title="Text" value={d.content.text} optional unsetLabel="Page text" onChange={(text) => set("content", { text })} />
              <Color id="c-link" title="Links" value={d.content.link} optional unsetLabel="Accent" onChange={(link) => set("content", { link })} />
              <Color id="c-border" title="Border" value={d.content.border} onChange={(border) => set("content", { border: border ?? "#e5e7eb" })} />
              <Num id="c-bw" title="Border width (px)" value={d.content.borderWidth} min={0} max={8} onChange={(borderWidth) => set("content", { borderWidth })} />
              <Num id="c-radius" title="Corner radius (px)" value={d.content.radius} min={0} max={40} onChange={(radius) => set("content", { radius })} />
              <Num id="c-pad" title="Padding (px)" value={d.content.padding} min={0} max={64} onChange={(padding) => set("content", { padding })} />
            </div>
          </Card>

          <Card title="Navigation tiles" description="The strip of module thumbnails, pages and links.">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Color id="n-bg" title="Strip background" value={d.nav.bg} optional unsetLabel="Page" onChange={(bg) => set("nav", { bg })} />
              <Color id="n-text" title="Tile text" value={d.nav.text} optional unsetLabel="Page text" onChange={(text) => set("nav", { text })} />
              <Num id="n-w" title="Thumbnail width (px)" value={d.nav.thumbWidth} min={80} max={320} onChange={(thumbWidth) => set("nav", { thumbWidth })} />
              <Select id="n-shape" title="Thumbnail shape" value={d.nav.thumbStyle} values={options(THUMB_STYLES)} onChange={(value) => set("nav", { thumbStyle: value as Design["nav"]["thumbStyle"] })} />
              <Select id="n-active" title="Current tile" value={d.nav.activeStyle} values={options(ACTIVE_STYLES)} onChange={(value) => set("nav", { activeStyle: value as Design["nav"]["activeStyle"] })} />
              <Select id="n-locked" title="Locked tiles" value={d.nav.lockedStyle} values={options(LOCKED_STYLES)} onChange={(value) => set("nav", { lockedStyle: value as Design["nav"]["lockedStyle"] })} />
              <Select id="n-fade" title="Fading" value={d.nav.fade} values={[...options(NAV_FADES).filter((option) => option.value !== "none"), { value: "none", label: "Never fade" }]} onChange={(value) => set("nav", { fade: value as Design["nav"]["fade"] })} />
            </div>
          </Card>

          <Card title="Footer" description="Every public page shows the privacy link.">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Color id="f-bg" title="Background" value={d.footer.bg} onChange={(bg) => set("footer", { bg: bg ?? "#ffffff" })} />
              <Color id="f-text" title="Text" value={d.footer.text} onChange={(text) => set("footer", { text: text ?? "#4b5563" })} />
            </div>
            <Check title="Show a logo in the footer" checked={d.footer.showLogo} onChange={(showLogo) => set("footer", { showLogo })} />
            {d.footer.showLogo ? (
              <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <ImagePick id="f-logo" title="Footer logo (optional)" funnelId={funnelId} publicPath={publicPath} kind="footer_logo" assetId={d.footer.logoAssetId} url={d.footer.logoUrl} onAsset={(logoAssetId) => set("footer", { logoAssetId })} onUrl={(logoUrl) => set("footer", { logoUrl, logoAssetId: null })} hint="Empty = the header logo." />
                <Field id="f-lh" title="Footer logo height (px)" hint="Empty = the header logo height.">
                  <input id="f-lh" type="number" min={12} max={240} className={input} value={d.footer.logoHeight ?? ""} onChange={(event) => set("footer", { logoHeight: event.target.value ? Math.max(12, Math.min(240, Number(event.target.value))) : null })} />
                </Field>
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-3">
              <Text id="f-company" title="Company name" value={state.companyName} onChange={(companyName) => top({ companyName })} />
              <Text id="f-privacy" title="Privacy-policy link" type="url" placeholder="https://" hint={themed ? "The Forms theme's link is used while a theme is set." : "Required to publish."} value={state.privacyUrl ?? ""} onChange={(value) => top({ privacyUrl: value || null })} />
              <Text id="f-terms" title="Terms link" type="url" placeholder="https://" value={state.termsUrl ?? ""} onChange={(value) => top({ termsUrl: value || null })} />
            </div>
            <LinksEditor links={d.footer.links} onChange={(links) => set("footer", { links })} />
            <div>
              <label htmlFor="footerHtml" className="text-sm font-medium">
                Legal text
              </label>
              <div className="mt-1">
                <RichTextArea funnelId={funnelId} id="footerHtml" value={state.footerHtml} onChange={(footerHtml) => top({ footerHtml })} rows={4} images={false} />
              </div>
            </div>
          </Card>
        </fieldset>

        {canWrite ? (
          <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white/95 p-3 shadow-sm backdrop-blur">
            <button type="button" onClick={save} disabled={saving} className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-semibold text-white disabled:opacity-60">
              {saving ? "Saving…" : "Save design"}
            </button>
            {dirty ? (
              <button
                type="button"
                onClick={async () => {
                  await discardDrafts(funnelId, "design");
                  window.location.reload();
                }}
                className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-4 text-sm font-semibold"
              >
                Discard changes
              </button>
            ) : null}
            <span className={`text-sm ${message?.kind === "error" ? "text-[#912018]" : message ? "text-[#067647]" : "text-muted"}`} role="status">
              {message?.text ?? (dirty ? "Unsaved changes." : "All changes saved.")}
            </span>
          </div>
        ) : null}
        {copyForm}
      </div>
      <div className="min-w-0 xl:sticky xl:top-4 xl:self-start">
        <LivePreview src={publicPath} version={draft.version} status={draft.status} paths={previewPaths} />
      </div>
    </div>
  );
}
