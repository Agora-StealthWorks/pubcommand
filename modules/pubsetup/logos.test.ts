import { describe, expect, it } from "vitest";
import { logoFor, slotForUpload, svgArtworkBackground, toneFromPixels } from "./logos";

/** A w×h RGBA image: a filled square of `color` in the middle, transparent (or `bg`) around it. */
function image(color: [number, number, number], bg: [number, number, number, number] = [0, 0, 0, 0], size = 8): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inside = x >= 2 && x < size - 2 && y >= 2 && y < size - 2;
      px.set(inside ? [...color, 255] : bg, (y * size + x) * 4);
    }
  }
  return px;
}

describe("logo tone", () => {
  it("files dark artwork on transparency for light backgrounds", () => {
    expect(toneFromPixels(image([17, 24, 39]), 8, 8).background).toBe("light");
    expect(toneFromPixels(image([29, 78, 216]), 8, 8).background).toBe("light");
  });

  it("files light artwork on transparency for dark backgrounds", () => {
    expect(toneFromPixels(image([255, 255, 255]), 8, 8).background).toBe("dark");
    expect(toneFromPixels(image([250, 204, 21]), 8, 8).background).toBe("dark");
  });

  it("judges an opaque image by its own background", () => {
    const onWhite = toneFromPixels(image([0, 0, 0], [255, 255, 255, 255]), 8, 8);
    expect(onWhite).toMatchObject({ background: "light", opaque: true });
    expect(toneFromPixels(image([255, 255, 255], [15, 23, 42, 255]), 8, 8).background).toBe("dark");
  });

  it("un-premultiplies when asked", () => {
    const px = new Uint8Array(4 * 4);
    for (let i = 0; i < 4; i += 1) px.set([120, 120, 120, 120], i * 4); // white at ~47% alpha, premultiplied
    expect(toneFromPixels(px, 2, 2, { premultiplied: true }).background).toBe("dark");
    expect(toneFromPixels(px, 2, 2).background).toBe("light");
  });

  it("returns null for a blank image", () => {
    expect(toneFromPixels(new Uint8Array(16), 2, 2).background).toBeNull();
    expect(slotForUpload(null)).toBe("light");
  });

  it("reads SVG colors when the SVG cannot be rasterized", () => {
    expect(svgArtworkBackground('<svg><path fill="#fff" d="M0 0"/><text style="fill: white">A</text></svg>')).toBe("dark");
    expect(svgArtworkBackground('<svg><path fill="#0b1f3a" d="M0 0"/></svg>')).toBe("light");
    expect(svgArtworkBackground("<svg><path d='M0 0'/></svg>")).toBe("light");
  });
});

describe("logoFor", () => {
  const pub = (light: boolean, dark: boolean) => ({ id: "p1", logos: { light, dark }, updatedAt: new Date(5) });
  const brand = { id: "b1", logos: { light: true, dark: true }, updatedAt: 9 };

  it("returns the slot for the background asked for", () => {
    expect(logoFor(pub(true, true), "light")).toEqual({ kind: "pub-logo", id: "p1", version: 5, slot: "light", from: "own" });
    expect(logoFor(pub(true, true), "dark")).toMatchObject({ kind: "pub-logo-dark", slot: "dark" });
  });

  it("falls back to the other variant, then to the brand", () => {
    expect(logoFor(pub(false, true), "light")).toMatchObject({ kind: "pub-logo-dark", slot: "dark", from: "own" });
    expect(logoFor(pub(false, false), "dark", brand)).toMatchObject({ kind: "brand-logo-dark", id: "b1", from: "fallback" });
    expect(logoFor(pub(false, false), "light")).toBeNull();
    expect(logoFor(null, "light", { ...brand, logos: { light: false, dark: true } })).toMatchObject({ kind: "brand-logo-dark", slot: "dark" });
  });

  it("names brand kinds for the brand itself", () => {
    expect(logoFor(brand, "light", null, "brand")).toMatchObject({ kind: "brand-logo", from: "own" });
  });
});
