import { Button, Input, Textarea } from "@pubcommand/ui";
import { tenantDb } from "@pubcommand/db";
import { EVENT_SYNC_FIELDS, ISSUE_SYNC_FIELDS, readFieldMap, isEditable, type SyncEntity } from "../../../../../modules/editorial/airtable";
import { CUB_EMAIL_KINDS, effectiveTemplate, TEMPLATES } from "../../../../../modules/editorial/emails";
import { OPTION_FIELDS, type OptionLists } from "../../../../../modules/editorial/options";
import { daysInTrash } from "../../../../../modules/editorial/trash";
import { TableScroll } from "@/components/table-scroll";
import { emailConfigured } from "@/lib/email";
import { getConnection } from "./airtable-sync";
import { loadTemplates } from "./cub-emails";
import {
  disconnectAirtableAction,
  optionAction,
  purgeAction,
  readAirtableSchemaAction,
  resetTemplateAction,
  restoreAction,
  saveAirtableAction,
  saveFieldMapAction,
  saveTemplateAction,
  syncAirtableNowAction,
} from "./settings-actions";
import { listTrash } from "./trash";
import { Field, Section } from "./ui";

const small = "inline-flex h-11 min-w-11 items-center justify-center rounded-md border border-line bg-white px-2 text-sm hover:bg-canvas disabled:opacity-40";

export function OptionsPanel({ options, canWrite, customized }: { options: OptionLists; canWrite: boolean; customized: Set<string> }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">The choices in each dropdown, for this brand. Removing or renaming an option never changes records that already use it.</p>
      {OPTION_FIELDS.map((f) => (
        <Section key={f.key} title={f.label} action={customized.has(f.key) ? <span className="text-xs text-muted">Customized</span> : <span className="text-xs text-muted">Built-in list</span>}>
          <div id={f.key} />
          <ul className="divide-y divide-line rounded-lg border border-line">
            {options[f.key].map((value, i, list) => (
              <li key={value} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                <span className="min-w-0 flex-1 basis-40 break-words font-medium">{value}</span>
                {canWrite ? (
                  <div className="flex flex-wrap gap-1">
                    {(["up", "down"] as const).map((op) => (
                      <form key={op} action={optionAction}>
                        <input type="hidden" name="field" value={f.key} />
                        <input type="hidden" name="value" value={value} />
                        <input type="hidden" name="op" value={op} />
                        <button type="submit" className={small} disabled={op === "up" ? i === 0 : i === list.length - 1} aria-label={`Move ${value} ${op}`}>
                          {op === "up" ? "↑" : "↓"}
                        </button>
                      </form>
                    ))}
                    <details className="relative">
                      <summary className={`${small} cursor-pointer list-none`}>Rename</summary>
                      <form action={optionAction} className="mt-1 flex gap-1">
                        <input type="hidden" name="field" value={f.key} />
                        <input type="hidden" name="value" value={value} />
                        <input type="hidden" name="op" value="rename" />
                        <Input name="to" defaultValue={value} maxLength={60} aria-label="New name" className="w-40" />
                        <Button type="submit" variant="secondary">
                          Save
                        </Button>
                      </form>
                    </details>
                    <form action={optionAction}>
                      <input type="hidden" name="field" value={f.key} />
                      <input type="hidden" name="value" value={value} />
                      <input type="hidden" name="op" value="remove" />
                      <button type="submit" className={`${small} text-[#b42318]`} aria-label={`Remove ${value}`}>
                        ×
                      </button>
                    </form>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {canWrite ? (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <form action={optionAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="field" value={f.key} />
                <input type="hidden" name="op" value="add" />
                <Field label="Add an option">
                  <Input name="value" maxLength={60} required />
                </Field>
                <Button type="submit" variant="secondary">
                  Add
                </Button>
              </form>
              {customized.has(f.key) ? (
                <form action={optionAction}>
                  <input type="hidden" name="field" value={f.key} />
                  <input type="hidden" name="op" value="reset" />
                  <Button type="submit" variant="ghost">
                    Back to the built-in list
                  </Button>
                </form>
              ) : null}
            </div>
          ) : null}
        </Section>
      ))}
    </div>
  );
}

export async function EmailsPanel({ organizationId, brandId, canWrite }: { organizationId: string; brandId: string; canWrite: boolean }) {
  const rows = await loadTemplates(organizationId, brandId);
  return (
    <div className="space-y-4">
      {!emailConfigured() ? (
        <p className="rounded-lg border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-sm text-[#93370d]">
          Email is not set up yet. These templates are saved, but nothing is sent until the server has an email key (RESEND_API_KEY).
        </p>
      ) : null}
      <p className="text-sm text-muted">The CUB Collector emails. Use the merge fields in double braces; each is filled in when the email is sent.</p>
      {CUB_EMAIL_KINDS.map((kind) => {
        const spec = TEMPLATES[kind];
        const tpl = effectiveTemplate(kind, rows.get(kind));
        return (
          <Section key={kind} title={spec.label}>
            <div id={kind} />
            <p className="mb-3 text-sm text-muted">{spec.description}</p>
            <form action={saveTemplateAction} className="space-y-3">
              <input type="hidden" name="kind" value={kind} />
              {spec.hasRecipientGroup ? (
                <Field label="Reviewer group" hint="Pre-filled on every new round; the reminder goes to the reviewers of that round.">
                  <Textarea name="recipients" rows={2} defaultValue={tpl.recipients.join(", ")} disabled={!canWrite} placeholder="name@company.com, …" />
                </Field>
              ) : null}
              <Field label="Subject">
                <Input name="subject" maxLength={250} defaultValue={tpl.subject} disabled={!canWrite} />
              </Field>
              <Field label="Body" hint={`Merge fields: ${spec.mergeFields.map((m) => `{{${m.token}}} ${m.label.toLowerCase()}`).join(" · ")}`}>
                <Textarea name="body" rows={9} defaultValue={tpl.body} disabled={!canWrite} />
              </Field>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" name="enabled" value="1" defaultChecked={tpl.enabled} disabled={!canWrite} /> Send this email
              </label>
              {canWrite ? (
                <div className="flex flex-wrap gap-2">
                  <Button type="submit">Save</Button>
                </div>
              ) : null}
            </form>
            {canWrite && rows.has(kind) ? (
              <form action={resetTemplateAction} className="mt-2">
                <input type="hidden" name="kind" value={kind} />
                <Button type="submit" variant="ghost">
                  Back to the default wording
                </Button>
              </form>
            ) : null}
          </Section>
        );
      })}
    </div>
  );
}

export async function TrashPanel({ organizationId, brandId, canWrite }: { organizationId: string; brandId: string; canWrite: boolean }) {
  const rows = await listTrash(organizationId, brandId);
  const now = new Date();
  return (
    <Section title={`Trash · ${rows.length}`}>
      <p className="mb-3 text-sm text-muted">Deleted events, issues and series stay here until you delete them for good. Restoring a series brings back the occurrences deleted with it.</p>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {rows.map((row) => (
          <li key={`${row.kind}-${row.id}`} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="break-words [overflow-wrap:anywhere] font-medium">{row.title}</p>
              <p className="text-xs text-muted">
                {row.detail} · deleted {daysInTrash(row.deletedAt, now) === 0 ? "today" : `${daysInTrash(row.deletedAt, now)} days ago`}
              </p>
              {row.blocker ? <p className="text-xs text-[#93370d]">{row.blocker}</p> : null}
            </div>
            {canWrite ? (
              <div className="flex flex-wrap items-center gap-2">
                {!row.blocker ? (
                  <form action={restoreAction}>
                    <input type="hidden" name="kind" value={row.kind} />
                    <input type="hidden" name="id" value={row.id} />
                    <Button type="submit" variant="secondary">
                      Restore
                    </Button>
                  </form>
                ) : null}
                <details>
                  <summary className="inline-flex min-h-11 cursor-pointer items-center px-2 text-sm font-semibold text-[#b42318]">Delete for good…</summary>
                  <form action={purgeAction} className="mt-1 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="kind" value={row.kind} />
                    <input type="hidden" name="id" value={row.id} />
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input type="checkbox" name="confirm" value="1" required /> I understand this cannot be undone
                    </label>
                    <Button type="submit" variant="danger">
                      Delete
                    </Button>
                  </form>
                </details>
              </div>
            ) : null}
          </li>
        ))}
        {rows.length === 0 ? <li className="p-4 text-sm text-muted">The trash is empty.</li> : null}
      </ul>
    </Section>
  );
}

function MapForm({ entity, conn, columns }: { entity: SyncEntity; conn: { eventFields: unknown; issueFields: unknown; readOnlyFields: string[] }; columns: string[] }) {
  const map = readFieldMap(entity === "event" ? conn.eventFields : conn.issueFields);
  const fields = entity === "event" ? EVENT_SYNC_FIELDS : ISSUE_SYNC_FIELDS;
  const listId = `at-${entity}-fields`;
  return (
    <form action={saveFieldMapAction} className="space-y-3" id={`map-${entity}`}>
      <input type="hidden" name="entity" value={entity} />
      <datalist id={listId}>
        {columns.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => {
          const name = map.fields[f.key] ?? "";
          const readOnly = name && !isEditable(name, map, conn.readOnlyFields);
          return (
            <Field key={f.key} label={f.label} hint={readOnly ? "Computed in Airtable: read only, never written back." : undefined}>
              <Input name={`f_${f.key}`} list={listId} defaultValue={name} maxLength={120} placeholder="Airtable field name" />
            </Field>
          );
        })}
        <Field label="Last modified time field" hint="Lets the sync tell which side is newer. Without it, Airtable only wins when the calendar row was not edited since the last sync.">
          <Input name="modifiedField" list={listId} defaultValue={map.modifiedField ?? ""} maxLength={120} />
        </Field>
      </div>
      <Button type="submit" variant="secondary">
        Save {entity === "event" ? "event" : "issue"} mapping
      </Button>
    </form>
  );
}

export async function AirtablePanel({ organizationId, brandId, canWrite }: { organizationId: string; brandId: string; canWrite: boolean }) {
  const conn = await getConnection(organizationId, brandId);
  const logs = conn ? await tenantDb(organizationId).calendarSyncLog.findMany({ where: { brandId, direction: { in: ["push", "pull"] } }, orderBy: { createdAt: "desc" }, take: 15 }) : [];
  const columns = (entity: SyncEntity) => Object.keys(readFieldMap(entity === "event" ? conn?.eventFields : conn?.issueFields).types);
  return (
    <div className="space-y-4">
      <Section title="Airtable two-way sync (optional)">
        <p className="mb-3 text-sm text-muted">
          Keep an Airtable base in step with this calendar. Saves here are written back to Airtable (mapped, editable fields only), and the base is pulled every hour. When the
          same record changed on both sides, the calendar wins unless the Airtable record is newer. Calendar items not in Airtable yet are added to it. Your token is stored encrypted.
        </p>
        {canWrite ? (
          <form action={saveAirtableAction} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Base id" hint="Starts with “app”, from the base's URL.">
                <Input name="baseId" required maxLength={40} defaultValue={conn?.baseId ?? ""} placeholder="appXXXXXXXXXXXXXX" />
              </Field>
              <Field label="Personal access token" hint={conn ? "Saved. Leave empty to keep it." : "Scopes: data.records:read, data.records:write, schema.bases:read."}>
                <Input name="token" type="password" autoComplete="off" maxLength={300} placeholder={conn ? "••••••••" : "pat…"} />
              </Field>
              <Field label="Events table" hint="Table name or id. Leave empty to skip events.">
                <Input name="eventsTable" maxLength={120} defaultValue={conn?.eventsTable ?? ""} />
              </Field>
              <Field label="Issues table" hint="Leave empty to skip issues.">
                <Input name="issuesTable" maxLength={120} defaultValue={conn?.issuesTable ?? ""} />
              </Field>
            </div>
            <Field label="Fields never to write (optional)" hint="Comma-separated Airtable field names. Formula and other computed fields are skipped automatically once the tables are read.">
              <Input name="readOnlyFields" maxLength={2000} defaultValue={conn?.readOnlyFields.join(", ") ?? ""} />
            </Field>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name="enabled" value="1" defaultChecked={conn?.enabled ?? true} /> Sync is on
            </label>
            <Button type="submit">{conn ? "Save connection" : "Connect"}</Button>
          </form>
        ) : (
          <p className="text-sm text-muted">{conn ? `Connected to ${conn.baseId}.` : "Not connected."}</p>
        )}
        {conn ? (
          <div className="mt-4 space-y-2 rounded-lg bg-canvas p-3 text-sm">
            <p>
              Last sync: {conn.lastPullAt ? conn.lastPullAt.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "never"}
              {conn.lastStatus ? ` · ${conn.lastStatus}` : ""}
            </p>
            {conn.lastError ? <p className="text-[#b42318]">{conn.lastError}</p> : null}
            {canWrite ? (
              <div className="flex flex-wrap gap-2">
                <form action={readAirtableSchemaAction}>
                  <Button type="submit" variant="secondary">
                    Read tables and fields
                  </Button>
                </form>
                <form action={syncAirtableNowAction}>
                  <Button type="submit" variant="secondary">
                    Sync now
                  </Button>
                </form>
              </div>
            ) : null}
          </div>
        ) : null}
      </Section>
      {conn && canWrite ? (
        <>
          {conn.eventsTable ? (
            <Section title={`Event fields → ${conn.eventsTable}`}>
              <MapForm entity="event" conn={conn} columns={columns("event")} />
            </Section>
          ) : null}
          {conn.issuesTable ? (
            <Section title={`Issue fields → ${conn.issuesTable}`}>
              <MapForm entity="issue" conn={conn} columns={columns("issue")} />
            </Section>
          ) : null}
        </>
      ) : null}
      {logs.length ? (
        <Section title="Sync log">
          <TableScroll>
            <table className="w-full min-w-[520px] text-left text-sm">
              <tbody className="divide-y divide-line">
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap px-2 py-1.5 text-muted">{l.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                    <td className="px-2 py-1.5">
                      {l.direction} {l.entity}
                    </td>
                    <td className={`px-2 py-1.5 ${l.status === "error" ? "text-[#b42318]" : ""}`}>{l.status}</td>
                    <td className="px-2 py-1.5 text-muted">{l.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Section>
      ) : null}
      {conn && canWrite ? (
        <details className="rounded-xl border border-line bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-[#b42318]">Disconnect…</summary>
          <form action={disconnectAirtableAction} className="mt-3 flex flex-wrap items-center gap-2">
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name="confirm" value="1" required /> Remove the connection and token
            </label>
            <Button type="submit" variant="danger">
              Disconnect
            </Button>
          </form>
        </details>
      ) : null}
    </div>
  );
}
