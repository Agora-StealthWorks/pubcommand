import { describe, expect, it } from "vitest";
import { bodyParagraphs, fillPlaceholders, parseSystemEmailOverrides, SYSTEM_EMAIL_KEYS, SYSTEM_EMAILS, systemEmailCopy, systemEmailCopyProblem } from "./system-emails";

describe("system email copy", () => {
  it("has valid default copy for every email", () => {
    for (const key of SYSTEM_EMAIL_KEYS) expect(systemEmailCopyProblem(key, SYSTEM_EMAILS[key].defaults)).toBeNull();
  });

  it("merges edits field by field and ignores blank required fields", () => {
    const copy = systemEmailCopy("sign_in", { sign_in: { subject: "Your link", heading: "  ", footnote: "" } });
    expect(copy.subject).toBe("Your link");
    expect(copy.heading).toBe(SYSTEM_EMAILS.sign_in.defaults.heading);
    expect(copy.footnote).toBe("");
  });

  it("rejects placeholders the email doesn't have, empty fields, and multi-line one-liners", () => {
    const base = SYSTEM_EMAILS.password_reset.defaults;
    expect(systemEmailCopyProblem("password_reset", { ...base, subject: "Hi {organization}" })).toMatch(/\{organization\}.*\{minutes\}/);
    expect(systemEmailCopyProblem("sign_in", { ...SYSTEM_EMAILS.sign_in.defaults, body: "{minutes}" })).toMatch(/no placeholders/);
    expect(systemEmailCopyProblem("password_reset", { ...base, buttonLabel: " " })).toMatch(/Button label/);
    expect(systemEmailCopyProblem("password_reset", { ...base, heading: "a\nb" })).toMatch(/one line/);
    expect(systemEmailCopyProblem("password_reset", { ...base, subject: "x".repeat(151) })).toMatch(/too long/);
  });

  it("fills known placeholders and splits paragraphs at blank lines", () => {
    expect(fillPlaceholders("{minutes} min, {other}", { minutes: "30" })).toBe("30 min, {other}");
    expect(bodyParagraphs("One\r\ntwo\n\n\n  Three  \n")).toEqual(["One two", "Three"]);
  });

  it("keeps only known emails and string fields from stored edits", () => {
    expect(parseSystemEmailOverrides({ sign_in: { subject: "S", heading: 3, extra: "x" }, nope: { subject: "x" } })).toEqual({ sign_in: { subject: "S" } });
    expect(parseSystemEmailOverrides(null)).toEqual({});
    expect(parseSystemEmailOverrides([1])).toEqual({});
  });
});
