import { describe, expect, it } from "vitest";
import { AIRTABLE_SYNC_ENABLED, CUB_COLLECTOR_ENABLED, EDITORIAL_ANALYTICS_ENABLED, SEND_STATS_ENABLED, WHATS_WORKING_ENABLED } from "./features";
import { manifest } from "./manifest";
import { launchDay, launchFormat, nameList, planLaunchEvent, promoChanges, promoIsSchedulable, type PromoSnapshot } from "./promos";
import { filterFeed, type FeedItem } from "./stages";
import { eventTypeColor, mondayOf, weekOffset, weekStrip, weekTitle } from "./week";

const base = { name: "Year-End Promo", stage: "Committed", format: "VSL", product: "PSU", gurus: ["Nate"], launchDate: "2026-12-10", targetedDate: null, launchEventCreated: false };

describe("calendar promos", () => {
  it("schedules a launch event only past Idea and only once", () => {
    expect(promoIsSchedulable("Idea")).toBe(false);
    expect(promoIsSchedulable("Tabled")).toBe(false);
    expect(promoIsSchedulable("Writing")).toBe(true);
    expect(planLaunchEvent({ ...base, stage: "Idea" }, null)).toEqual({ action: "none" });
    expect(planLaunchEvent(base, null)).toEqual({ action: "create", name: "Year-End Promo", eventDate: "2026-12-10", format: "Video drop", offer: "PSU", hosts: ["Nate"] });
    // Created once: a live launch event follows the promo, a deleted one is never re-created.
    expect(planLaunchEvent({ ...base, launchEventCreated: true }, { live: true })).toEqual({ action: "update", name: "Year-End Promo", eventDate: "2026-12-10" });
    expect(planLaunchEvent({ ...base, launchEventCreated: true }, { live: false })).toEqual({ action: "none" });
    expect(planLaunchEvent({ ...base, launchEventCreated: true }, null)).toEqual({ action: "none" });
    expect(planLaunchEvent({ ...base, launchDate: null }, null)).toEqual({ action: "none" });
  });

  it("uses the launch date, else the targeted date", () => {
    expect(launchDay({ launchDate: null, targetedDate: "2026-12-01" })).toBe("2026-12-01");
    expect(launchDay({ launchDate: "2026-12-05", targetedDate: "2026-12-01" })).toBe("2026-12-05");
    expect(launchDay({ launchDate: "bad", targetedDate: null })).toBeNull();
    expect(launchFormat("Live webinar (hotlist build)")).toBe("Webinar");
    expect(launchFormat("Open house")).toBe("Open house");
    expect(launchFormat(null)).toBeNull();
  });

  it("logs only the tracked fields that changed", () => {
    const before: PromoSnapshot = { name: "A", stage: "Idea", promoType: null, format: null, product: "PSU", writers: ["Ann"], gurus: [], launchDate: null, launchEstimated: false, targetedDate: null };
    const after: PromoSnapshot = { ...before, stage: "Writing", launchDate: "2026-12-10", writers: ["Ann", "Bo"] };
    expect(promoChanges(before, after)).toEqual([
      { kind: "stage", field: "Stage", fromValue: "Idea", toValue: "Writing" },
      { kind: "launchDate", field: "Launch date", fromValue: null, toValue: "2026-12-10" },
      { kind: "field", field: "Copywriters", fromValue: "Ann", toValue: "Ann, Bo" },
    ]);
    expect(promoChanges(before, { ...before })).toEqual([]);
    expect(nameList(" Ann ,Bo\nAnn,, ")).toEqual(["Ann", "Bo"]);
  });
});

describe("this week strip", () => {
  const events = [
    { id: "a", name: "Zeta call", eventDate: "2026-11-16", eventEnd: null },
    { id: "b", name: "Alpha open house", eventDate: "2026-11-18", eventEnd: "2026-11-20" },
    { id: "c", name: "Weekend thing", eventDate: "2026-11-22", eventEnd: null },
    { id: "d", name: "Undated", eventDate: null, eventEnd: null },
  ];

  it("finds Monday in calendar-day terms (weekend days belong to the week before)", () => {
    expect(mondayOf("2026-11-20")).toBe("2026-11-16");
    expect(mondayOf("2026-11-16")).toBe("2026-11-16");
    expect(mondayOf("2026-11-22")).toBe("2026-11-16");
    expect(mondayOf("2026-11-23")).toBe("2026-11-23");
  });

  it("lists every event on each day it runs, sorted by name, Monday to Friday", () => {
    const strip = weekStrip(events, "2026-11-20", 0);
    expect(strip.days.map((d) => d.date)).toEqual(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]);
    expect(strip.days.map((d) => d.events.map((e) => e.id))).toEqual([["a"], [], ["b"], ["b"], ["b"]]);
    expect(strip.days[4]!.isToday).toBe(true);
    expect(strip.total).toBe(2);
    expect(strip.range).toBe("Nov 16 – Nov 20");
    expect(strip.title).toBe("This week");
    const both = weekStrip([...events, { id: "e", name: "Beta", eventDate: "2026-11-18", eventEnd: null }], "2026-11-20", 0);
    expect(both.days[2]!.events.map((e) => e.name)).toEqual(["Alpha open house", "Beta"]);
  });

  it("moves by whole weeks and names them", () => {
    const next = weekStrip(events, "2026-11-20", 1);
    expect(next.days[0]!.date).toBe("2026-11-23");
    expect(next.days.every((d) => !d.isToday)).toBe(true);
    expect(weekTitle(-1)).toBe("Last week");
    expect(weekTitle(1)).toBe("Next week");
    expect(weekTitle(3)).toBe("Week of");
    expect(weekOffset("2")).toBe(2);
    expect(weekOffset("x")).toBe(0);
    expect(weekOffset("-999")).toBe(-104);
    expect(eventTypeColor("Sales event")).toBe("#12b76a");
    expect(eventTypeColor("Something new")).toBe(eventTypeColor("something new"));
  });

  it("filters the list by event type", () => {
    const item = (over: Partial<FeedItem>): FeedItem => ({ kind: "event", id: "x", title: "x", date: "2026-11-20", until: "2026-11-20", stage: "Planned", type: "Sales event", channels: [], publicationCode: null, recurring: false, search: "x", ...over });
    const out = filterFeed([item({ id: "1" }), item({ id: "2", type: "Member event" }), item({ id: "3", kind: "issue", type: "Sales event" })], { today: "2026-11-01", type: "Sales event" });
    expect(out.map((i) => i.id)).toEqual(["1"]);
  });
});

describe("switched-off features", () => {
  it("are off and gone from the manifest", () => {
    expect([CUB_COLLECTOR_ENABLED, SEND_STATS_ENABLED, WHATS_WORKING_ENABLED, EDITORIAL_ANALYTICS_ENABLED, AIRTABLE_SYNC_ENABLED]).toEqual([false, false, false, false, false]);
    const paths = manifest.routes.map((r) => r.path);
    for (const off of ["/editorial/cub", "/editorial/stats", "/editorial/analytics", "/editorial/whats-working"]) expect(paths).not.toContain(off);
    expect(manifest.jobs?.map((j) => j.name)).not.toContain("editorial.cub-emails");
  });
});
