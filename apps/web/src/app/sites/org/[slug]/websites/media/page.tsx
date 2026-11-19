import { Button, Input } from "@pubcommand/ui";
import { notFound } from "next/navigation";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { saveMedia, uploadMedia } from "@/features/websites/actions";
import { NoSite, SiteBar } from "@/features/websites/admin-ui";
import { siteMedia } from "@/features/websites/data";
import { websitesAccess } from "@/features/websites/guard";

function size(bytes: number) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default async function MediaPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const access = await websitesAccess(slug);
  if (access.kind === "missing") notFound();
  if (access.kind === "denied") return <Denied title={access.title} />;
  const { ctx, sites, site, canWrite } = access;
  if (!site) return <NoSite />;
  const media = await siteMedia(ctx.resolved.id, site.id, 300);
  return (
    <div>
      <PageHeader title="Media library" description="Images and PDFs for posts, pages and special reports. SVG uploads are turned into sharp PNGs." />
      <Flash error={query.error} notice={query.notice} />
      <SiteBar sites={sites} site={site} back="/websites/media" />
      {canWrite ? (
        <form action={uploadMedia} className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line bg-white p-4">
          <input type="hidden" name="siteId" value={site.id} />
          <input type="file" name="files" multiple accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,application/pdf" className="min-w-0 flex-1 text-sm" aria-label="Files to upload" />
          <Button type="submit">Upload</Button>
        </form>
      ) : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {media.map((item) => {
          const src = `/w/${site.slug}/media/${item.id}`;
          return (
            <div key={item.id} className="overflow-hidden rounded-xl border border-line bg-white">
              <a href={src} target="_blank" rel="noreferrer" className="block aspect-[4/3] bg-canvas">
                {item.mimeType.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt={item.alt} loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <span className="grid h-full place-items-center text-2xl font-bold text-muted">PDF</span>
                )}
              </a>
              <div className="space-y-2 p-2.5 text-xs">
                <p className="truncate font-medium" title={item.filename}>
                  {item.filename}
                </p>
                <p className="text-muted">{size(item.size)}</p>
                <input readOnly value={src} className="w-full rounded border border-line px-1.5 py-1 text-[11px] text-muted" aria-label="Address" />
                {canWrite ? (
                  <form action={saveMedia} className="space-y-1.5">
                    <input type="hidden" name="assetId" value={item.id} />
                    <Input name="alt" defaultValue={item.alt} placeholder="Alt text" className="h-9 min-h-9 text-xs" aria-label="Alt text" />
                    <div className="flex gap-2">
                      <button className="font-semibold text-accent">Save</button>
                      <button name="delete" value="1" className="ml-auto font-semibold text-[#b42318]">
                        Delete
                      </button>
                    </div>
                  </form>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {media.length === 0 ? <p className="rounded-xl border border-line bg-white p-8 text-center text-sm text-muted">No files yet.</p> : null}
    </div>
  );
}
