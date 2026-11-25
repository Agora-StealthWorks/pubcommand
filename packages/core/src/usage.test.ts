import { describe, expect, it } from "vitest";
import {
  DEFAULT_IDLE_TIMEOUT_MINUTES,
  activityParts,
  activitySummary,
  contentSnapshot,
  formatBytes,
  formatDuration,
  idleTimeoutLabel,
  idleTimeoutMinutes,
  parseIdleTimeoutChoice,
  sessionIdleExpired,
  sessionNeedsTouch,
  usageArea,
} from "./usage";

describe("idle sign-out", () => {
  it("defaults to 12 hours", () => {
    expect(DEFAULT_IDLE_TIMEOUT_MINUTES).toBe(720);
    expect(idleTimeoutMinutes(null)).toBe(720);
    expect(idleTimeoutLabel(null)).toBe("12 hours");
  });

  it("expires only after the timeout", () => {
    const now = new Date("2026-11-25T12:00:00Z");
    expect(sessionIdleExpired(new Date("2026-11-25T00:00:01Z"), null, now)).toBe(false);
    expect(sessionIdleExpired(new Date("2026-11-24T23:59:00Z"), null, now)).toBe(true);
    expect(sessionIdleExpired(new Date("2026-11-25T11:00:00Z"), 30, now)).toBe(true);
    expect(sessionIdleExpired(new Date("2026-11-20T12:00:00Z"), 10080, now)).toBe(false);
  });

  it("clamps silly values", () => {
    expect(idleTimeoutMinutes(1)).toBe(15);
    expect(idleTimeoutMinutes(10 ** 9)).toBe(43200);
  });

  it("parses the console choice", () => {
    expect(parseIdleTimeoutChoice("")).toEqual({ ok: true, minutes: null });
    expect(parseIdleTimeoutChoice("720")).toEqual({ ok: true, minutes: null });
    expect(parseIdleTimeoutChoice("60")).toEqual({ ok: true, minutes: 60 });
    expect(parseIdleTimeoutChoice("5").ok).toBe(false);
    expect(parseIdleTimeoutChoice("abc").ok).toBe(false);
  });

  it("touches at most once a minute", () => {
    const now = new Date("2026-11-25T12:00:00Z");
    expect(sessionNeedsTouch(new Date("2026-11-25T11:59:30Z"), now)).toBe(false);
    expect(sessionNeedsTouch(new Date("2026-11-25T11:58:59Z"), now)).toBe(true);
  });
});

describe("usageArea", () => {
  it("names the app and hides ids", () => {
    expect(usageArea("/")).toEqual({ app: "dashboard", area: "/" });
    expect(usageArea("/forms/2b1c3d4e-1111-2222-3333-444455556666/edit?tab=1")).toEqual({ app: "forms", area: "/forms/:id/edit" });
    expect(usageArea("/promo-studio/123/files/9/x/y")).toEqual({ app: "promo-studio", area: "/promo-studio/:id/files/:id" });
  });
});

describe("activity", () => {
  it("splits actions", () => {
    expect(activityParts("forms.form.created")).toEqual({ app: "forms", verb: "created" });
    expect(activitySummary({ action: "forms.form.created", targetType: "form", title: "Free Retirement Guide" })).toBe('created form "Free Retirement Guide"');
    expect(activitySummary({ action: "miniblog.post.published", targetType: "text_post" })).toBe("published text post");
  });
});

describe("contentSnapshot", () => {
  it("copies the words and skips secrets, contact details and plumbing", () => {
    const snap = contentSnapshot({
      id: "2b1c3d4e-1111-2222-3333-444455556666",
      organizationId: "x",
      title: "Free Retirement Guide",
      description: "<p>Get the <b>3 moves</b> to make before 2027.</p>",
      notifyEmail: "owner@example.com",
      tokenHash: "abc",
      primaryColor: "#ff0000",
      status: "PUBLISHED",
      settings: { submitLabel: "Send me the guide", redirectUrl: "https://example.com/thanks" },
      createdAt: new Date(),
    });
    expect(snap.title).toBe("Free Retirement Guide");
    expect(snap.content).toContain("Get the 3 moves to make before 2027.");
    expect(snap.content).toContain("submitLabel: Send me the guide");
    expect(snap.content).not.toContain("owner@example.com");
    expect(snap.content).not.toContain("abc");
    expect(snap.content).not.toContain("#ff0000");
    expect(snap.content).not.toContain("PUBLISHED");
    expect(snap.content).not.toContain("example.com/thanks");
  });

  it("returns null when there is no copy", () => {
    expect(contentSnapshot({ id: "1", status: "DRAFT" })).toEqual({ title: null, content: null });
  });
});

describe("format", () => {
  it("formats bytes and durations", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatDuration(30)).toBe("1m");
    expect(formatDuration(3 * 3600 + 600)).toBe("3h 10m");
  });
});
