import { Label } from "@pubcommand/ui";
import type { ReactNode } from "react";

/** One labelled builder field with an optional hint. */
export function Field({ label, htmlFor, hint, children, className = "" }: { label: string; htmlFor: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <Label htmlFor={htmlFor}>{label}</Label>
      <div className="mt-1">{children}</div>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Check({ name, label, defaultChecked, hint }: { name: string; label: string; defaultChecked: boolean; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 h-4 w-4 shrink-0 accent-accent" />
      <span>
        <span className="font-semibold">{label}</span>
        {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

export function ColorField({ name, label, value }: { name: string; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <Label htmlFor={name}>{label}</Label>
      <div className="mt-1 flex items-center gap-2">
        <input id={name} name={name} type="color" defaultValue={value} className="h-11 w-14 shrink-0 cursor-pointer rounded-md border border-line bg-white p-1" />
        <span className="truncate font-mono text-xs text-muted">{value}</span>
      </div>
    </div>
  );
}

export function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-white p-4 sm:p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

/** A read-only link box people can select and copy. */
export function LinkBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
      <a href={value} target="_blank" rel="noopener" className="mt-1 block truncate rounded-md border border-line bg-canvas px-3 py-2 font-mono text-xs text-accent">
        {value}
      </a>
    </div>
  );
}
