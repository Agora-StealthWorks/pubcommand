import { redirect } from "next/navigation";
import { LOGO_SLOT_LABELS, slotForUpload, type LogoBackground } from "../../../../../modules/pubsetup/logos";
import { withMessage } from "./guard";
import { uploadedImageType } from "./image-type";
import { classifyLogo } from "./logo-tone";


export type Img = { filename: string; mime: string; data: Uint8Array<ArrayBuffer> };

/** An uploaded image, nothing (no file), or a redirect back with an error. */
export async function readImage(formData: FormData, input: string, back: string, maxMb: number): Promise<Img | null> {
  const file = formData.get(input);
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > maxMb * 1024 * 1024) redirect(withMessage(back, "error", `Images must be under ${maxMb} MB.`));
  const data = new Uint8Array(await file.arrayBuffer());
  const mime = uploadedImageType(file, data);
  if (!mime) redirect(withMessage(back, "error", "Upload a PNG, JPG, GIF, WebP or SVG image."));
  return { filename: file.name.slice(0, 200), mime, data };
}

const COLUMNS: Record<LogoBackground, { filename: string; mime: string; data: string }> = {
  light: { filename: "logoFilename", mime: "logoMime", data: "logoData" },
  dark: { filename: "logoOnDarkFilename", mime: "logoOnDarkMime", data: "logoOnDarkData" },
};

/**
 * The logo part of a branding or publication form: `logo` (sorted by its artwork),
 * `logoLight` / `logoDark` (straight into that slot), `remove-logoLight` / `remove-logoDark`
 * and `swap-logos`. Returns the column patch and a short note on where an auto upload went.
 * `current` loads the stored images, only when a swap needs them.
 */
export async function logoColumns(
  formData: FormData,
  back: string,
  current: () => Promise<{ light: Img | null; dark: Img | null }>,
): Promise<{ data: Record<string, string | boolean | Uint8Array | null>; note: string | null }> {
  const state: Record<LogoBackground, Img | null | undefined> = { light: undefined, dark: undefined };
  if (formData.get("swap-logos") === "on") {
    const now = await current();
    state.light = now.dark;
    state.dark = now.light;
  }
  for (const slot of ["light", "dark"] as const) {
    const input = slot === "light" ? "logoLight" : "logoDark";
    if (formData.get(`remove-${input}`) === "on") state[slot] = null;
  }
  const explicit: Record<LogoBackground, Img | null> = {
    light: await readImage(formData, "logoLight", back, 2),
    dark: await readImage(formData, "logoDark", back, 2),
  };
  for (const slot of ["light", "dark"] as const) if (explicit[slot]) state[slot] = explicit[slot];

  let note: string | null = null;
  const auto = await readImage(formData, "logo", back, 2);
  if (auto) {
    const tone = classifyLogo(auto.data, auto.mime);
    const slot = slotForUpload(tone);
    if (!explicit[slot]) {
      state[slot] = auto;
      note =
        tone === null
          ? `Could not tell if the logo is light or dark, so it was filed ${LOGO_SLOT_LABELS.light.toLowerCase()}. Move it if that is wrong.`
          : `Logo filed ${LOGO_SLOT_LABELS[slot].toLowerCase()} (it has ${tone === "dark" ? "light" : "dark"} artwork).`;
    }
  }

  const data: Record<string, string | boolean | Uint8Array | null> = {};
  for (const slot of ["light", "dark"] as const) {
    const value = state[slot];
    if (value === undefined) continue;
    const cols = COLUMNS[slot];
    data[cols.filename] = value?.filename ?? null;
    data[cols.mime] = value?.mime ?? null;
    data[cols.data] = value?.data ?? null;
  }
  if (Object.keys(data).length) data.logoSorted = true;
  return { data, note };
}

/** The stored logos of a row, for a swap. */
export function storedLogos(row: { logoData: Uint8Array | null; logoMime: string | null; logoFilename: string | null; logoOnDarkData: Uint8Array | null; logoOnDarkMime: string | null; logoOnDarkFilename: string | null } | null): { light: Img | null; dark: Img | null } {
  const img = (data: Uint8Array | null, mime: string | null, filename: string | null): Img | null =>
    data && mime ? { data: new Uint8Array(data) as Uint8Array<ArrayBuffer>, mime, filename: filename ?? "logo" } : null;
  return row ? { light: img(row.logoData, row.logoMime, row.logoFilename), dark: img(row.logoOnDarkData, row.logoOnDarkMime, row.logoOnDarkFilename) } : { light: null, dark: null };
}
