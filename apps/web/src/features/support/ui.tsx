import { Badge } from "@pubcommand/ui";
import Link from "next/link";
import { CATEGORIES, SOURCE_LABELS, type Category, type RecordSource } from "../../../../../modules/support/taxonomy";
import { GATE_RULES } from "../../../../../modules/support/gate";

export function SubNav({ active, counts }: { active: "records" | "sources" | "agents" | "gaps"; counts?: { gaps: number; proposals: number } }) {
  const tabs = [
    ["records", "/support", "Records", 0],
    ["sources", "/support/sources", "Sources", counts?.proposals ?? 0],
    ["agents", "/support/agents", "Agents", 0],
    ["gaps", "/support/gaps", "Gaps", counts?.gaps ?? 0],
  ] as const;
  return (
    <nav className="-mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-line" aria-label="Support Knowledge sections">
      {tabs.map(([key, href, label, count]) => (
        <Link
          key={key}
          href={href}
          className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm font-medium ${active === key ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"}`}
        >
          {label}
          {count ? <span className="rounded-full bg-accent px-1.5 text-xs font-semibold text-white">{count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone = status === "published" ? "ok" : status === "archived" ? "neutral" : "warn";
  return <Badge tone={tone}>{status === "published" ? "Published" : status === "archived" ? "Archived" : "Draft"}</Badge>;
}

export function AudienceBadge({ audience }: { audience: string }) {
  return <Badge tone={audience === "public" ? "accent" : "neutral"}>{audience === "public" ? "Public" : "Members"}</Badge>;
}

export function categoryLabel(category: string): string {
  return CATEGORIES[category as Category]?.label ?? category;
}

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source as RecordSource] ?? source;
}

export function ruleLabel(id: string): string {
  return GATE_RULES.find((rule) => rule.id === id)?.label ?? id;
}

export function Section({ title, description, children, id }: { title: string; description?: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="min-w-0 scroll-mt-4 rounded-xl border border-line bg-white p-4 sm:p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line bg-white p-6 text-center text-sm text-muted">{children}</p>;
}
