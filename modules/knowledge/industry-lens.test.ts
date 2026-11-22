import { describe, expect, it } from "vitest";
import { frameFolder, frameNote, framePath, frameText, frameTitle, needsFraming } from "./industry-lens";

describe("industry lens", () => {
  it("frames the Intel notes organizations teach", () => {
    expect(frameTitle("Competitor promo: Banyan Hill: The AI melt-up")).toBe("Industry promo: Banyan Hill: The AI melt-up");
    expect(frameText("Competitor promo email from **Banyan Hill**, sent 2026-11-01. Captured by Intel.")).toBe("Industry promo email from **Banyan Hill**, sent 2026-11-01. Captured by Intel.");
    expect(frameFolder("Competitor intel")).toBe("Industry intel");
  });

  it("takes no side in prose", () => {
    expect(frameText("Our competitors lean on urgency. MTA's main competitors run webinars.")).toBe("other publishers lean on urgency. other publishers run webinars.");
    expect(frameText("A competitor's guarantee beats the competitor down the street.")).toBe("A publisher's guarantee beats the publisher down the street.");
    expect(frameText("Competition is fierce and competitive pricing matters.")).toBe("Competition is fierce and competitive pricing matters.");
  });

  it("renames link targets and titles together so links still resolve", () => {
    expect(frameText("See [[Competitor Promos#P001 — X|X]] and [[Agora/competitor notes]].")).toBe("See [[Industry Promos#P001 — X|X]] and [[Agora/competitor notes]].");
    expect(framePath("Resources/Promo Analysis/Promo Database/Competitor Promos.md")).toBe("Resources/Promo Analysis/Promo Database/Industry Promos.md");
    expect(framePath("Resources/Competitors/Past Competitor Editorial/Note.md")).toBe("Resources/Industry Companies/Past Industry Editorial/Note.md");
    expect(framePath("Areas/MTA/Plan.md")).toBe("Areas/MTA/Plan.md");
  });

  it("leaves code and URLs alone, and is idempotent", () => {
    const text = "Visit https://example.com/competitors and run `competitor --list`. Competitors matter.";
    expect(frameText(text)).toBe("Visit https://example.com/competitors and run `competitor --list`. Publishers matter.");
    const note = { title: "Competitor email: Agora", body: "Our competitors.", folder: "Resources/Competitors" };
    const once = frameNote(note);
    expect(frameNote(once)).toEqual(once);
    expect(needsFraming(note)).toBe(true);
    expect(needsFraming(once)).toBe(false);
  });
});
