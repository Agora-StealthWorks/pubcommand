import { Button } from "@pubcommand/ui";
import Link from "next/link";
import { EDITOR_FIELDS, PUBLICATION_FIELDS } from "../../../../../modules/pubsetup/fields";
import { saveEditor, savePublication } from "./actions";
import type { Editor, Publication } from "./read";
import { FieldSections, ImageField, imageUrl } from "./ui";

export function PublicationForm({ pub }: { pub?: Publication | null }) {
  const values = pub ?? { status: "active", color: "#7f77dd", sortOrder: 0 };
  return (
    <form action={savePublication} className="max-w-4xl space-y-5">
      {pub ? <input type="hidden" name="publicationId" value={pub.id} /> : null}
      <FieldSections defs={PUBLICATION_FIELDS} values={values} />
      <fieldset className="rounded-xl border border-line bg-white p-4">
        <legend className="px-1 text-sm font-semibold">Images</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <ImageField name="logo" label="Logo" src={pub?.hasLogo ? imageUrl("pub-logo", pub.id, pub.updatedAt) : null} hint="PNG, JPG, WebP or SVG, under 2 MB. Leave empty to use the brand logo." />
          <ImageField name="cover" label="Cover image" src={pub?.hasCover ? imageUrl("pub-cover", pub.id, pub.updatedAt) : null} hint="Optional. Shown on wiki and funnel pages. Under 5 MB." />
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="submit">{pub ? "Save publication" : "Add publication"}</Button>
        <Link href={pub ? `/publication-setup/publications/${pub.id}` : "/publication-setup"} className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3.5 text-sm font-semibold">
          Cancel
        </Link>
      </div>
    </form>
  );
}

export function EditorForm({ editor }: { editor?: Editor | null }) {
  const values = editor ?? { status: "active", sortOrder: 0 };
  return (
    <form action={saveEditor} className="max-w-4xl space-y-5">
      {editor ? <input type="hidden" name="editorId" value={editor.id} /> : null}
      <fieldset className="rounded-xl border border-line bg-white p-4">
        <legend className="px-1 text-sm font-semibold">Photo</legend>
        <ImageField name="photo" label="Headshot" round src={editor?.hasPhoto ? imageUrl("editor-photo", editor.id, editor.updatedAt) : null} hint="Square works best. PNG, JPG or WebP, under 3 MB." />
      </fieldset>
      <FieldSections defs={EDITOR_FIELDS} values={values} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit">{editor ? "Save editor" : "Add editor"}</Button>
        <Link href={editor ? `/publication-setup/editors/${editor.id}` : "/publication-setup/editors"} className="inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3.5 text-sm font-semibold">
          Cancel
        </Link>
      </div>
    </form>
  );
}
