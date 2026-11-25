"use client";

import { Button, Input, Label, Textarea } from "@pubcommand/ui";
import { useState } from "react";
import { contrastText, logoHeightPx } from "../../../../../modules/pubsetup/branding";
import { FONT_OPTIONS, fontStack, normalizeHex, type FieldDef } from "../../../../../modules/pubsetup/fields";
import { LogoSlotsField } from "./logo-field";

type Inherited = { value: string; from: string };

type Logos = { light: string | null; dark: string | null };

/**
 * Branding form with a small header preview. An empty field (or a ticked "use default")
 * inherits: a publication inherits the brand default, the brand inherits the platform default.
 * Logos have two slots (light and dark backgrounds); the preview shows the one its header color needs.
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
  logo: { own: Logos; inherited: Logos };
}) {
  const [own, setOwn] = useState<Record<string, string>>(() => Object.fromEntries(props.fields.map((f) => [f.key, props.own[f.key] ?? ""])));
  const [hexDraft, setHexDraft] = useState<Record<string, string>>({});
  const [useDefault, setUseDefault] = useState<Record<string, boolean>>(() => Object.fromEntries(props.fields.map((f) => [f.key, !props.own[f.key]])));

  const value = (key: string): string => {
    if (!useDefault[key] && own[key]) return own[key]!;
    return props.inherited[key]?.value ?? "";
  };
  const primary = value("primaryColor") || "#1f2a44";
  const headerBg = contrastText(primary) === "#ffffff" ? "dark" : "light";
  const other = headerBg === "dark" ? "light" : "dark";
  const { own: ownLogo, inherited } = props.logo;
  const logoSrc = ownLogo[headerBg] || ownLogo[other] || inherited[headerBg] || inherited[other];

  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      <form action={props.action} className="min-w-0 space-y-5">
        {Object.entries(props.hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <fieldset className="rounded-xl border border-line bg-white p-4">
          <legend className="px-1 text-sm font-semibold">Logos</legend>
          <LogoSlotsField light={ownLogo.light} dark={ownLogo.dark} inherited={inherited} inheritLabel={props.inheritLabel} />
          {!ownLogo.light && !ownLogo.dark ? (
            <p className="mt-2 text-xs text-muted">{inherited.light || inherited.dark ? `No own logo: using the ${props.inheritLabel} logo.` : "No logo yet: the name shows as text."}</p>
          ) : null}
        </fieldset>
        <fieldset className="rounded-xl border border-line bg-white p-4">
          <legend className="px-1 text-sm font-semibold">Look</legend>
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
                      <div className="flex gap-2">
                        <input
                          type="color"
                          aria-label={`${def.label} picker`}
                          disabled={off}
                          value={normalizeHex(own[def.key] ?? "") || normalizeHex(inherited?.value ?? "") || "#000000"}
                          onChange={(e) => { setOwn((o) => ({ ...o, [def.key]: e.target.value })); setHexDraft((d) => ({ ...d, [def.key]: e.target.value })); }}
                          className="h-11 w-14 shrink-0 rounded-md border border-line bg-white disabled:opacity-50"
                        />
                        <Input
                          id={id}
                          name={off ? undefined : def.key}
                          disabled={off}
                          inputMode="text"
                          autoComplete="off"
                          spellCheck={false}
                          maxLength={7}
                          pattern="#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})"
                          title="A hex color, like #7C3AED"
                          placeholder="#1d4ed8"
                          value={hexDraft[def.key] ?? (own[def.key] || inherited?.value || "")}
                          onChange={(e) => {
                            const typed = e.target.value;
                            setHexDraft((d) => ({ ...d, [def.key]: typed }));
                            const hex = normalizeHex(typed);
                            if (hex) setOwn((o) => ({ ...o, [def.key]: hex }));
                          }}
                          className="min-w-0 flex-1 font-mono uppercase disabled:opacity-50"
                        />
                      </div>
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

      <aside className="min-w-0 lg:sticky lg:top-4 lg:self-start" aria-label="Preview">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Preview</p>
        <div className="overflow-hidden rounded-xl border border-line shadow-sm" style={{ background: value("backgroundColor") || "#ffffff" }}>
          {/* The header shows the logo alone, centered, at the chosen size; the name only when there is no logo. */}
          <div className="flex items-center justify-center px-4 py-4" style={{ background: primary, color: contrastText(primary) }}>
            {logoSrc ? (
              <img src={logoSrc} alt={`${props.name} logo`} className="w-auto max-w-full object-contain" style={{ height: logoHeightPx(value("logoSize")) }} />
            ) : (
              <p className="text-center text-lg font-bold leading-tight [overflow-wrap:anywhere]" style={{ fontFamily: fontStack(value("headingFont") || "Georgia") }}>
                {props.name}
              </p>
            )}
          </div>
          <div className="space-y-3 px-4 py-4" style={{ color: value("textColor") || "#1f2937", fontFamily: fontStack(value("bodyFont") || "Arial") }}>
            <p className="text-base font-bold" style={{ fontFamily: fontStack(value("headingFont") || "Georgia") }}>
              A heading in this style
            </p>
            <p className="text-sm leading-relaxed">Body text reads like this. Links look <span style={{ color: value("accentColor") || "#1d4ed8", textDecoration: "underline" }}>like this</span>.</p>
            <span className="inline-block rounded-md px-3 py-2 text-sm font-semibold" style={{ background: value("accentColor") || "#1d4ed8", color: contrastText(value("accentColor") || "#1d4ed8") }}>
              A button
            </span>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted">The header uses the logo {headerBg === "dark" ? "for dark backgrounds" : "for light backgrounds"} when there is one. Saved logos show here; a new upload shows after you save.</p>
      </aside>
    </div>
  );
}
