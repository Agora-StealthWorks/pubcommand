import { describe, expect, it } from "vitest";
import { RESERVED_SLUGS, validateSlug } from "./slug";

describe("validateSlug", () => {
  it("accepts a lowercase slug and normalizes case", () => {
    expect(validateSlug("Agora")).toEqual({ ok: true, slug: "agora" });
    expect(validateSlug("example-gazette")).toEqual({ ok: true, slug: "example-gazette" });
    expect(validateSlug("a".repeat(40)).ok).toBe(true);
  });

  it("rejects short, long, and malformed slugs", () => {
    expect(validateSlug("ab")).toEqual({ ok: false, reason: "invalid" });
    expect(validateSlug(`${"a".repeat(41)}`)).toEqual({ ok: false, reason: "invalid" });
    expect(validateSlug("-agora")).toEqual({ ok: false, reason: "invalid" });
    expect(validateSlug("agora-")).toEqual({ ok: false, reason: "invalid" });
    expect(validateSlug("ago ra")).toEqual({ ok: false, reason: "invalid" });
    expect(validateSlug("agora.com")).toEqual({ ok: false, reason: "invalid" });
  });

  it("reserves host labels used by the platform", () => {
    for (const slug of RESERVED_SLUGS) {
      expect(validateSlug(slug)).toEqual({ ok: false, reason: "reserved" });
    }
  });
});
