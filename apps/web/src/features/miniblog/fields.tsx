import { HexColorInput } from "@/components/hex-color-input";
import { Label } from "@pubcommand/ui";
import Link from "next/link";
import type { ReactNode } from "react";

/** One labelled form field with an optional hint. */
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
        <HexColorInput id={name} name={name} defaultValue={value} label={label} />
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

/** Section tabs inside one Mini-Blog (plain links, server-rendered pages). */
export function SectionTabs({ items, active, label }: { items: { key: string; label: string; href: string }[]; active: string; label: string }) {
  return (
    <nav className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-1" aria-label={label}>
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.key === active ? "page" : undefined}
          className={`inline-flex min-h-10 shrink-0 items-center rounded-md border px-3 text-sm font-semibold ${item.key === active ? "border-accent bg-[#eef2ff] text-[#1e3a8a]" : "border-line bg-white text-ink hover:bg-canvas"}`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
