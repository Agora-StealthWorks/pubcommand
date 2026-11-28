import { describe, expect, it } from "vitest";
import { NO_VALUE, paramBreakdown } from "./stats";
import {
  DEFAULT_TRACKED_PARAMS,
  cleanStoredParams,
  compactForCookie,
  mergeTouch,
  normalizeAttribution,
  normalizeParamKey,
  normalizeTrackedParams,
  paramsFromUrl,
  pickTrackedParams,
  trackedQuery,
} from "./tracking";
import { decodeViewer, emptyViewerCookie, encodeViewer, rememberParams } from "./viewer";
import { createHmac } from "node:crypto";

const SECRET = "a-test-secret-of-enough-length";

describe("tracked parameter list", () => {
  it("lowercases, validates, dedupes and caps at 20", () => {
    expect(normalizeParamKey(" UTM_Source ")).toBe("utm_source");
    expect(normalizeParamKey("utm-source")).toBeNull();
    expect(normalizeParamKey("a".repeat(41))).toBeNull();
    expect(normalizeParamKey("")).toBeNull();
    expect(normalizeTrackedParams(["utm_source", "UTM_SOURCE", "bad key", "gclid", 7])).toEqual(["utm_source", "gclid"]);
    expect(normalizeTrackedParams("utm_source, fbclid\nref")).toEqual(["utm_source", "fbclid", "ref"]);
    expect(normalizeTrackedParams(Array.from({ length: 30 }, (_, i) => `p${i}`))).toHaveLength(20);
    expect(normalizeTrackedParams(null)).toEqual([]);
    expect(DEFAULT_TRACKED_PARAMS).toContain("utm_campaign");
  });

  it("attribution defaults to first", () => {
    expect(normalizeAttribution("last")).toBe("last");
    expect(normalizeAttribution("LAST")).toBe("first");
    expect(normalizeAttribution(undefined)).toBe("first");
  });
});

describe("picking params", () => {
  const tracked = ["utm_source", "utm_campaign", "gclid"];

  it("keeps tracked keys only, trims and cuts values", () => {
    const query = new URLSearchParams({ UTM_Source: "  fb  ", utm_campaign: "x".repeat(300), other: "no", gclid: "   " });
    const picked = pickTrackedParams(query, tracked);
    expect(picked).toEqual({ utm_source: "fb", utm_campaign: "x".repeat(200) });
  });

  it("reads plain records (Next searchParams) and the first of repeated values", () => {
    expect(pickTrackedParams({ utm_source: ["a", "b"], gclid: "g1", preview: "1" }, tracked)).toEqual({ utm_source: "a", gclid: "g1" });
    expect(pickTrackedParams(new URLSearchParams("utm_source=a&utm_source=b"), tracked)).toEqual({ utm_source: "a" });
    expect(pickTrackedParams(null, tracked)).toEqual({});
    expect(pickTrackedParams({ utm_source: "a" }, [])).toEqual({});
  });

  it("reads a full URL (the Referer of a sync call)", () => {
    expect(paramsFromUrl("https://acme.example.com/l/launch/day-1?utm_source=email&k=abc", tracked)).toEqual({ utm_source: "email" });
    expect(paramsFromUrl("not a url", tracked)).toEqual({});
    expect(paramsFromUrl(null, tracked)).toEqual({});
  });

  it("strips control characters", () => {
    expect(pickTrackedParams({ utm_source: "a\u0000b" }, tracked)).toEqual({ utm_source: "a b" });
  });
});

describe("first vs last touch", () => {
  const a = { utm_source: "fb" };
  const b = { utm_source: "email", utm_campaign: "launch" };
  it("first keeps the existing set; last takes the newest non-empty set", () => {
    expect(mergeTouch(undefined, a, "first")).toEqual(a);
    expect(mergeTouch(a, b, "first")).toEqual(a);
    expect(mergeTouch(a, b, "last")).toEqual(b);
    expect(mergeTouch(a, {}, "last")).toEqual(a);
    expect(mergeTouch(undefined, {}, "first")).toBeUndefined();
  });
});

describe("stored params", () => {
  it("cleans anything read back", () => {
    expect(cleanStoredParams({ utm_source: "fb", "bad key": "x", n: 5, empty: "" })).toEqual({ utm_source: "fb" });
    expect(cleanStoredParams(["x"])).toBeUndefined();
    expect(cleanStoredParams(null)).toBeUndefined();
  });

  it("keeps the cookie part small", () => {
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`param_${i}`, "v".repeat(200)]));
    const compact = compactForCookie(many)!;
    expect(JSON.stringify(compact).length).toBeLessThanOrEqual(700);
    expect(Object.keys(compact).length).toBeGreaterThan(0);
  });

  it("builds a query to carry on a redirect", () => {
    expect(trackedQuery({ utm_source: "a b" })).toBe("utm_source=a+b");
    expect(trackedQuery(undefined)).toBe("");
  });
});

describe("viewer cookie params", () => {
  it("round-trips params and keeps old cookies decoding", () => {
    const viewer = rememberParams(emptyViewerCookie("visitor-123456"), { utm_source: "fb" }, "first");
    const decoded = decodeViewer(encodeViewer(viewer, SECRET), SECRET);
    expect(decoded?.params).toEqual({ utm_source: "fb" });
    // A cookie written before tracked parameters existed (no "p").
    const payload = Buffer.from(JSON.stringify({ v: "visitor-old-123", w: {}, k: [] })).toString("base64url");
    const old = `${payload}.${createHmac("sha256", SECRET).update(payload).digest("base64url")}`;
    const legacy = decodeViewer(old, SECRET);
    expect(legacy?.visitorId).toBe("visitor-old-123");
    expect(legacy?.params).toBeUndefined();
    // No params: the encoded cookie has no "p" at all.
    const plain = encodeViewer(emptyViewerCookie("visitor-123456"), SECRET).split(".")[0]!;
    expect(JSON.parse(Buffer.from(plain, "base64url").toString("utf8"))).not.toHaveProperty("p");
  });

  it("honours attribution and returns the same object when nothing changes", () => {
    const first = rememberParams(emptyViewerCookie("visitor-123456"), { utm_source: "fb" }, "first");
    expect(rememberParams(first, { utm_source: "email" }, "first")).toBe(first);
    expect(rememberParams(first, { utm_source: "email" }, "last").params).toEqual({ utm_source: "email" });
    expect(rememberParams(first, {}, "last")).toBe(first);
  });
});

describe("paramBreakdown", () => {
  const t = (minutes: number) => new Date(Date.UTC(2026, 10, 1, 12, minutes));
  const events = [
    { visitorId: "a", kind: "view", createdAt: t(0), params: null },
    { visitorId: "a", kind: "view", createdAt: t(1), params: { utm_source: "fb" } },
    { visitorId: "a", kind: "cta", createdAt: t(2), params: { utm_source: "email" } },
    { visitorId: "b", kind: "view", createdAt: t(0), params: { utm_source: "email" } },
    { visitorId: "b", kind: "resource", createdAt: t(1), params: { utm_source: "email" } },
    { visitorId: "c", kind: "view", createdAt: t(0), params: null },
    { visitorId: "c", kind: "deadline_bar", createdAt: t(1), params: { utm_medium: "x" } },
  ];
  const optins = [{ params: { utm_source: "fb" } }, { params: null }, { params: { utm_source: "email" } }, { params: { utm_source: "email" } }];

  it("buckets each visitor once by first touch", () => {
    const rows = paramBreakdown({ param: "utm_source", events, optins, attribution: "first" });
    expect(rows.map((row) => row.value)).toEqual(["email", "fb", NO_VALUE]);
    const fb = rows.find((row) => row.value === "fb")!;
    expect(fb).toMatchObject({ visitors: 1, views: 2, offerClicks: 1, clickers: 1, clickRate: 100, optins: 1 });
    const email = rows.find((row) => row.value === "email")!;
    expect(email).toMatchObject({ visitors: 1, views: 1, offerClicks: 0, clickRate: 0, optins: 2 });
    const none = rows.find((row) => row.value === NO_VALUE)!;
    expect(none).toMatchObject({ visitors: 1, views: 1, offerClicks: 1, optins: 1 });
    expect(rows.reduce((sum, row) => sum + row.visitors, 0)).toBe(3);
  });

  it("last touch moves the visitor to their newest value", () => {
    const rows = paramBreakdown({ param: "utm_source", events, optins: [], attribution: "last" });
    expect(rows.find((row) => row.value === "email")!.visitors).toBe(2);
    expect(rows.find((row) => row.value === "fb")).toBeUndefined();
  });

  it("is empty with no data", () => {
    expect(paramBreakdown({ param: "utm_source", events: [], optins: [], attribution: "first" })).toEqual([]);
  });
});

describe("attributedParams", () => {
  it("merges by attribution and drops keys no longer tracked", async () => {
    const { attributedParams } = await import("./tracking");
    expect(attributedParams({ utm_source: "fb", old_key: "x" }, { utm_source: "email" }, ["utm_source"], "first")).toEqual({ utm_source: "fb" });
    expect(attributedParams({ utm_source: "fb" }, { utm_source: "email" }, ["utm_source"], "last")).toEqual({ utm_source: "email" });
    expect(attributedParams({ old_key: "x" }, undefined, ["utm_source"], "first")).toBeUndefined();
    expect(attributedParams(undefined, undefined, [], "first")).toBeUndefined();
  });
});

describe("CSV param columns", () => {
  it("lists tracked keys first, then extra stored keys, and fills cells", async () => {
    const { paramColumns, paramCells } = await import("./tracking");
    const columns = paramColumns(["utm_source", "utm_medium"], [{ utm_source: "fb", gclid: "g" }, null, { ref: "x" }]);
    expect(columns).toEqual(["utm_source", "utm_medium", "gclid", "ref"]);
    expect(paramCells(columns, { utm_source: "fb", gclid: "g" })).toEqual(["fb", "", "g", ""]);
    expect(paramCells(columns, null)).toEqual(["", "", "", ""]);
  });
});
