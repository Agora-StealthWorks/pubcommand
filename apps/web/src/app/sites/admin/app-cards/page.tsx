import { PLATFORM_PERMISSIONS, platformCan } from "@pubcommand/core";
import { Button } from "@pubcommand/ui";
import { AppCardTile } from "@/components/app-card";
import { Denied, Flash, PageHeader } from "@/components/ui";
import { loadAppCardSettings } from "@/features/app-cards/store";
import { appCardImage, cardableApps, cardOnDashboard, sortByCardPosition } from "@/lib/apps";
import { readSession, readStaff } from "@/lib/auth";
import { moveAppCard, removeAppCardImage, saveAppCardDetails, uploadAppCardImage } from "@/server/app-card-actions";

export const metadata = { title: "App cards" };

/** Admin → App cards: the cards on every organization's dashboard. */
export default async function AppCardsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const query = await searchParams;
  const auth = await readSession();
  const staff = auth.user ? await readStaff(auth.user.id) : null;
  if (!staff || !platformCan(staff.role, PLATFORM_PERMISSIONS.manageModules)) return <Denied title="Only staff who manage apps can edit app cards" />;
  const settings = await loadAppCardSettings();
  const apps = sortByCardPosition(cardableApps(), settings);

  return (
    <div>
      <PageHeader
        title="App cards"
        description="The cards on every organization's dashboard, in this order. An organization only sees a card when it has the app (its plan includes it and the organization switched it on) and the person may open it. Names here also show in the sidebar."
      />
      <Flash error={query.error} notice={query.notice} />
      <ol className="space-y-3">
        {apps.map((app, index) => {
          const setting = settings[app.moduleId] ?? null;
          const on = cardOnDashboard(app.moduleId, setting);
          const name = setting?.name?.trim() || app.name;
          const image = appCardImage(app.moduleId, setting);
          return (
            <li key={app.moduleId} id={`card-${app.moduleId}`} className="grid min-w-0 scroll-mt-4 gap-4 rounded-xl border border-line bg-white p-4 md:grid-cols-[16rem_minmax(0,1fr)]">
              <div className={`overflow-hidden rounded-xl border border-line ${on ? "" : "opacity-50"}`} aria-hidden>
                <AppCardTile moduleId={app.moduleId} name={name} image={image} />
              </div>
              <div className="min-w-0 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-muted">#{index + 1}</span>
                  <h2 className="text-base font-semibold">{app.name}</h2>
                  {app.builtIn ? null : <span className="rounded-full bg-[#f4f3ff] px-2 py-0.5 text-xs font-medium text-[#5925dc]">New app</span>}
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${on ? "bg-[#ecfdf3] text-[#067647]" : "bg-canvas text-muted"}`}>{on ? "On dashboards" : "Off dashboards"}</span>
                  <span className="text-xs text-muted">
                    {setting?.imageVersion ? "Uploaded image" : image ? "Default image" : "Built-in drawing (no image yet)"}
                  </span>
                </div>

                <form action={saveAppCardDetails} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="moduleId" value={app.moduleId} />
                  <label className="block min-w-0 flex-1 text-sm font-medium" htmlFor={`name-${app.moduleId}`}>
                    Card name
                    <input
                      id={`name-${app.moduleId}`}
                      name="name"
                      defaultValue={name}
                      placeholder={app.name}
                      maxLength={60}
                      className="mt-1 block min-h-11 w-full rounded-md border border-line bg-white px-3 text-base sm:text-sm"
                    />
                  </label>
                  <label className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line px-3 text-sm" htmlFor={`on-${app.moduleId}`}>
                    <input id={`on-${app.moduleId}`} type="checkbox" name="onDashboard" defaultChecked={on} className="h-5 w-5" />
                    On the dashboard
                  </label>
                  <Button type="submit" className="w-full sm:w-auto">Save</Button>
                </form>

                <div className="flex flex-wrap items-center gap-2">
                  <form action={uploadAppCardImage} className="flex min-w-0 flex-wrap items-center gap-2">
                    <input type="hidden" name="moduleId" value={app.moduleId} />
                    <label className="sr-only" htmlFor={`image-${app.moduleId}`}>Card image for {app.name}</label>
                    <input
                      id={`image-${app.moduleId}`}
                      name="image"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      required
                      className="block min-w-0 max-w-full text-sm file:mr-2 file:min-h-11 file:rounded-md file:border-0 file:bg-canvas file:px-3 file:text-sm"
                    />
                    <Button type="submit" variant="secondary">Upload image</Button>
                  </form>
                  {setting?.imageVersion ? (
                    <form action={removeAppCardImage}>
                      <input type="hidden" name="moduleId" value={app.moduleId} />
                      <Button type="submit" variant="ghost">Remove upload</Button>
                    </form>
                  ) : null}
                  <div className="ml-auto flex gap-1">
                    {(["up", "down"] as const).map((direction) => (
                      <form key={direction} action={moveAppCard}>
                        <input type="hidden" name="moduleId" value={app.moduleId} />
                        <input type="hidden" name="direction" value={direction} />
                        <Button
                          type="submit"
                          variant="secondary"
                          disabled={direction === "up" ? index === 0 : index === apps.length - 1}
                          aria-label={`Move ${name} ${direction}`}
                          className="w-11 px-0"
                        >
                          {direction === "up" ? "↑" : "↓"}
                        </Button>
                      </form>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-muted">Images: PNG, JPEG or WebP, 2 MB at most, 2:1 (1200 × 600, or 2400 × 1200 for sharp screens). Other shapes are cropped to fit.</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
