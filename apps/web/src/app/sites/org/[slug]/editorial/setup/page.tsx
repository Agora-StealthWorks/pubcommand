import { Button, Input, Textarea } from "@pubcommand/ui";
import { notFound } from "next/navigation";
import { Flash } from "@/components/ui";
import { deleteChannelAction, deletePublicationAction, saveChannelAction, savePublicationAction } from "@/features/calendar/actions";
import { calendarPage } from "@/features/calendar/context";
import { listChannels, listPublications, type PublicationView } from "@/features/calendar/data";
import { Field, PubChip, Section } from "@/features/calendar/ui";

function PublicationFields({ pub }: { pub?: PublicationView }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)_110px]">
        <Field label="Code" hint="Matches your ESP list names.">
          <Input name="code" required maxLength={20} defaultValue={pub?.code ?? ""} className="uppercase" />
        </Field>
        <Field label="Name">
          <Input name="name" required maxLength={120} defaultValue={pub?.name ?? ""} />
        </Field>
        <Field label="Color">
          <input type="color" name="color" defaultValue={pub?.color ?? "#7f77dd"} className="h-11 w-full rounded-md border border-line bg-white" />
        </Field>
      </div>
      <Field label="Description">
        <Textarea name="description" rows={2} defaultValue={pub?.description ?? ""} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Logo (optional)">
          <input type="file" name="logo" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" className="block w-full text-sm" />
        </Field>
        <Field label="Order">
          <Input name="sortOrder" inputMode="numeric" defaultValue={String(pub?.sortOrder ?? 0)} />
        </Field>
        <Field label="Status">
          <select name="active" defaultValue={pub?.active === false ? "off" : "on"} className="pc-control w-full">
            <option value="on">Active</option>
            <option value="off">Retired (kept for old issues)</option>
          </select>
        </Field>
      </div>
      {pub?.hasLogo ? (
        <label className="inline-flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" name="removeLogo" /> Remove the current logo
        </label>
      ) : null}
    </div>
  );
}

export default async function SetupPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await calendarPage(slug);
  if (!ctx) notFound();
  const [publications, channels] = await Promise.all([listPublications(ctx.resolved.id, ctx.brand.id, true), listChannels(ctx.resolved.id, ctx.brand.id)]);

  return (
    <div className="max-w-4xl space-y-5">
      <Flash error={query.error} notice={query.notice} />
      <Section title={`Publications · ${publications.length}`}>
        <p className="mb-3 text-sm text-muted">Each newsletter or list {ctx.brand.name} mails. The code is how send stats find the right issues.</p>
        <ul className="divide-y divide-line rounded-lg border border-line">
          {publications.map((pub) => (
            <li key={pub.id} className="p-3">
              <details>
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3">
                  {pub.hasLogo ? (
                    <img src={`/editorial/setup/logo/${pub.id}`} alt="" className="h-8 w-8 rounded object-contain" />
                  ) : null}
                  <PubChip code={pub.code} color={pub.color} />
                  <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere] font-medium">{pub.name}</span>
                  {!pub.active ? <span className="text-xs text-muted">Retired</span> : null}
                  {ctx.canWrite ? <span className="text-sm font-semibold text-accent">Edit</span> : null}
                </summary>
                {pub.description ? <p className="mt-2 text-sm text-muted">{pub.description}</p> : null}
                {ctx.canWrite ? (
                  <div className="mt-3 space-y-3">
                    <form action={savePublicationAction} className="space-y-3">
                      <input type="hidden" name="publicationId" value={pub.id} />
                      <PublicationFields pub={pub} />
                      <Button type="submit">Save {pub.code}</Button>
                    </form>
                    <form action={deletePublicationAction}>
                      <input type="hidden" name="publicationId" value={pub.id} />
                      <Button type="submit" variant="danger" size="sm">
                        Delete {pub.code}
                      </Button>
                    </form>
                  </div>
                ) : null}
              </details>
            </li>
          ))}
          {publications.length === 0 ? <li className="p-4 text-sm text-muted">No publications yet.</li> : null}
        </ul>
        {ctx.canWrite ? (
          <details className="mt-4 rounded-lg border border-dashed border-line p-3" open={publications.length === 0}>
            <summary className="cursor-pointer text-sm font-semibold text-accent">+ Add a publication</summary>
            <form action={savePublicationAction} className="mt-3 space-y-3">
              <PublicationFields />
              <Button type="submit">Add publication</Button>
            </form>
          </details>
        ) : null}
      </Section>

      <Section title={`Channels and rooms · ${channels.length}`}>
        <p className="mb-3 text-sm text-muted">Optional. Where events happen: a webinar room, a livestream, a podcast feed, a venue. Used to filter the calendar.</p>
        <ul className="flex flex-wrap gap-2">
          {channels.map((c) => (
            <li key={c.id} className="inline-flex items-center gap-2 rounded-md border border-line py-1 pl-2 pr-1 text-sm">
              <span className="h-3 w-3 rounded-full" style={{ background: c.color }} aria-hidden />
              {c.name}
              {ctx.canWrite ? (
                <form action={deleteChannelAction}>
                  <input type="hidden" name="channelId" value={c.id} />
                  <button type="submit" className="inline-flex h-9 w-9 items-center justify-center rounded text-muted hover:bg-canvas" aria-label={`Remove ${c.name}`}>
                    ×
                  </button>
                </form>
              ) : null}
            </li>
          ))}
          {channels.length === 0 ? <li className="text-sm text-muted">None yet.</li> : null}
        </ul>
        {ctx.canWrite ? (
          <form action={saveChannelAction} className="mt-3 flex flex-wrap items-end gap-2">
            <Field label="New channel">
              <Input name="name" required maxLength={80} />
            </Field>
            <input type="color" name="color" defaultValue="#27455c" aria-label="Color" className="h-11 w-14 rounded-md border border-line bg-white" />
            <Button type="submit" variant="secondary">
              Add
            </Button>
          </form>
        ) : null}
      </Section>
    </div>
  );
}
