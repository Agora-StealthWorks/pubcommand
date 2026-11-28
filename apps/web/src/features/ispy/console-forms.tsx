import { FEED_LABELS, FEEDS, LIST_CATEGORIES, LIST_CATEGORY_LABELS, PUBLISHER_TYPE_LABELS, PUBLISHER_TYPES } from "../../../../../modules/ispy/index";
import { createInboxAction, deleteList, deletePublication, deletePublisher, saveList, savePublication, savePublisher } from "./console-actions";
import { Back, btnDanger, btnPrimary, btnSm, input, label } from "./console-ui";

/** The ISpy console's registry forms (server components posting to server actions). */

export type OrgOption = { id: string; name: string; brands: { id: string; name: string; niche: string }[] };
export type CalOption = { id: string; name: string; code: string; brandId: string };

export type PublisherRow = {
  id: string;
  name: string;
  type: string;
  feed: string;
  parentId: string | null;
  domains: string[];
  fromAddresses: string[];
  website: string | null;
  notes: string | null;
  excludeBrands: string[];
  linkedOrganizationId: string | null;
  linkedBrandId: string | null;
  hideFromOtherOrgs: boolean;
};

export function PublisherForm({ publisher, groups, orgs, back, defaultFeed, defaultType }: { publisher?: PublisherRow; groups: { id: string; name: string }[]; orgs: OrgOption[]; back: string; defaultFeed: string; defaultType?: string }) {
  const p = publisher;
  return (
    <form action={savePublisher} className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
      <Back to={back} />
      {p ? <input type="hidden" name="id" value={p.id} /> : null}
      <label className={label}>
        Name
        <input name="name" required defaultValue={p?.name} className={input} />
      </label>
      <label className={label}>
        Type
        <select name="type" defaultValue={p?.type ?? defaultType ?? "COMPETITOR"} className={input}>
          {PUBLISHER_TYPES.map((t) => (
            <option key={t} value={t}>
              {PUBLISHER_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Feed
        <select name="feed" defaultValue={p?.feed ?? defaultFeed} className={input}>
          {FEEDS.map((f) => (
            <option key={f} value={f}>
              {FEED_LABELS[f]}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Part of group
        <select name="parentId" defaultValue={p?.parentId ?? ""} className={input}>
          <option value="">(none)</option>
          {groups
            .filter((g) => g.id !== p?.id)
            .map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
        </select>
      </label>
      <label className={label}>
        Sending domains (comma or one per line)
        <textarea name="domains" rows={2} defaultValue={p?.domains.join("\n")} className={`${input} py-2`} />
      </label>
      <label className={label}>
        From addresses
        <textarea name="fromAddresses" rows={2} defaultValue={p?.fromAddresses.join("\n")} className={`${input} py-2`} />
      </label>
      <label className={label}>
        Website
        <input name="website" defaultValue={p?.website ?? ""} className={input} />
      </label>
      <label className={label}>
        House-ad brands to ignore (affiliates)
        <input name="excludeBrands" defaultValue={p?.excludeBrands.join(", ")} placeholder="marketbeat" className={input} />
      </label>
      <label className={label}>
        Linked PubCommand organization and brand (teaches its Brain)
        <select name="linkedOrganizationId" defaultValue={p?.linkedOrganizationId ?? ""} className={input}>
          <option value="">(not linked)</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Brand
        <select name="linkedBrandId" defaultValue={p?.linkedBrandId ?? ""} className={input}>
          <option value="">(none)</option>
          {orgs.flatMap((o) =>
            o.brands.map((b) => (
              <option key={b.id} value={b.id}>
                {o.name} · {b.name} ({b.niche})
              </option>
            )),
          )}
        </select>
      </label>
      <label className={`${label} md:col-span-2`}>
        Notes
        <textarea name="notes" rows={2} defaultValue={p?.notes ?? ""} className={`${input} py-2`} />
      </label>
      <div className="flex flex-wrap items-center gap-4 md:col-span-2">
        <label className="inline-flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="hideFromOtherOrgs" defaultChecked={p?.hideFromOtherOrgs} /> Hide from other orgs
        </label>
        {!p ? (
          <label className="inline-flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" name="catchAll" /> Create a publisher catch-all inbox
          </label>
        ) : null}
        <button type="submit" className={btnPrimary}>
          {p ? "Save publisher" : "Add publisher"}
        </button>
      </div>
    </form>
  );
}

export function DeletePublisherButton({ id, back }: { id: string; back: string }) {
  return (
    <form action={deletePublisher}>
      <Back to={back} />
      <input type="hidden" name="id" value={id} />
      <button type="submit" className={btnDanger}>
        Remove publisher
      </button>
    </form>
  );
}

export function PublicationForm({ publisherId, publication, orgs, cals, back }: { publisherId: string; publication?: { id: string; name: string; aliases: string[]; notes: string | null; linkedBrandId: string | null; linkedCalendarPublicationId: string | null }; orgs: OrgOption[]; cals: CalOption[]; back: string }) {
  const p = publication;
  return (
    <form action={savePublication} className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
      <Back to={back} />
      <input type="hidden" name="publisherId" value={publisherId} />
      {p ? <input type="hidden" name="id" value={p.id} /> : null}
      <label className={label}>
        Publication name
        <input name="name" required defaultValue={p?.name} className={input} />
      </label>
      <label className={label}>
        Aliases
        <input name="aliases" defaultValue={p?.aliases.join(", ")} className={input} />
      </label>
      <label className={label}>
        Linked brand
        <select name="linkedBrandId" defaultValue={p?.linkedBrandId ?? ""} className={input}>
          <option value="">(not linked)</option>
          {orgs.flatMap((o) =>
            o.brands.map((b) => (
              <option key={b.id} value={b.id}>
                {o.name} · {b.name}
              </option>
            )),
          )}
        </select>
      </label>
      <label className={label}>
        Publication Setup record
        <select name="linkedCalendarPublicationId" defaultValue={p?.linkedCalendarPublicationId ?? ""} className={input}>
          <option value="">(none)</option>
          {cals.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.code})
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-4 md:col-span-2">
        {!p ? (
          <label className="inline-flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" name="createInbox" defaultChecked /> Create its publication inbox
          </label>
        ) : null}
        <button type="submit" className={btnPrimary}>
          {p ? "Save publication" : "Add publication"}
        </button>
      </div>
    </form>
  );
}

export function DeletePublicationButton({ id, back }: { id: string; back: string }) {
  return (
    <form action={deletePublication}>
      <Back to={back} />
      <input type="hidden" name="id" value={id} />
      <button type="submit" className={btnDanger}>
        Remove publication
      </button>
    </form>
  );
}

export type ListRow = { id: string; name: string; category: string; synonyms: string[]; isIgnored: boolean; editorialPubCode: string | null; dedicatedPubCode: string | null; publicationId: string | null };

export function ListForm({ publisherId, publicationId, list, publications, back, defaultCategory }: { publisherId: string; publicationId: string | null; list?: ListRow; publications?: { id: string; name: string }[]; back: string; defaultCategory?: string }) {
  const l = list;
  return (
    <form action={saveList} className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-3">
      <Back to={back} />
      <input type="hidden" name="publisherId" value={publisherId} />
      {l ? <input type="hidden" name="id" value={l.id} /> : null}
      {publications ? (
        <label className={label}>
          Publication
          <select name="publicationId" defaultValue={l?.publicationId ?? publicationId ?? ""} className={input}>
            <option value="">(none: an affiliate file)</option>
            {publications.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <input type="hidden" name="publicationId" value={l?.publicationId ?? publicationId ?? ""} />
      )}
      <label className={label}>
        List name
        <input name="name" required defaultValue={l?.name} className={input} />
      </label>
      <label className={label}>
        List type
        <select name="category" defaultValue={l?.category ?? defaultCategory ?? "FREE_EDITORIAL"} className={input}>
          {LIST_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {LIST_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Synonyms
        <input name="synonyms" defaultValue={l?.synonyms.join(", ")} className={input} />
      </label>
      <label className={label}>
        Editorial pub code
        <input name="editorialPubCode" defaultValue={l?.editorialPubCode ?? ""} className={input} />
      </label>
      <label className={label}>
        Dedicated pub code
        <input name="dedicatedPubCode" defaultValue={l?.dedicatedPubCode ?? ""} className={input} />
      </label>
      <div className="flex flex-wrap items-center gap-4 md:col-span-3">
        <label className="inline-flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="isIgnored" defaultChecked={l?.isIgnored} /> Ignore this list
        </label>
        {!l ? (
          <label className="inline-flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" name="createInbox" defaultChecked /> Create its own inbox
          </label>
        ) : null}
        <button type="submit" className={btnSm}>
          {l ? "Save list" : "Add list"}
        </button>
      </div>
    </form>
  );
}

export function DeleteListButton({ id, back }: { id: string; back: string }) {
  return (
    <form action={deleteList}>
      <Back to={back} />
      <input type="hidden" name="id" value={id} />
      <button type="submit" className={btnDanger}>
        Remove
      </button>
    </form>
  );
}

export function CreateInboxButton({ level, publisherId, publicationId, listId, name, back, labelText, affiliateSeed }: { level: "PUBLISHER_CATCHALL" | "PUBLICATION" | "LIST"; publisherId: string; publicationId?: string | null; listId?: string | null; name: string; back: string; labelText: string; affiliateSeed?: boolean }) {
  return (
    <form action={createInboxAction}>
      <Back to={back} />
      <input type="hidden" name="level" value={level} />
      <input type="hidden" name="publisherId" value={publisherId} />
      {publicationId ? <input type="hidden" name="publicationId" value={publicationId} /> : null}
      {listId ? <input type="hidden" name="listId" value={listId} /> : null}
      <input type="hidden" name="name" value={name} />
      {affiliateSeed ? <input type="hidden" name="affiliateSeed" value="on" /> : null}
      <button type="submit" className={btnSm}>
        {labelText}
      </button>
    </form>
  );
}
