import { Badge, Input, Label, Textarea } from "@pubcommand/ui";
import Link from "next/link";
import { FONT_OPTIONS, asPairs, fieldGroups, optionLabel, type FieldDef } from "../../../../../modules/pubsetup/fields";
import { logoFor, type LogoBackground, type LogoSlots } from "../../../../../modules/pubsetup/logos";

export type FormValues = Record<string, unknown>;

function text(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value)) return value.map(String).join("\n");
  return String(value);
}

function FieldInput({ def, value }: { def: FieldDef; value: unknown }) {
  const id = `f-${def.key}`;
  const common = { id, name: def.key, required: def.required, defaultValue: text(value) };
  switch (def.kind) {
    case "textarea":
      return <Textarea {...common} rows={def.rows ?? 3} maxLength={def.max} />;
    case "list":
      return <Textarea {...common} rows={4} />;
    case "select":
      return (
        <select {...common} className="pc-control w-full">
          {def.required ? null : <option value="">Not set</option>}
          {(def.options ?? []).map((option) => (
            <option key={option} value={option}>
              {optionLabel(def, option)}
            </option>
          ))}
        </select>
      );
    case "font":
      return (
        <select {...common} className="pc-control w-full">
          <option value="">Not set</option>
          {FONT_OPTIONS.map((font) => (
            <option key={font}>{font}</option>
          ))}
        </select>
      );
    case "color":
      return <input type="color" {...common} defaultValue={text(value) || "#7f77dd"} className="h-11 w-full rounded-md border border-line bg-white" />;
    case "date":
      return <Input {...common} type="date" />;
    case "number":
      return <Input {...common} inputMode="numeric" defaultValue={text(value) || "0"} />;
    case "url":
      return <Input {...common} inputMode="url" placeholder="https://" maxLength={1000} />;
    case "email":
      return <Input {...common} type="email" maxLength={200} />;
    case "code":
      return <Input {...common} maxLength={def.max} className="uppercase" autoCapitalize="characters" />;
    default:
      return <Input {...common} maxLength={def.max} />;
  }
}

function PairsInput({ def, value }: { def: FieldDef; value: unknown }) {
  const rows = asPairs(value);
  const count = Math.min(def.maxRows ?? 6, Math.max(rows.length + 2, 3));
  const columns = def.columns ?? [];
  return (
    <div className="space-y-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="grid gap-2 rounded-md border border-line p-2 sm:grid-cols-3 sm:border-0 sm:p-0">
          {columns.map((column) => (
            <div key={column.key} className={columns.length === 2 && column.kind === "url" ? "sm:col-span-2" : ""}>
              <label className="sr-only" htmlFor={`f-${def.key}-${i}-${column.key}`}>
                {column.label} {i + 1}
              </label>
              <Input
                id={`f-${def.key}-${i}-${column.key}`}
                name={`${def.key}.${i}.${column.key}`}
                defaultValue={rows[i]?.[column.key] ?? ""}
                placeholder={i === 0 ? column.placeholder ?? column.label : column.label}
                maxLength={column.max}
                {...(column.kind === "url" ? { inputMode: "url" as const } : {})}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const WIDE = new Set(["textarea", "list", "pairs"]);

/** Renders every field in the list, grouped, from the shared field definitions. */
export function FieldSections({ defs, values = {} }: { defs: readonly FieldDef[]; values?: FormValues }) {
  return (
    <div className="space-y-5">
      {fieldGroups(defs).map(({ group, fields }) => (
        <fieldset key={group} className="rounded-xl border border-line bg-white p-4">
          <legend className="px-1 text-sm font-semibold">{group}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((def) => (
              <div key={def.key} className={WIDE.has(def.kind) ? "sm:col-span-2" : ""}>
                <Label htmlFor={def.kind === "pairs" ? undefined : `f-${def.key}`}>
                  {def.label}
                  {def.required ? <span className="text-[#b42318]"> *</span> : null}
                </Label>
                <div className="mt-1">{def.kind === "pairs" ? <PairsInput def={def} value={values[def.key]} /> : <FieldInput def={def} value={values[def.key]} />}</div>
                {def.hint ? <p className="mt-1 text-xs text-muted">{def.hint}</p> : null}
              </div>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

/** File input plus "remove" for an image stored as bytes. */
export function ImageField({ name, label, src, hint, round }: { name: string; label: string; src: string | null; hint?: string; round?: boolean }) {
  return (
    <div>
      <Label htmlFor={`img-${name}`}>{label}</Label>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        {src ? <img src={src} alt="" className={`h-14 w-14 border border-line bg-canvas object-contain ${round ? "rounded-full object-cover" : "rounded-md"}`} /> : null}
        <input id={`img-${name}`} type="file" name={name} accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" className="block min-w-0 max-w-full text-sm" />
      </div>
      {src ? (
        <label className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm text-muted">
          <input type="checkbox" name={`remove-${name}`} /> Remove
        </label>
      ) : null}
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function imageUrl(kind: string, id: string, version: Date | string | number): string {
  return `/settings/publication-setup/image/${kind}/${id}?v=${encodeURIComponent(version instanceof Date ? version.getTime() : String(version))}`;
}

/** The admin URL of a publication's best logo for a background (see logoFor), or null. */
export function pubLogoSrc(pub: { id: string; logos: LogoSlots; updatedAt: Date }, background: LogoBackground): string | null {
  const choice = logoFor(pub, background);
  return choice ? imageUrl(choice.kind, choice.id, choice.version ?? 0) : null;
}

/** A publication's logo on a white tile (dark tile for a dark-background-only logo), or its code on its calendar color. */
export function PubLogoTile({ pub, size = "md" }: { pub: { id: string; code: string; color: string; logos: LogoSlots; updatedAt: Date }; size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-16 w-16 text-base" : "h-12 w-12 text-sm";
  const choice = logoFor(pub, "light");
  // Only a logo for dark backgrounds exists: give it a dark tile so white artwork stays visible.
  return choice ? (
    <img src={imageUrl(choice.kind, choice.id, choice.version ?? 0)} alt="" className={`${box} shrink-0 rounded-md border border-line object-contain p-1`} style={{ background: choice.slot === "dark" ? "#111827" : "#ffffff" }} />
  ) : (
    <span className={`${box} flex shrink-0 items-center justify-center rounded-md font-bold text-white`} style={{ background: pub.color }} aria-hidden>
      {pub.code.slice(0, 3)}
    </span>
  );
}

export function PubChip({ code, color }: { code: string; color: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line px-2 py-0.5 text-xs font-semibold">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} aria-hidden />
      {code}
    </span>
  );
}

export function StatusBadge({ status, archived }: { status: string; archived?: boolean }) {
  if (archived) return <Badge tone="danger">Archived</Badge>;
  const tone = status === "active" ? "ok" : status === "launching" ? "accent" : status === "paused" ? "warn" : "neutral";
  return <Badge tone={tone}>{status === "inactive" ? "Inactive" : status.charAt(0).toUpperCase() + status.slice(1)}</Badge>;
}

export function SubNav({ active }: { active: "publications" | "editors" | "brand" | "import" }) {
  const tabs = [
    ["publications", "/settings/publication-setup", "Publications"],
    ["editors", "/settings/publication-setup/editors", "Editors"],
    ["import", "/settings/publication-setup/import", "Import"],
  ] as const;
  return (
    <nav className="-mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-line" aria-label="Publication Setup sections">
      {tabs.map(([key, href, label]) => (
        <Link key={key} href={href} className={`inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm font-medium ${active === key ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"}`}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  if (children == null || children === "" || (Array.isArray(children) && children.length === 0)) return null;
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-1 whitespace-pre-line break-words text-sm [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export function SafeLink({ href, children }: { href: string; children: React.ReactNode }) {
  return /^https?:\/\//i.test(href) ? (
    <a href={href} target="_blank" rel="noreferrer noopener" className="text-accent [overflow-wrap:anywhere] hover:underline">
      {children}
    </a>
  ) : (
    <span>{children}</span>
  );
}
