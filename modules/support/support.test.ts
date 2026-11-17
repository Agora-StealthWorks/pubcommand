import { brandProfile } from "@pubcommand/core";
import { describe, expect, it } from "vitest";
import { configureAgent, createDocument, getDocumentText, webhookToolConfig, type Fetch } from "./elevenlabs";
import { findGaps, normalizeQuestion, parsePasted, readPostCall } from "./gaps";
import { checkContent, cleanOverrides } from "./gate";
import { renderGuide } from "./guide";
import { decryptSecret, encryptSecret, hashKey, keyMatches, mintAgentKey, presentedKey, rateDecision, signWebhook, verifyWebhookSignature } from "./keys";
import { chunkText, publishDecision, validateRecord } from "./records";
import { buildDocs, contentHash, type DocRecord } from "./render";
import { effectiveScope, normalizeScope, tradesAllowed } from "./scope";
import { classifyAccess, csvToPages, mapSiteStatus, matchProducts, normalizeUrl, preparePage, sheetCsvUrl } from "./site-pages";
import { editorDraft, noteToText, pricingDraft, publicationDraft, syncAction, type PubInput } from "./sources";
import { planPush, pullDecision, type SyncRow } from "./sync";
import { categoriesForNiche } from "./taxonomy";
import { toolsFor } from "./tools";
import { checkTradeQuery, selectTrades, tradeAnswer, type TradeRow } from "./trades";

describe("forbidden-content gate", () => {
  it("blocks internal material", () => {
    const cases = [
      "INTERNAL ONLY: renewal script",
      "This was our control promo last spring",
      "The conversion rate on this page is 4%",
      "Written by our copywriter Sam",
      "The big idea is the coming shortage",
      "Our upsell after the front-end offer",
      "Compared with a competitor's newsletter",
      "Use promo code SAVE50 at checkout",
      "Confidential: do not share",
      "card 4111 1111 1111 1111",
    ];
    for (const text of cases) expect(checkContent(text).ok, text).toBe(false);
  });

  it("lets ordinary customer answers through", () => {
    for (const text of ["To reset your password, click Forgot password on the login page.", "The Daily Edge is a daily newsletter written by Ada Lee.", "Call us at 1-800-555-1234, Monday to Friday."]) {
      expect(checkContent(text).ok, text).toBe(true);
    }
  });

  it("only overridable rules can be confirmed, and only by id", () => {
    expect(checkContent("Save 20% off this month", ["discount"]).ok).toBe(true);
    expect(checkContent("Internal only: 20% off", ["discount", "internal-marker"]).ok).toBe(false);
    expect(cleanOverrides(["discount", "internal-marker", 5, "nope"])).toEqual(["discount"]);
  });

  it("publishing needs a clean gate, and a price needs a confirmation", () => {
    const base = validateRecord({ category: "faqs", audience: "public", status: "published", title: "Refunds", body: "Ask within 30 days for a full refund." });
    if (!base.ok) throw new Error(base.error);
    expect(publishDecision(base.data).ok).toBe(true);
    expect(publishDecision({ ...base.data, body: "Our winning promo said so" }).ok).toBe(false);
    expect(publishDecision({ ...base.data, status: "draft", body: "Our winning promo said so" }).ok).toBe(true);
    const price = { ...base.data, category: "pricing" as const, body: "One year: $49." };
    expect(publishDecision(price).ok).toBe(false);
    expect(publishDecision(price, { priceConfirmed: true }).ok).toBe(true);
  });

  it("never stores trades as records", () => {
    expect(validateRecord({ category: "trades", audience: "member", title: "x", body: "y" }).ok).toBe(false);
  });
});

describe("agent scope", () => {
  const profile = normalizeScope({ categories: ["faqs", "pricing", "trades", "bogus"], audiences: ["public"] }, "general");

  it("drops unknown values and the trades category outside finance", () => {
    expect(profile).toEqual({ categories: ["pricing", "faqs"], audiences: ["public"] });
    expect(normalizeScope({ categories: ["trades"], audiences: ["member"] }, "finance").categories).toEqual(["trades"]);
    expect(categoriesForNiche("health")).not.toContain("trades");
  });

  it("a requested category or audience can narrow, never widen", () => {
    expect(effectiveScope(profile, { category: "faqs" })).toEqual({ categories: ["faqs"], audiences: ["public"] });
    expect(effectiveScope(profile, { category: "billing" }).categories).toEqual([]);
    expect(effectiveScope(profile, { audience: "member" }).audiences).toEqual([]);
    expect(effectiveScope(profile, {})).toEqual(profile);
  });

  it("trades need finance, the category and members", () => {
    expect(tradesAllowed({ categories: ["trades"], audiences: ["member"] }, "finance")).toBe(true);
    expect(tradesAllowed({ categories: ["trades"], audiences: ["public"] }, "finance")).toBe(false);
    expect(tradesAllowed({ categories: ["trades"], audiences: ["member"] }, "health")).toBe(false);
  });

  it("tools follow the scope", () => {
    const brand = { name: "Example Gazette", niche: "general" };
    expect(toolsFor({ categories: ["faqs"], audiences: ["public"] }, brand).map((t) => t.name)).toEqual(["search_knowledge", "get_record", "list_categories"]);
    expect(toolsFor({ categories: ["website"], audiences: ["public"] }, brand).map((t) => t.name)).toContain("find_articles");
    expect(toolsFor({ categories: ["trades"], audiences: ["member"] }, { name: "X", niche: "finance" }).map((t) => t.name)).toEqual(["lookup_trades"]);
  });
});

describe("keys", () => {
  it("mints psk_ keys and stores only a hash", () => {
    const minted = mintAgentKey();
    expect(minted.key).toMatch(/^psk_[A-Za-z0-9_-]{43}$/);
    expect(minted.hash).toBe(hashKey(minted.key));
    expect(minted.hash).not.toContain(minted.key.slice(4, 20));
    expect(keyMatches(minted.key, minted.hash)).toBe(true);
    expect(keyMatches(`${minted.key.slice(0, -1)}x`, minted.hash)).toBe(false);
    expect(keyMatches(minted.key, null)).toBe(false);
  });

  it("reads Bearer or x-api-key and rejects malformed keys", () => {
    const { key } = mintAgentKey();
    const headers = (h: Record<string, string>) => ({ get: (name: string) => h[name.toLowerCase()] ?? null });
    expect(presentedKey(headers({ authorization: `Bearer ${key}` }))).toBe(key);
    expect(presentedKey(headers({ "x-api-key": key }))).toBe(key);
    expect(presentedKey(headers({ authorization: "Bearer psk_short" }))).toBeNull();
    expect(presentedKey(headers({ authorization: `Bearer ${key}` }), "ingest")).toBeNull();
  });

  it("encrypts secrets with AUTH_SECRET", () => {
    const enc = encryptSecret("sk_example_value", "local-dev-secret-at-least-16");
    expect(enc).not.toContain("sk_example_value");
    expect(decryptSecret(enc, "local-dev-secret-at-least-16")).toBe("sk_example_value");
    expect(() => decryptSecret(enc, "another-secret-of-16-chars")).toThrow();
  });

  it("verifies signed webhooks and rejects stale or tampered ones", () => {
    const body = '{"type":"post_call_transcription"}';
    const header = signWebhook(body, "whsec_test", 1_800_000_000);
    expect(verifyWebhookSignature({ header, body, secret: "whsec_test", nowSeconds: 1_800_000_100 })).toBe(true);
    expect(verifyWebhookSignature({ header, body: `${body} `, secret: "whsec_test", nowSeconds: 1_800_000_100 })).toBe(false);
    expect(verifyWebhookSignature({ header, body, secret: "whsec_test", nowSeconds: 1_800_009_000 })).toBe(false);
    expect(verifyWebhookSignature({ header: null, body, secret: "whsec_test", nowSeconds: 1_800_000_000 })).toBe(false);
  });

  it("rate limits in a rolling window", () => {
    expect(rateDecision(0, 2)).toMatchObject({ allowed: true, remaining: 1 });
    expect(rateDecision(2, 2)).toMatchObject({ allowed: false, remaining: 0 });
  });
});

describe("website directory", () => {
  it("only a clearly free access level is public", () => {
    expect(classifyAccess("Free").audience).toBe("public");
    expect(classifyAccess("public").audience).toBe("public");
    expect(classifyAccess("").audience).toBe("member");
    expect(classifyAccess("").note).toBeTruthy();
    expect(classifyAccess("Free; Premium").audience).toBe("member");
    expect(classifyAccess("Premium").audience).toBe("member");
    expect(classifyAccess("unknown tier").audience).toBe("member");
  });

  it("maps site statuses fail-safe", () => {
    expect(mapSiteStatus("publish").status).toBe("published");
    expect(mapSiteStatus("future").status).toBe("draft");
    expect(mapSiteStatus("trash").status).toBe("archived");
    expect(mapSiteStatus("weird").status).toBe("draft");
  });

  it("normalizes URLs as keys", () => {
    expect(normalizeUrl("Example.COM/report/?utm_source=x#top")).toBe("https://example.com/report");
    expect(normalizeUrl("not a url")).toBeNull();
  });

  it("matches products and prepares rows", () => {
    const pubs = [{ code: "TDE", name: "The Daily Edge" }];
    expect(matchProducts("Daily Edge, Mystery", pubs)).toEqual({ codes: ["TDE"], unmatched: ["Mystery"] });
    const page = preparePage({ title: "Spring outlook", url: "example.com/a", date: "2026-03-01", accessLevel: "", product: "TDE", status: "publish" }, pubs);
    if ("error" in page) throw new Error(page.error);
    expect(page).toMatchObject({ audience: "member", status: "published", publicationCodes: ["TDE"], publishedAt: "2026-03-01" });
    const leak = preparePage({ title: "Our conversion rate notes", url: "example.com/b", accessLevel: "Free" }, pubs);
    if ("error" in leak) throw new Error(leak.error);
    expect(leak.status).toBe("draft");
    expect(preparePage({ title: "", url: "example.com/c" }, pubs)).toEqual({ error: "missing title" });
  });

  it("reads CSV with quotes and header aliases", () => {
    const { rows, unknownColumns } = csvToPages('Post Title,Permalink,Access Level,Extra\n"Hello, world",https://example.com/h,Free,x\n');
    expect(rows).toEqual([{ title: "Hello, world", url: "https://example.com/h", accessLevel: "Free" }]);
    expect(unknownColumns).toEqual(["Extra"]);
  });

  it("only fetches Google Sheets links", () => {
    expect(sheetCsvUrl("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit#gid=42")).toBe("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/export?format=csv&gid=42");
    expect(sheetCsvUrl("https://internal.example/data.csv")).toBeNull();
  });
});

describe("documents and sync by hash", () => {
  const rec = (over: Partial<DocRecord>): DocRecord => ({ id: "1", category: "faqs", audience: "public", status: "published", title: "Q", body: "A", url: null, publicationCodes: [], ...over });

  it("renders only published records inside the scope", () => {
    const docs = buildDocs(
      [rec({ id: "a", category: "products", title: "Daily Edge" }), rec({ id: "b" }), rec({ id: "c", audience: "member" }), rec({ id: "d", status: "draft" }), rec({ id: "e", category: "billing" })],
      { categories: ["products", "faqs"], audiences: ["public"] },
    );
    expect(docs.map((d) => d.docKey)).toEqual(["record:a", "bundle:faqs:public"]);
    expect(docs[1]!.text).toContain("record:b");
    expect(docs[1]!.text).not.toContain("record:c");
  });

  it("hashes ignore whitespace changes", () => {
    expect(contentHash("a  b\n c")).toBe(contentHash("a b c"));
    expect(contentHash("a b c")).not.toBe(contentHash("a b d"));
  });

  it("plans create, update, unchanged, held and remove", () => {
    const docs = buildDocs([rec({ id: "a", category: "products" }), rec({ id: "b", category: "products", title: "B" }), rec({ id: "c", category: "products", title: "C" }), rec({ id: "n", category: "products", title: "N" })], { categories: ["products"], audiences: ["public"] });
    const by = Object.fromEntries(docs.map((d) => [d.docKey, d]));
    const rows: SyncRow[] = [
      { id: "1", docKey: "record:a", remoteId: "r1", contentHash: by["record:a"]!.hash, remoteHash: "x", status: "synced" },
      { id: "2", docKey: "record:b", remoteId: "r2", contentHash: "old", remoteHash: "x", status: "synced" },
      { id: "3", docKey: "record:c", remoteId: "r3", contentHash: "old", remoteHash: "x", status: "remote_changed" },
      { id: "4", docKey: "record:gone", remoteId: "r4", contentHash: "z", remoteHash: "x", status: "synced" },
    ];
    const plan = planPush(docs, rows);
    expect(plan.unchanged.map((d) => d.docKey)).toEqual(["record:a"]);
    expect(plan.update.map((u) => u.doc.docKey)).toEqual(["record:b"]);
    expect(plan.held.map((d) => d.docKey)).toEqual(["record:c"]);
    expect(plan.create.map((d) => d.docKey)).toEqual(["record:n"]);
    expect(plan.remove.map((r) => r.docKey)).toEqual(["record:gone"]);
    expect(planPush(docs, rows, { force: true }).held).toEqual([]);
  });

  it("detects edits made on the platform against the post-push baseline", () => {
    expect(pullDecision({ remoteHash: null }, "anything")).toBe("baseline");
    expect(pullDecision({ remoteHash: contentHash("Hello  world") }, "Hello world")).toBe("unchanged");
    expect(pullDecision({ remoteHash: contentHash("Hello world") }, "Hello there")).toBe("remote_changed");
  });

  it("chunks long text into passages", () => {
    const text = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ${"word ".repeat(40)}`).join("\n\n");
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.length <= 1700)).toBe(true);
  });
});

describe("gaps", () => {
  it("finds unanswered questions in a post-call transcript", () => {
    const payload = {
      type: "post_call_transcription",
      data: {
        agent_id: "agent_1",
        conversation_id: "conv_1",
        transcript: [
          { role: "user", message: "Hi there" },
          { role: "user", message: "Can I pause my membership while I travel?" },
          { role: "agent", message: "", tool_results: [{ tool_name: "search_knowledge", result_value: '{"found":false,"results":[]}' }] },
          { role: "agent", message: "I'm sorry, I don't have that information. Let me connect you." },
          { role: "user", message: "How do I reset my password please?" },
          { role: "agent", message: "Click Forgot password on the login page." },
        ],
      },
    };
    const call = readPostCall(payload);
    expect(call.conversationId).toBe("conv_1");
    const gaps = findGaps(call.transcript);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.question).toBe("Can I pause my membership while I travel?");
  });

  it("parses pasted questions and dedupes", () => {
    expect(parsePasted("Customer: Where is my latest issue?\nAgent: Let me check.\nCustomer: where is my LATEST issue").map((g) => g.question)).toEqual(["Where is my latest issue?"]);
    expect(parsePasted("- Do you have a mobile app for this?\nok").map((g) => g.question)).toEqual(["Do you have a mobile app for this?"]);
    expect(normalizeQuestion("Hello, can I PAUSE it?")).toBe("can i pause it");
  });
});

describe("track record", () => {
  const row = (over: Partial<TradeRow>): TradeRow => ({ symbol: "ABC", name: "", direction: "LONG", status: "CLOSED", entryDate: new Date("2026-01-02"), entryPrice: 10, exitDate: new Date("2026-02-02"), exitPrice: 12, portfolio: "Model", publication: "TDE", ...over });

  it("refuses rankings and unfiltered dumps", () => {
    expect(checkTradeQuery({ q: "worst trades this year" }).ok).toBe(false);
    expect(checkTradeQuery({}).ok).toBe(false);
    expect(checkTradeQuery({ ticker: "abc" })).toMatchObject({ ok: true, filters: { ticker: "ABC" } });
  });

  it("returns closed trades only, newest close first, never sorted by result", () => {
    const check = checkTradeQuery({ publication: "TDE" });
    if (!check.ok) throw new Error(check.message);
    const rows = [row({ symbol: "OLD", exitDate: new Date("2025-05-01"), exitPrice: 30 }), row({ symbol: "OPEN", status: "OPEN", exitDate: null, exitPrice: null }), row({ symbol: "LOSS", exitPrice: 8 })];
    const picked = selectTrades(rows, check.filters);
    expect(picked.map((r) => r.symbol)).toEqual(["LOSS", "OLD"]);
    expect(tradeAnswer(picked)[0]).toMatchObject({ ticker: "LOSS", result: "-20.0%" });
    expect(tradeAnswer([row({ direction: "SHORT", exitPrice: 8 })])[0]!.result).toBe("+20.0%");
  });
});

describe("sources", () => {
  const pub: PubInput = {
    id: "p1",
    code: "tde",
    name: "The Daily Edge",
    tagline: "One idea a day",
    pubType: "Newsletter",
    frequency: "Daily",
    status: "active",
    description: "Short.",
    longDescription: null,
    deliverables: ["Daily issue"],
    offers: [{ label: "Annual", price: "$49", term: "per year" }],
    websiteUrl: "https://example.com/tde",
    signupUrl: "https://example.com/join",
    archived: false,
    editors: [{ name: "Ada Lee", role: "lead", title: "Editor" }],
  };

  it("maps a publication to a public record without internal fields", () => {
    const draft = publicationDraft(pub);
    expect(draft).toMatchObject({ category: "products", audience: "public", status: "published", publicationCodes: ["TDE"] });
    expect(draft.body).toContain("Ada Lee");
    expect(publicationDraft({ ...pub, archived: true }).status).toBe("archived");
  });

  it("prices always start as drafts", () => {
    expect(pricingDraft(pub)).toMatchObject({ category: "pricing", status: "draft" });
    expect(pricingDraft({ ...pub, offers: [], signupUrl: null })).toBeNull();
  });

  it("editors map to public bios", () => {
    const draft = editorDraft({ id: "e1", name: "Ada Lee", title: "Editor", status: "active", shortBio: "Writes daily.", longBio: null, credentials: null, specialties: ["Value"], archived: false, publications: [{ code: "TDE", name: "The Daily Edge", role: "lead" }] });
    expect(draft).toMatchObject({ category: "editors", status: "published" });
  });

  it("sync skips locked records and unchanged sources", () => {
    const draft = publicationDraft(pub);
    expect(syncAction(null, draft)).toBe("create");
    expect(syncAction({ sourceHash: draft.sourceHash, locked: false }, draft)).toBe("unchanged");
    expect(syncAction({ sourceHash: "old", locked: false }, draft)).toBe("update");
    expect(syncAction({ sourceHash: "old", locked: true }, draft)).toBe("skip-locked");
  });

  it("cleans Brain notes", () => {
    expect(noteToText("---\ntags: x\n---\nSee [[Refund policy|our policy]] ![[img.png]]")).toBe("See our policy");
  });
});

describe("agent guide", () => {
  it("is built from the profile and the brand profile, niche-aware", () => {
    const scope = { categories: ["faqs" as const, "trades" as const], audiences: ["member" as const] };
    const brand = brandProfile({ name: "Example Gazette", niche: "finance", complianceNotes: "Never mention the staff lounge." });
    const text = renderGuide({ profile: { name: "Member chat", personaName: "Merlin", surface: "phone", scope, instructions: "- Say goodbye politely", escalation: "Give the support email." }, brand, tools: toolsFor(scope, brand) });
    expect(text).toContain("You are Merlin, the customer support assistant for Example Gazette");
    expect(text).toContain("lookup_trades");
    expect(text).toContain("investment advice");
    expect(text).toContain("Never mention the staff lounge.");
    expect(text).toContain("Say goodbye politely");
    const health = renderGuide({ profile: { name: "Chat", personaName: "", surface: "chat", scope: { categories: ["faqs"], audiences: ["public"] }, instructions: "", escalation: "" }, brand: brandProfile({ name: "Well", niche: "health" }), tools: [] });
    expect(health).toContain("medical advice");
    expect(health).not.toContain("investment");
  });
});

describe("ElevenLabs adapter (fixtures)", () => {
  function fixture(routes: Record<string, (body: unknown) => { status?: number; body: unknown }>) {
    const calls: { method: string; url: string; body: unknown; key: string | undefined }[] = [];
    const fetchImpl: Fetch = async (url, init) => {
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ method: init.method, url, body, key: init.headers["xi-api-key"] });
      const path = new URL(url).pathname;
      const handler = routes[`${init.method} ${path}`];
      const out = handler ? handler(body) : { status: 404, body: { detail: "not found" } };
      return { ok: (out.status ?? 200) < 400, status: out.status ?? 200, text: async () => (typeof out.body === "string" ? out.body : JSON.stringify(out.body)) };
    };
    return { calls, client: { apiKey: "test-key", baseUrl: "https://el.test", fetch: fetchImpl } };
  }

  it("creates documents and reads them back", async () => {
    const { calls, client } = fixture({
      "POST /v1/convai/knowledge-base/text": () => ({ body: { id: "doc_1" } }),
      "GET /v1/convai/knowledge-base/doc_1/content": () => ({ body: "Hello" }),
    });
    expect(await createDocument(client, "Name", "Hello")).toBe("doc_1");
    expect(await getDocumentText(client, "doc_1")).toBe("Hello");
    expect(calls[0]).toMatchObject({ method: "POST", body: { name: "Name", text: "Hello" }, key: "test-key" });
  });

  it("configures the agent, keeping foreign tools and the rest of the prompt", async () => {
    let patched: unknown = null;
    const { client } = fixture({
      "GET /v1/convai/agents/agent_1": () => ({ body: { conversation_config: { agent: { prompt: { prompt: "old", llm: "gpt", tool_ids: ["theirs", "ours_old"] } } } } }),
      "PATCH /v1/convai/agents/agent_1": (body) => {
        patched = body;
        return { body: {} };
      },
    });
    await configureAgent(client, "agent_1", { prompt: "new", docs: [{ id: "doc_1", name: "D" }], ownToolIds: ["ours_new"], previousOwnToolIds: ["ours_old"] });
    expect(patched).toEqual({
      conversation_config: { agent: { prompt: { prompt: "new", llm: "gpt", tool_ids: ["theirs", "ours_new"], knowledge_base: [{ type: "text", id: "doc_1", name: "D", usage_mode: "auto" }] } } },
    });
  });

  it("turns tool definitions into authenticated webhook tools", () => {
    const [tool] = toolsFor({ categories: ["faqs"], audiences: ["public"] }, { name: "X", niche: "general" });
    const config = webhookToolConfig(tool!, { apiBase: "https://org.example.com/", secretId: "sec_1" });
    expect(config.api_schema.url).toBe("https://org.example.com/api/v1/support/search");
    expect(config.api_schema.request_headers).toEqual({ Authorization: { secret_id: "sec_1" } });
    expect(config.api_schema.query_params_schema?.required).toEqual(["q"]);
  });
});
