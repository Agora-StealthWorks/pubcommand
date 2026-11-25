import { describe, expect, it } from "vitest";
import { lookFrom } from "./article";

const base = { theme: "t-letter", headerBg: "#0f2440", accentColor: "#1c5fd6", logoHeight: 34 };

describe("Mini-Blog look colors", () => {
  it("falls back to the theme page and the link color for buttons", () => {
    const look = lookFrom(base);
    expect(look.pageBg).toBe("#f4f6f9");
    expect(look.buttonColor).toBe("#1c5fd6");
    expect(look.pageMuted).toBe("#64748b");
  });

  it("uses its own page background and button color", () => {
    const look = lookFrom({ ...base, pageBg: "#FDE68A", buttonColor: "#16a34a" });
    expect(look.pageBg).toBe("#fde68a");
    expect(look.buttonColor).toBe("#16a34a");
    expect(look.accentColor).toBe("#1c5fd6");
    expect(look.buttonText).toBe("#ffffff");
  });

  it("keeps footer text readable on a dark page", () => {
    expect(lookFrom({ ...base, pageBg: "#111111" }).pageMuted).toBe("rgba(255,255,255,0.78)");
    expect(lookFrom({ ...base, pageBg: "#fff7ed" }).pageMuted).toBe("rgba(17,24,39,0.7)");
  });

  it("swaps a link color that does not read on the page for one that does", () => {
    expect(lookFrom({ ...base, pageBg: "#1e293b" }).pageLink).toBe("#ffffff");
    expect(lookFrom(base).pageLink).toBe("#1c5fd6");
  });

  it("ignores values that are not colors", () => {
    const look = lookFrom({ ...base, pageBg: "red; x", buttonColor: "" });
    expect(look.pageBg).toBe("#f4f6f9");
    expect(look.buttonColor).toBe("#1c5fd6");
  });
});
