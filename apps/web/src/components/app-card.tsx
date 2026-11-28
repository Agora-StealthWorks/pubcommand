import { AppThumbnail } from "./app-thumbnail";

/**
 * One app card as it appears on an organization's dashboard: the card artwork (2:1) and the app's
 * name under it. Without artwork it falls back to the built-in drawing. Used by the dashboard and
 * by the preview in Admin → App cards, so both look the same.
 */
export function AppCardTile({ moduleId, name, image }: { moduleId: string; name: string; image: string | null }) {
  return (
    <>
      <div className="aspect-[2/1] overflow-hidden border-b border-line bg-canvas">
        {image ? (
          <img src={image} alt="" width={1200} height={600} loading="lazy" className="block h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-stretch [&>svg]:h-full [&>svg]:w-full">
            <AppThumbnail moduleId={moduleId} />
          </div>
        )}
      </div>
      <div className="px-5 py-4">
        <h3 className="break-words text-lg font-semibold text-ink">{name}</h3>
      </div>
    </>
  );
}
