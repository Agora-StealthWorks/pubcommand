import { Label } from "@pubcommand/ui";
import { LOGO_SLOT_HINTS, LOGO_SLOT_LABELS, type LogoBackground } from "../../../../../modules/pubsetup/logos";

const ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml";
const SWATCH: Record<LogoBackground, string> = { light: "#ffffff", dark: "#111827" };

/**
 * The two logo slots of a publication or the brand defaults. "Upload a logo" is sorted by
 * its artwork on save; each slot can also be replaced or removed directly, or the two swapped.
 * Field names are read by logoColumns() in logo-upload.ts.
 */
export function LogoSlotsField({ light, dark, inherited, inheritLabel }: { light: string | null; dark: string | null; inherited?: { light: string | null; dark: string | null }; inheritLabel?: string }) {
  const own = { light, dark };
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="logo-auto">Upload a logo</Label>
        <input id="logo-auto" type="file" name="logo" accept={ACCEPT} className="mt-1 block w-full min-w-0 text-sm" />
        <p className="mt-1 text-xs text-muted">PNG, JPG, GIF, SVG or WebP, under 2 MB. We check whether the artwork is dark or light and file it in the right slot below.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {(["light", "dark"] as const).map((slot) => {
          const other = slot === "light" ? "dark" : "light";
          const input = slot === "light" ? "logoLight" : "logoDark";
          const src = own[slot];
          const fallback = !src ? (own[other] ? "other" : inherited?.[slot] || inherited?.[other] ? "inherited" : null) : null;
          return (
            <div key={slot} className="min-w-0 rounded-lg border border-line p-3" data-logo-slot={slot}>
              <p className="text-sm font-semibold">{LOGO_SLOT_LABELS[slot]}</p>
              <p className="text-xs text-muted">{LOGO_SLOT_HINTS[slot]}</p>
              <div className="mt-2 flex h-20 items-center justify-center rounded-md border border-line px-3" style={{ background: SWATCH[slot] }}>
                {src ? (
                  <img src={src} alt={`Logo ${LOGO_SLOT_LABELS[slot].toLowerCase()}`} className="max-h-14 max-w-full object-contain" />
                ) : (
                  <span className={`text-xs ${slot === "dark" ? "text-white/70" : "text-muted"}`}>Empty</span>
                )}
              </div>
              {fallback ? (
                <p className="mt-1 text-xs text-muted">{fallback === "other" ? "Empty: the other logo is used here." : `Empty: the ${inheritLabel ?? "inherited"} logo is used here.`}</p>
              ) : null}
              <label htmlFor={`logo-${slot}`} className="mt-2 block text-xs font-medium text-muted">
                {src ? "Replace" : "Upload"} {LOGO_SLOT_LABELS[slot].toLowerCase()}
              </label>
              <input id={`logo-${slot}`} type="file" name={input} accept={ACCEPT} className="mt-1 block w-full min-w-0 text-sm" />
              {src ? (
                <label className="mt-1 inline-flex min-h-11 items-center gap-2 text-sm text-muted">
                  <input type="checkbox" name={`remove-${input}`} /> Remove
                </label>
              ) : null}
            </div>
          );
        })}
      </div>
      {light || dark ? (
        <label className="inline-flex min-h-11 items-center gap-2 text-sm text-muted">
          <input type="checkbox" name="swap-logos" /> Swap the two slots (if a logo landed in the wrong one)
        </label>
      ) : null}
    </div>
  );
}
