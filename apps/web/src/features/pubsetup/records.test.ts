import { describe, expect, it } from "vitest";
import { EDITOR_FIELDS, PUBLICATION_FIELDS, parseFields } from "../../../../../modules/pubsetup/fields";
import { formFrom } from "./records";

describe("agent fields as Publication Setup form values", () => {
  it("validates a new publication like the settings form", () => {
    const ok = parseFields(PUBLICATION_FIELDS, formFrom(PUBLICATION_FIELDS, { status: "active", color: "#1f2a44" }, { name: "Oxford Income Letter", code: "OIL", deliverables: ["Monthly issue", "Weekly update"], launchDate: "2026-12-01" }));
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.values.name).toBe("Oxford Income Letter");
      expect(ok.values.deliverables).toEqual(["Monthly issue", "Weekly update"]);
    }
    const missing = parseFields(PUBLICATION_FIELDS, formFrom(PUBLICATION_FIELDS, { status: "active", color: "#1f2a44" }, { name: "No code" }));
    expect(missing.ok).toBe(false);
  });

  it("keeps stored values on an update and only changes what was sent", () => {
    const stored = { name: "Alexander Green", slug: "alexander-green", status: "active", title: "Chief Investment Strategist", specialties: ["Income", "Value"], socialLinks: [{ label: "X", url: "https://x.com/ag" }] };
    const parsed = parseFields(EDITOR_FIELDS, formFrom(EDITOR_FIELDS, stored, { title: "Chief Strategist" }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.values.name).toBe("Alexander Green");
      expect(parsed.values.title).toBe("Chief Strategist");
      expect(parsed.values.specialties).toEqual(["Income", "Value"]);
      expect(parsed.values.socialLinks).toEqual([expect.objectContaining({ url: "https://x.com/ag" })]);
    }
  });
});
