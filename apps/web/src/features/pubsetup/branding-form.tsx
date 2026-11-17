"use client";

import { Button, Input, Label, Textarea } from "@pubcommand/ui";
import { useState } from "react";
import { contrastText } from "../../../../../modules/pubsetup/branding";
import { FONT_OPTIONS, fontStack, type FieldDef } from "../../../../../modules/pubsetup/fields";

type Inherited = { value: string; from: string };

/**
 * Branding form with a live email preview. An empty field (or a ticked "use default")
 * inherits: a publication inherits the brand default, the brand inherits the platform default.
 */
export function BrandingForm(props: {
  action: (formData: FormData) => void | Promise<void>;
  hidden: Record<string, string>;
  fields: readonly FieldDef[];
  own: Record<string, string | null>;
  inherited: Record<string, Inherited>;
  name: string;
  tagline: string;
  inheritLabel: string;
  logo: { own: string | null; inherited: string | null };
  emailHeader: { own: string | null; inherited: string | null };
}) {
  const [own, setOwn] = useState<Record<string, string>>(() => Object.fromEntries(props.fields.map((f) => [f.key, props.own[f.key] ?? ""])));
  const [useDefault, setUseDefault] = useState<Record<string, boolean>>(() => Object.fromEntries(props.fields.map((f) => [f.key, !props.own[f.key]])));
  const [logo, setLogo] = useState<{ src: string | null; removed: boolean }>({ src: props.logo.own, removed: false });
  const [header, setHeader] = useState<{ src: string | null; removed: boolean }>({ src: props.emailHeader.own, removed: false });

  const value = (key: string): string => {
    if (!useDefault[key] && own[key]) return own[key]!;
    return props.inherited[key]?.value ?? "";
  };
  const logoSrc = (!logo.removed && logo.src) || props.logo.inherited;
  const headerSrc = (!header.removed && header.src) || props.emailHeader.inherited;
  const primary = value("primaryColor") || "#1f2a44";
  const tagline = props.fields.some((f) => f.key === "tagline") ? value("tagline") : props.tagline;

  const pickFile = (set: typeof setLogo) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) set({ src: URL.createObjectURL(file), removed: false });
  };

  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      <form action={props.action} className="min-w-0 space-y-5">
        {Object.entries(props.hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <fieldset className="rounded-xl border border-line bg-white p-4">
          <legend className="px-1 text-sm font-semibold">Images</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="b-logo">Logo</Label>
              <input id="b-logo" type="file" name="logo" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" onChange={pickFile(setLogo)} className="mt-1 block w-full min-w-0 text-sm" />
              {props.logo.own ? (
                <label className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm text-muted">
                  <input type="checkbox" name="remove-logo" onChange={(e) => setLogo((l) => ({ ...l, removed: e.target.checked }))} /> Remove this logo
                </label>
              ) : null}
              <p className="mt-1 text-xs text-muted">{props.logo.own ? "Own logo." : props.logo.inherited ? `Using the ${props.inheritLabel} logo.` : "No logo yet: the name shows as text."}</p>
            </div>
            <div>
              <Label htmlFor="b-header">Email header image</Label>
              <input id="b-header" type="file" name="emailHeader" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" onChange={pickFile(setHeader)} className="mt-1 block w-full min-w-0 text-sm" />
              {props.emailHeader.own ? (
                <label className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm text-muted">
                  <input type="checkbox" name="remove-emailHeader" onChange={(e) => setHeader((h) => ({ ...h, removed: e.target.checked }))} /> Remove this header
                </label>
              ) : null}
              <p className="mt-1 text-xs text-muted">Optional. A full-width banner, about 600 px wide. Replaces the colored bar.</p>
            </div>
          </div>
        </fieldset>
        <fieldset className="rounded-xl border border-line bg-white p-4">
          <legend className="px-1 text-sm font-semibold">Look and sender</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {props.fields.map((def) => {
              const inherited = props.inherited[def.key];
              const id = `b-${def.key}`;
              const off = useDefault[def.key];
              const wide = def.kind === "textarea";
              return (
                <div key={def.key} className={wide ? "sm:col-span-2" : ""}>
                  <Label htmlFor={id}>{def.label}</Label>
                  <div className="mt-1">
                    {def.kind === "color" ? (
                      <input
                        id={id}
                        type="color"
                        name={off ? undefined : def.key}
                        disabled={off}
                        value={own[def.key] || inherited?.value || "#000000"}
                        onChange={(e) => setOwn((o) => ({ ...o, [def.key]: e.target.value }))}
                        className="h-11 w-full rounded-md border border-line bg-white disabled:opacity-50"
                      />
                    ) : def.kind === "font" ? (
                      <select id={id} name={def.key} value={off ? "" : own[def.key]} onChange={(e) => { setOwn((o) => ({ ...o, [def.key]: e.target.value })); setUseDefault((u) => ({ ...u, [def.key]: !e.target.value })); }} className="pc-control w-full">
                        <option value="">{`Use ${inherited?.from ?? "default"}: ${inherited?.value ?? ""}`}</option>
                        {FONT_OPTIONS.map((font) => (
                          <option key={font}>{font}</option>
                        ))}
                      </select>
                    ) : def.kind === "textarea" ? (
                      <Textarea id={id} name={def.key} rows={def.rows ?? 3} maxLength={def.max} value={own[def.key]} placeholder={inherited?.value ? `${inherited.from}: ${inherited.value}` : ""} onChange={(e) => { setOwn((o) => ({ ...o, [def.key]: e.target.value })); setUseDefault((u) => ({ ...u, [def.key]: !e.target.value })); }} />
                    ) : (
                      <Input id={id} name={def.key} type={def.kind === "email" ? "email" : "text"} maxLength={def.max ?? 200} value={own[def.key]} placeholder={inherited?.value ? `${inherited.from}: ${inherited.value}` : ""} onChange={(e) => { setOwn((o) => ({ ...o, [def.key]: e.target.value })); setUseDefault((u) => ({ ...u, [def.key]: !e.target.value })); }} />
                    )}
                  </div>
                  {def.kind === "color" ? (
                    <label className="mt-1 inline-flex min-h-11 items-center gap-2 text-sm text-muted">
                      <input type="checkbox" checked={off} onChange={(e) => setUseDefault((u) => ({ ...u, [def.key]: e.target.checked }))} />
                      Use {inherited?.from ?? "default"} ({inherited?.value})
                    </label>
                  ) : (
                    <p className="mt-1 text-xs text-muted">{off ? `Blank: uses the ${inherited?.from ?? "default"}.` : def.hint ?? ""}</p>
                  )}
                </div>
              );
            })}
          </div>
        </fieldset>
        <Button type="submit">Save branding</Button>
      </form>

      <aside className="min-w-0 lg:sticky lg:top-4 lg:self-start" aria-label="Live preview">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Live preview · email</p>
        <div className="overflow-hidden rounded-xl border border-line shadow-sm" style={{ background: value("backgroundColor") || "#ffffff" }}>
          <div className="border-b border-line bg-canvas px-3 py-2 text-xs text-muted [overflow-wrap:anywhere]">
            From: <strong className="text-ink">{value("senderName") || props.name}</strong>
            {value("senderEmail") ? ` <${value("senderEmail")}>` : ""}
          </div>
          {headerSrc ? (
            <img src={headerSrc} alt="" className="block h-auto w-full" />
          ) : (
            <div className="flex items-center gap-3 px-4 py-4" style={{ background: primary, color: contrastText(primary) }}>
              {logoSrc ? <img src={logoSrc} alt="" className="h-10 w-auto max-w-[45%] object-contain" /> : null}
              <div className="min-w-0">
                <p className="text-lg font-bold leading-tight [overflow-wrap:anywhere]" style={{ fontFamily: fontStack(value("headingFont") || "Georgia") }}>
                  {props.name}
                </p>
                {tagline ? <p className="text-xs opacity-90 [overflow-wrap:anywhere]">{tagline}</p> : null}
              </div>
            </div>
          )}
          <div className="space-y-3 px-4 py-4" style={{ color: value("textColor") || "#1f2937", fontFamily: fontStack(value("bodyFont") || "Arial") }}>
            <p className="text-base font-bold" style={{ fontFamily: fontStack(value("headingFont") || "Georgia") }}>
              This week&apos;s issue
            </p>
            <p className="text-sm leading-relaxed">Here is how an issue reads with these colors and fonts. Links look <span style={{ color: value("accentColor") || "#1d4ed8", textDecoration: "underline" }}>like this</span>.</p>
            <span className="inline-block rounded-md px-3 py-2 text-sm font-semibold" style={{ background: value("accentColor") || "#1d4ed8", color: contrastText(value("accentColor") || "#1d4ed8") }}>
              Read the full issue
            </span>
          </div>
          {value("footerText") ? <p className="whitespace-pre-line border-t border-line px-4 py-3 text-xs opacity-70 [overflow-wrap:anywhere]" style={{ color: value("textColor") || "#1f2937" }}>{value("footerText")}</p> : null}
        </div>
      </aside>
    </div>
  );
}
