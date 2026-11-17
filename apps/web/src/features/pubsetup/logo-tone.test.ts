import { Resvg } from "@resvg/resvg-js";
import jpeg from "jpeg-js";
import { describe, expect, it } from "vitest";
import { classifyLogo } from "./logo-tone";

/** A small generated PNG: a "wordmark" bar in `fill` on a transparent background. */
function png(fill: string): Uint8Array {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="16"><rect x="4" y="4" width="32" height="8" fill="${fill}"/></svg>`;
  return new Uint8Array(new Resvg(svg).render().asPng());
}

describe("classifyLogo", () => {
  it("files dark artwork on transparency for light backgrounds", () => {
    expect(classifyLogo(png("#111827"), "image/png")).toBe("light");
    expect(classifyLogo(png("#1d4ed8"), "image/png")).toBe("light");
  });

  it("files light artwork on transparency for dark backgrounds", () => {
    expect(classifyLogo(png("#ffffff"), "image/png")).toBe("dark");
    expect(classifyLogo(png("#f5f5f4"), "image/png")).toBe("dark");
  });

  it("judges an opaque JPEG by its background", () => {
    const width = 8;
    const height = 8;
    const data = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i += 1) data.set([255, 255, 255, 255], i * 4);
    data.set([0, 0, 0, 255], (4 * width + 4) * 4);
    const white = new Uint8Array(jpeg.encode({ data, width, height }, 90).data);
    expect(classifyLogo(white, "image/jpeg")).toBe("light");
  });

  it("rasterizes SVG logos", () => {
    const light = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 4"><rect x="1" y="1" width="8" height="2" fill="#fff"/></svg>');
    const dark = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 4"><path d="M1 1h8v2H1z" style="fill:#0b1f3a"/></svg>');
    expect(classifyLogo(light, "image/svg+xml")).toBe("dark");
    expect(classifyLogo(dark, "image/svg+xml")).toBe("light");
  });

  it("returns null when it cannot decode the image", () => {
    expect(classifyLogo(new Uint8Array([1, 2, 3]), "image/webp")).toBeNull();
    expect(classifyLogo(new Uint8Array([1, 2, 3]), "image/png")).toBeNull();
  });
});
