import { describe, expect, it } from "vitest";
import { uploadedImageType } from "./image-type";

const bytes = (text: string) => new TextEncoder().encode(text);
const svg = '<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect/></svg>';

describe("uploaded image type", () => {
  it("recognizes SVG logos whatever type the browser sent", () => {
    expect(uploadedImageType({ name: "logo.svg", type: "image/svg+xml" }, bytes(svg))).toBe("image/svg+xml");
    expect(uploadedImageType({ name: "logo.svg", type: "" }, bytes(svg))).toBe("image/svg+xml");
    expect(uploadedImageType({ name: "logo.svg", type: "text/xml" }, bytes("﻿<svg viewBox='0 0 1 1'></svg>"))).toBe("image/svg+xml");
  });

  it("refuses files that only pretend to be images", () => {
    expect(uploadedImageType({ name: "logo.svg", type: "image/svg+xml" }, bytes("<html><script>x</script></html>"))).toBeNull();
    expect(uploadedImageType({ name: "notes.txt", type: "text/plain" }, bytes("hello"))).toBeNull();
    expect(uploadedImageType({ name: "page.xml", type: "text/xml" }, bytes("<note/>"))).toBeNull();
  });

  it("keeps bitmap types and fills a missing type from the extension", () => {
    expect(uploadedImageType({ name: "a.png", type: "image/png" }, bytes("x"))).toBe("image/png");
    expect(uploadedImageType({ name: "a.JPG", type: "" }, bytes("x"))).toBe("image/jpeg");
  });
});
