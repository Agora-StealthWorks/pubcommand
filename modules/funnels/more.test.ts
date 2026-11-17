import { describe, expect, it } from "vitest";
import { canOpenFunnels, delegateAllows, funnelAccess, visibleFunnelIds } from "./delegates";
import { deadlineButtonHref, deadlineShowsOn, dismissKey, isDismissed, normalizeDeadlineButtonUrl, normalizeDeadlinePages, rememberDismiss } from "./deadline";
import {
  MAX_LATE_MINUTES,
  describeOffset,
  dueReminders,
  fillMergeTags,
  mergeValues,
  noSessionsReason,
  offsetFromInput,
  offsetToInput,
  reminderSendAt,
  reminderSessions,
  renderEmail,
  sendKey,
  unknownTags,
  unsubscribeToken,
  verifyUnsubscribeToken,
  type ReminderSession,
} from "./emails";
import { captureSmsOptin, smsConsentText, smsFormProblems } from "./sms";
import { reactAttrs, splitHeadCode } from "./code";
import { classifyTraffic, clientIpOf, filterTraffic, ipv4ToInt, ipv6ToBigInt, isBotUserAgent, isDatacenterIp, parseCidr4 } from "./traffic";

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";

describe("bot and data-center traffic", () => {
  it("flags bot, previewer, scanner and library user agents, and missing ones", () => {
    expect(isBotUserAgent(null)).toBe(true);
    expect(isBotUserAgent("")).toBe(true);
    expect(isBotUserAgent("Mozilla/5.0")).toBe(true);
    expect(isBotUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(true);
    expect(isBotUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36")).toBe(true);
    expect(isBotUserAgent("facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)")).toBe(true);
    expect(isBotUserAgent("Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)")).toBe(true);
    expect(isBotUserAgent("python-requests/2.31.0 something longer")).toBe(true);
    expect(isBotUserAgent("curl/8.4.0 (x86_64-pc-linux-gnu) libcurl")).toBe(true);
    expect(isBotUserAgent(CHROME)).toBe(false);
    expect(isBotUserAgent(IPHONE)).toBe(false);
  });

  it("parses IPv4, IPv6 and CIDR ranges", () => {
    expect(ipv4ToInt("1.2.3.4")).toBe(0x01020304);
    expect(ipv4ToInt("256.1.1.1")).toBeNull();
    expect(ipv4ToInt("1.2.3")).toBeNull();
    expect(parseCidr4("10.1.2.3/8")).toEqual({ start: 0x0a000000, end: 0x0affffff });
    expect(ipv6ToBigInt("::1")).toBe(1n);
    expect(ipv6ToBigInt("2600:1f00::1")).toBe((0x2600n << 112n) + (0x1f00n << 96n) + 1n);
    expect(ipv6ToBigInt("::ffff:1.2.3.4")).toBe((0xffffn << 32n) + 0x01020304n);
    expect(ipv6ToBigInt("1:2:3")).toBeNull();
    expect(ipv6ToBigInt("not-an-ip")).toBeNull();
  });

  it("knows the big clouds and mail scanners, and leaves home and mobile networks alone", () => {
    expect(isDatacenterIp("3.85.10.20")).toBe(true); // AWS
    expect(isDatacenterIp("35.190.1.1")).toBe(true); // Google Cloud
    expect(isDatacenterIp("40.94.30.2")).toBe(true); // Microsoft
    expect(isDatacenterIp("52.100.1.1")).toBe(true); // Office 365
    expect(isDatacenterIp("159.65.12.9")).toBe(true); // DigitalOcean
    expect(isDatacenterIp("148.163.130.5")).toBe(true); // Proofpoint
    expect(isDatacenterIp("2600:1f18:abcd::1")).toBe(true); // AWS IPv6
    expect(isDatacenterIp("::ffff:3.85.10.20")).toBe(true); // IPv4-mapped
    expect(isDatacenterIp("73.15.200.1")).toBe(false); // Comcast
    expect(isDatacenterIp("172.56.20.1")).toBe(false); // T-Mobile
    expect(isDatacenterIp("192.168.1.10")).toBe(false);
    expect(isDatacenterIp("2601:600:abcd::1")).toBe(false); // Comcast IPv6
    expect(isDatacenterIp(null)).toBe(false);
    expect(isDatacenterIp("garbage")).toBe(false);
    expect(isDatacenterIp("73.15.200.1", ["73.15.0.0/16"])).toBe(true);
  });

  it("classifies a request: user agent, then network, then webdriver", () => {
    expect(classifyTraffic({ userAgent: CHROME, ip: "73.15.200.1" })).toBeNull();
    expect(classifyTraffic({ userAgent: "Googlebot/2.1 (+http://www.google.com/bot.html)", ip: "73.15.200.1" })).toBe("user_agent");
    expect(classifyTraffic({ userAgent: CHROME, ip: "52.100.1.1" })).toBe("datacenter");
    expect(classifyTraffic({ userAgent: CHROME, ip: "73.15.200.1", webdriver: true })).toBe("webdriver");
  });

  it("leaves flagged rows out of stats unless asked, and counts them", () => {
    const rows = [
      { visitorId: "a", botReason: null },
      { visitorId: "b", botReason: "datacenter" },
      { visitorId: "b", botReason: "datacenter" },
      { visitorId: "c", botReason: "user_agent" },
    ];
    const people = filterTraffic(rows);
    expect(people.kept.map((row) => row.visitorId)).toEqual(["a"]);
    expect(people).toMatchObject({ flagged: 3, flaggedVisitors: 2, byReason: { datacenter: 2, user_agent: 1 } });
    expect(filterTraffic(rows, true).kept).toHaveLength(4);
  });

  it("reads the first forwarded hop", () => {
    const headers = new Headers({ "x-forwarded-for": "73.15.200.1, 10.0.0.1" });
    expect(clientIpOf(headers)).toBe("73.15.200.1");
    expect(clientIpOf(new Headers({ "x-real-ip": "1.1.1.1" }))).toBe("1.1.1.1");
    expect(clientIpOf(new Headers())).toBeNull();
  });
});

const T0 = new Date("2026-12-01T19:00:00Z");
const session = (key: string, startAt: Date): ReminderSession => ({ key, label: key, title: `Session ${key}`, startAt, path: `/day-${key}`, roomUrl: "https://room.example.com" });

describe("invites and reminders", () => {
  const reminders = [
    { id: "r24", enabled: true, offsetMinutes: 1440 },
    { id: "r1", enabled: true, offsetMinutes: 60 },
    { id: "r0", enabled: true, offsetMinutes: 0 },
    { id: "off", enabled: false, offsetMinutes: 30 },
  ];
  const optins = [
    { id: "early", createdAt: new Date("2026-11-20T00:00:00Z"), unsubscribedAt: null },
    { id: "late", createdAt: new Date("2026-12-01T18:30:00Z"), unsubscribedAt: null },
    { id: "gone", createdAt: new Date("2026-11-20T00:00:00Z"), unsubscribedAt: new Date("2026-11-25T00:00:00Z") },
  ];
  const sessions = [session("1", T0), session("2", new Date(T0.getTime() + 86_400_000))];

  it("times each reminder against each session", () => {
    expect(reminderSendAt(sessions[0]!, 1440).toISOString()).toBe("2026-11-30T19:00:00.000Z");
    expect(reminderSendAt(sessions[0]!, 0)).toEqual(T0);
  });

  it("sends the 24-hour reminder for session 1 one day ahead, only to people who signed up before then", () => {
    const due = dueReminders({ reminders, sessions, optins, sent: new Set(), now: new Date("2026-11-30T19:05:00Z") });
    expect(due.map((item) => `${item.emailId}:${item.optinId}:${item.sessionKey}`)).toEqual(["r24:early:1"]);
  });

  it("skips people who joined after a reminder's send time", () => {
    const due = dueReminders({ reminders, sessions, optins, sent: new Set(), now: new Date("2026-12-01T18:00:30Z") });
    expect(due.map((item) => `${item.emailId}:${item.optinId}`)).toEqual(["r1:early"]);
    const later = dueReminders({ reminders, sessions, optins, sent: new Set(), now: new Date("2026-12-01T19:00:10Z") });
    expect(later.map((item) => `${item.emailId}:${item.optinId}:${item.sessionKey}`).sort()).toEqual(["r0:early:1", "r0:late:1", "r24:early:2", "r24:late:2"]);
  });

  it("never sends twice, never to the unsubscribed, never a disabled template", () => {
    const now = new Date("2026-11-30T19:05:00Z");
    const sent = new Set([sendKey("r24", "early", "1")]);
    expect(dueReminders({ reminders, sessions, optins, sent, now })).toEqual([]);
    expect(dueReminders({ reminders, sessions, optins, sent: new Set(), now }).some((item) => item.optinId === "gone" || item.emailId === "off")).toBe(false);
  });

  it("skips a reminder that is too late or whose session already started", () => {
    const tooLate = new Date(new Date("2026-11-30T19:00:00Z").getTime() + (MAX_LATE_MINUTES + 1) * 60_000);
    expect(dueReminders({ reminders: [reminders[0]!], sessions: [sessions[0]!], optins, sent: new Set(), now: tooLate })).toEqual([]);
    expect(dueReminders({ reminders: [reminders[1]!], sessions: [sessions[0]!], optins, sent: new Set(), now: new Date(T0.getTime() + 1000) })).toEqual([]);
    // "At the start" stays due for 30 minutes.
    expect(dueReminders({ reminders: [reminders[2]!], sessions: [sessions[0]!], optins, sent: new Set(), now: new Date(T0.getTime() + 29 * 60_000) })).toHaveLength(2);
    expect(dueReminders({ reminders: [reminders[2]!], sessions: [sessions[0]!], optins, sent: new Set(), now: new Date(T0.getTime() + 31 * 60_000) })).toHaveLength(0);
  });

  it("finds sessions: live days on a live funnel, the start on a fixed evergreen funnel, none per viewer", () => {
    const days = [
      { id: "d1", position: 1, label: "Day 1", title: "Kickoff", isLive: true, liveStartAt: T0, liveUrl: null, liveOverride: "auto" },
      { id: "d2", position: 2, label: "Day 2", title: "Cancelled", isLive: true, liveStartAt: T0, liveUrl: null, liveOverride: "off" },
      { id: "d3", position: 3, label: "Day 3", title: "Replay", isLive: false, liveStartAt: null, liveUrl: null, liveOverride: "auto" },
    ];
    const live = { mode: "live", timing: "fixed", startAt: T0, livestreamUrl: "https://room", name: "Launch" };
    expect(reminderSessions(live, days).map((item) => [item.key, item.path, item.roomUrl])).toEqual([["d1", "/day-1", "https://room"]]);
    expect(reminderSessions({ ...live, mode: "evergreen" }, days).map((item) => item.key)).toEqual(["start"]);
    const perViewer = { ...live, mode: "evergreen", timing: "per_viewer" };
    expect(reminderSessions(perViewer, days)).toEqual([]);
    expect(noSessionsReason(perViewer, [])).toMatch(/Per-viewer/);
  });

  it("fills merge tags, escaping values in HTML and keeping unknown tags visible", () => {
    const values = { funnel: "Fish & <Chips>", session: "Day 1", unsubscribe_url: "https://x/u?a=1&b=2" };
    expect(fillMergeTags("Hi {funnel} {session} {nope} {date}", values, "text")).toBe("Hi Fish & <Chips> Day 1 {nope} ");
    expect(fillMergeTags("<p>{funnel}</p>", values, "html")).toBe("<p>Fish &amp; &lt;Chips&gt;</p>");
    expect(unknownTags("{funnel} {first_name} {first_name}")).toEqual(["first_name"]);
  });

  it("builds merge values from a session in the org time zone", () => {
    const values = mergeValues({ funnelName: "Launch", company: "Acme", email: "a@b.co", session: session("1", T0), timeZone: "America/New_York", now: new Date(T0.getTime() - 60 * 60_000), pageUrl: "https://acme/l/x/day-1", unsubscribeUrl: "https://u" });
    expect(values.date).toBe("Tuesday, December 1 at 2:00 PM EST");
    expect(values.time).toBe("2:00 PM EST");
    expect(values.starts_in).toBe("1 hour");
    expect(values.room_url).toBe("https://room.example.com");
  });

  it("always carries an unsubscribe link", () => {
    const withTag = renderEmail({ subject: "{funnel}", bodyHtml: '<p>Hi</p><p><a href="{unsubscribe_url}">Stop</a></p>' }, { funnel: "Launch", unsubscribe_url: "https://u/1" });
    expect(withTag.html.match(/https:\/\/u\/1/g)).toHaveLength(1);
    const without = renderEmail({ subject: "", bodyHtml: "<p>Hi</p>" }, { funnel: "Launch", unsubscribe_url: "https://u/1" });
    expect(without.subject).toBe("Launch");
    expect(without.html).toContain('href="https://u/1"');
    expect(without.text).toContain("Unsubscribe (https://u/1)");
  });

  it("converts offsets to and from the builder's fields", () => {
    expect(offsetFromInput("2", "hours")).toBe(120);
    expect(offsetFromInput("1", "days")).toBe(1440);
    expect(offsetFromInput("-5", "minutes")).toBe(0);
    expect(offsetFromInput("99", "days")).toBe(30 * 1440);
    expect(offsetToInput(1440)).toEqual({ amount: 1, unit: "days" });
    expect(offsetToInput(90)).toEqual({ amount: 90, unit: "minutes" });
    expect(describeOffset(60)).toBe("1 hour before");
    expect(describeOffset(0)).toBe("At the start");
  });

  it("signs unsubscribe links", () => {
    const token = unsubscribeToken("optin-1", "secret-secret-secret");
    expect(token).toHaveLength(32);
    expect(verifyUnsubscribeToken("optin-1", token, "secret-secret-secret")).toBe(true);
    expect(verifyUnsubscribeToken("optin-2", token, "secret-secret-secret")).toBe(false);
    expect(verifyUnsubscribeToken("optin-1", token, "another-secret-xx")).toBe(false);
    expect(verifyUnsubscribeToken("optin-1", "short", "secret-secret-secret")).toBe(false);
  });
});

describe("SMS opt-in forms", () => {
  const form = { companyName: "Acme Media", programName: "VIP Alerts", messageFrequency: "Up to 4 msgs/week", helpContact: "", privacyUrl: "https://acme.test/privacy", termsUrl: "https://acme.test/sms-terms", customConsent: "", collectEmail: true };

  it("uses the standard consent wording unless the form has its own", () => {
    expect(smsConsentText(form)).toContain("Acme Media (VIP Alerts)");
    expect(smsConsentText(form)).toContain("https://acme.test/sms-terms");
    expect(smsConsentText({ ...form, customConsent: "  I agree\n to texts.  " })).toBe("I agree to texts.");
    expect(smsFormProblems({ ...form, termsUrl: null, programName: "" })).toEqual(["Name the text program (e.g. “VIP Text Alerts”).", "Add an SMS terms link."]);
  });

  it("captures a phone with the exact consent shown, and refuses stale or unchecked consent", () => {
    const shown = smsConsentText(form);
    const ok = captureSmsOptin({ phone: "(212) 555-0199", email: "A@B.co", consentChecked: true, shownConsent: shown, honeypot: "" }, form);
    expect(ok).toEqual({ ok: true, phone: "+12125550199", email: "a@b.co", consentText: shown });
    expect(captureSmsOptin({ phone: "212 555 0199", email: "", consentChecked: false, shownConsent: shown, honeypot: "" }, form).ok).toBe(false);
    expect(captureSmsOptin({ phone: "212 555 0199", email: "", consentChecked: true, shownConsent: "older text", honeypot: "" }, form)).toMatchObject({ ok: false, error: expect.stringMatching(/updated/) });
    expect(captureSmsOptin({ phone: "12", email: "", consentChecked: true, shownConsent: shown, honeypot: "" }, form).ok).toBe(false);
    expect(captureSmsOptin({ phone: "212 555 0199", email: "nope", consentChecked: true, shownConsent: shown, honeypot: "" }, form)).toMatchObject({ ok: false });
    expect(captureSmsOptin({ phone: "212 555 0199", email: "", consentChecked: true, shownConsent: shown, honeypot: "x" }, form)).toMatchObject({ ok: false, spam: true });
  });
});

describe("deadline bar pages, button and dismiss", () => {
  it("shows only on the chosen page kinds", () => {
    expect(normalizeDeadlinePages(["day", "bogus", "home"])).toEqual(["home", "day"]);
    expect(deadlineShowsOn(["home", "waitlist", "day", "custom"], "custom")).toBe(true);
    expect(deadlineShowsOn(["home"], "day")).toBe(false);
    expect(deadlineShowsOn(null, "day")).toBe(false);
  });

  it("links the button to a module or a web address only", () => {
    expect(deadlineButtonHref("module:2", "/l/x", "?preview=1")).toBe("/l/x/day-2?preview=1");
    expect(deadlineButtonHref("https://shop.example.com/buy", "/l/x")).toBe("https://shop.example.com/buy");
    expect(deadlineButtonHref("javascript:alert(1)", "/l/x")).toBeNull();
    expect(normalizeDeadlineButtonUrl(" javascript:alert(1) ")).toBe("");
    expect(normalizeDeadlineButtonUrl("module:3")).toBe("module:3");
  });

  it("remembers a dismissal per deadline, and survives blocked storage", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
    const key = dismissKey("1234-abcd", Date.UTC(2026, 11, 1));
    expect(isDismissed(storage, key)).toBe(false);
    rememberDismiss(storage, key);
    expect(isDismissed(storage, key)).toBe(true);
    // A moved deadline is a new key: the bar shows again.
    expect(isDismissed(storage, dismissKey("1234-abcd", Date.UTC(2026, 11, 2)))).toBe(false);
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => rememberDismiss(blocked, key)).not.toThrow();
    expect(isDismissed(blocked, key)).toBe(false);
    expect(isDismissed(null, key)).toBe(false);
  });
});

describe("delegates", () => {
  const none = { read: false, write: false, publish: false };
  const viewer = { read: true, write: false, publish: false };
  const admin = { read: true, write: true, publish: true };

  it("lets a delegate read and edit their funnel, never publish", () => {
    expect(funnelAccess(none, true)).toEqual({ read: true, write: true, publish: false, delegate: true });
    expect(funnelAccess(viewer, true)).toEqual({ read: true, write: true, publish: false, delegate: true });
    expect(funnelAccess(none, false)).toEqual({ read: false, write: false, publish: false, delegate: false });
    expect(funnelAccess(admin, true)).toEqual({ ...admin, delegate: false });
    expect(delegateAllows("funnels.write")).toBe(true);
    expect(delegateAllows("funnels.publish")).toBe(false);
  });

  it("shows a delegate only their funnels", () => {
    expect(canOpenFunnels(none, 0)).toBe(false);
    expect(canOpenFunnels(none, 1)).toBe(true);
    expect(visibleFunnelIds(none, ["a", "b", "c"], ["c", "z"])).toEqual(["c"]);
    expect(visibleFunnelIds(viewer, ["a", "b"], [])).toEqual(["a", "b"]);
  });
});

describe("header and footer code", () => {
  it("moves meta and link tags to the head and keeps scripts in the body", () => {
    const code = `<meta name="facebook-domain-verification" content="abc123" />
<link rel="preconnect" href="https://connect.facebook.net">
<link rel="stylesheet" href="javascript:alert(1)">
<!-- Meta Pixel --><script>!function(f){f.fbq=1}(window);</script>
<noscript><img height="1" width="1" src="https://www.facebook.com/tr?id=1&ev=PageView"/><meta name="x" content="kept"></noscript>`;
    const { headTags, bodyHtml } = splitHeadCode(code);
    expect(headTags).toEqual([
      { tag: "meta", attrs: { name: "facebook-domain-verification", content: "abc123" } },
      { tag: "link", attrs: { rel: "preconnect", href: "https://connect.facebook.net" } },
    ]);
    expect(bodyHtml).toContain("<script>!function(f){f.fbq=1}(window);</script>");
    expect(bodyHtml).toContain('<meta name="x" content="kept">');
    expect(bodyHtml).not.toContain("javascript:");
    expect(reactAttrs({ "http-equiv": "x", crossorigin: "" })).toEqual({ httpEquiv: "x", crossOrigin: "" });
  });
});
