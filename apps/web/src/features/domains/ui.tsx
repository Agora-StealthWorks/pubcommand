import { Badge, Input, Label } from "@pubcommand/ui";
import { TableScroll } from "@/components/table-scroll";
import { STATUS_LABELS, type DnsRecord, type DomainStatus } from "../../../../../modules/settings/domains/status";
import type { EnvRequirement } from "./config";
import type { TargetGroup } from "./targets";

const TONES: Record<DomainStatus, "ok" | "warn" | "accent" | "danger"> = {
  ACTIVE: "ok",
  PENDING_DNS: "warn",
  VERIFYING: "accent",
  ERROR: "danger",
};

export function StatusPill({ status }: { status: DomainStatus }) {
  return <Badge tone={TONES[status]}>{STATUS_LABELS[status]}</Badge>;
}

export function MissingEnv({ title, why, missing }: { title: string; why: string; missing: EnvRequirement[] }) {
  return (
    <div className="rounded-xl border border-[#fedf89] bg-[#fffcf5] p-4">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <p className="mt-1 text-sm text-muted">{why}</p>
      <ul className="mt-3 space-y-3">
        {missing.map((item) => (
          <li key={item.name} className="min-w-0 text-sm">
            <code className="break-all rounded bg-white px-1.5 py-0.5 font-mono text-xs font-semibold text-ink ring-1 ring-line">{item.name}</code>
            <p className="mt-1 text-muted">{item.purpose}</p>
            <p className="mt-0.5 text-xs text-muted">Where: {item.where}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RecordsTable({ records, managed }: { records: DnsRecord[]; managed: boolean }) {
  if (records.length === 0) {
    return <p className="text-sm text-muted">Railway has not returned the records yet. Press Check now in a moment.</p>;
  }
  return (
    <div>
      <p className="mb-2 text-xs text-muted">
        {managed
          ? "PubCommand added these to the Cloudflare zone (DNS only, not proxied)."
          : "Add these at your DNS provider. Turn any proxy or CDN off (DNS only) so the certificate can be issued. For the bare domain (@), use CNAME flattening, ALIAS or ANAME if your provider has no CNAME at the root."}
      </p>
      <TableScroll>
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="py-2 pr-3 font-semibold">Type</th>
              <th className="py-2 pr-3 font-semibold">Name</th>
              <th className="py-2 pr-3 font-semibold">Value</th>
              <th className="py-2 font-semibold">Seen</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={`${record.type}-${record.fqdn}-${record.value}`} className="border-t border-line align-top">
                <td className="py-2 pr-3 font-mono text-xs">{record.type}</td>
                <td className="py-2 pr-3 font-mono text-xs break-all">{record.name}</td>
                <td className="py-2 pr-3 font-mono text-xs break-all">{record.value}</td>
                <td className="py-2 text-xs">{record.ok ? <span className="text-[#067647]">Yes</span> : <span className="text-[#b54708]">Not yet</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </div>
  );
}

/** Target chooser: every provider's pages, plus a raw path. */
export function TargetPicker({ id, groups, current }: { id: string; groups: TargetGroup[]; current?: string }) {
  const known = groups.some((group) => group.targets.some((target) => target.path === current));
  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor={`target-${id}`}>Page to show</Label>
        <select id={`target-${id}`} name="target" defaultValue={known ? current : current ? "custom" : ""} className="pc-control mt-1 w-full">
          <option value="">Choose a page…</option>
          {groups.map((group) => (
            <optgroup key={group.id} label={group.targets.length ? group.label : `${group.label} (none published)`}>
              {group.targets.map((target) => (
                <option key={target.id} value={target.path}>
                  {target.label} — {target.path}
                </option>
              ))}
            </optgroup>
          ))}
          <option value="custom">Another path (type it below)</option>
        </select>
      </div>
      <div>
        <Label htmlFor={`custom-${id}`}>Or a path on your public site</Label>
        <Input id={`custom-${id}`} name="customPath" defaultValue={known ? "" : (current ?? "")} placeholder="/l/my-launch or /b/my-blog" maxLength={300} />
        <p className="mt-1 text-xs text-muted">Public pages only: /f/… forms, /embed/… embedded forms, /l/… launch funnels, /b/… Mini-Blogs.</p>
      </div>
    </div>
  );
}
