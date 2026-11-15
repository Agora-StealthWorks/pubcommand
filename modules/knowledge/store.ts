import { slugifyName, type DomainEvent } from "@pubcommand/core";
import type {
  CreateKnowledgePageInput,
  CreateKnowledgePageResult,
  KnowledgeCitation,
  KnowledgePage,
  KnowledgeSavedPayload,
  KnowledgeView,
} from "./types";

export const KNOWLEDGE_SAVED_EVENT = "knowledge.entry.saved";

// TODO: PDF and docx ingestion.
// TODO: pgvector semantic search. This slice is keyword search only.
// TODO: AI chat over citations.
// TODO: persist pages in a tenant table keyed by organizationId.

const EXAMPLE_AT = "2026-01-01T00:00:00.000Z";
const TITLE_MAX = 140;
const BODY_MAX = 20_000;

const EXAMPLE_PAGES: readonly Pick<KnowledgePage, "title" | "slug" | "body">[] = [
  {
    title: "EXAMPLE: Northwind desk opening",
    slug: "example-northwind-desk-opening",
    body: [
      "# EXAMPLE: Northwind desk opening",
      "",
      "This sample page is fake data for the Northwind example desk.",
      "",
      "Open the desk by checking three items:",
      "",
      "- The sample ledger is on the shelf.",
      "- The example key is in the blue tray.",
      "- The citation card says EXAMPLE.",
      "",
      "No real customer content belongs here.",
    ].join("\n"),
  },
  {
    title: "EXAMPLE: Sample brief citations",
    slug: "example-sample-brief-citations",
    body: [
      "# EXAMPLE: Sample brief citations",
      "",
      "A citation points at a markdown page in the same organization.",
      "",
      "Quote the heading Sample brief and the keyword lighthouse when you search.",
      "",
      "This page exists so keyword search can return a citation-shaped result.",
    ].join("\n"),
  },
];

type Memory = {
  pages: KnowledgePage[];
  events: DomainEvent<KnowledgeSavedPayload>[];
  seeded: Set<string>;
};

function memory(): Memory {
  const host = globalThis as typeof globalThis & { __pubcommandKnowledge?: Memory };
  if (!host.__pubcommandKnowledge) {
    host.__pubcommandKnowledge = { pages: [], events: [], seeded: new Set() };
  }
  return host.__pubcommandKnowledge;
}

export function resetKnowledgeStore(): void {
  const store = memory();
  store.pages.length = 0;
  store.events.length = 0;
  store.seeded.clear();
}

function copyPage(page: KnowledgePage): KnowledgePage {
  return { ...page };
}

function ensureExamplePages(organizationId: string): void {
  const store = memory();
  if (store.seeded.has(organizationId)) return;
  store.seeded.add(organizationId);
  const taken = new Set(
    store.pages.filter((page) => page.organizationId === organizationId).map((page) => page.slug),
  );
  for (const example of EXAMPLE_PAGES) {
    if (taken.has(example.slug)) continue;
    store.pages.push({
      id: crypto.randomUUID(),
      organizationId,
      title: example.title,
      slug: example.slug,
      body: example.body,
      source: "example",
      createdAt: EXAMPLE_AT,
      updatedAt: EXAMPLE_AT,
    });
  }
}

function pagesFor(organizationId: string): KnowledgePage[] {
  return memory()
    .pages.filter((page) => page.organizationId === organizationId)
    .sort((a, b) => {
      if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
      return a.title.localeCompare(b.title);
    })
    .map(copyPage);
}

function uniqueSlug(organizationId: string, title: string): string {
  const base = slugifyName(title) || "page";
  const taken = new Set(
    memory()
      .pages.filter((page) => page.organizationId === organizationId)
      .map((page) => page.slug),
  );
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base.slice(0, 36)}-${n}`)) n += 1;
  return `${base.slice(0, 36)}-${n}`;
}

export function listKnowledgePages(organizationId: string): KnowledgePage[] {
  ensureExamplePages(organizationId);
  return pagesFor(organizationId);
}

export function getKnowledgePage(organizationId: string, slug: string): KnowledgePage | null {
  ensureExamplePages(organizationId);
  const page = memory().pages.find(
    (item) => item.organizationId === organizationId && item.slug === slug,
  );
  return page ? copyPage(page) : null;
}

export function listKnowledgeEvents(organizationId: string): DomainEvent<KnowledgeSavedPayload>[] {
  return memory()
    .events.filter((event) => event.organizationId === organizationId)
    .map((event) => ({ ...event, payload: { ...event.payload } }));
}

function excerpt(page: KnowledgePage, query: string): string {
  const haystack = `${page.title}. ${page.body}`.replace(/\s+/g, " ").trim();
  const token = query.trim().split(/\s+/).find(Boolean)?.toLowerCase() ?? "";
  const index = token ? haystack.toLowerCase().indexOf(token) : 0;
  const start = Math.max(0, index < 0 ? 0 : index - 48);
  const slice = haystack.slice(start, start + 180).trim();
  const prefix = start > 0 ? "…" : "";
  const suffix = start + 180 < haystack.length ? "…" : "";
  return `${prefix}${slice}${suffix}`;
}

export function searchKnowledge(organizationId: string, query: string): KnowledgeCitation[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  return listKnowledgePages(organizationId)
    .filter((page) => {
      const haystack = `${page.title}\n${page.body}`.toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    })
    .map((page) => ({
      pageId: page.id,
      organizationId: page.organizationId,
      title: page.title,
      slug: page.slug,
      excerpt: excerpt(page, query),
      href: `/knowledge?page=${page.slug}`,
    }));
}

export function createKnowledgePage(input: CreateKnowledgePageInput): CreateKnowledgePageResult {
  const organizationId = input.organizationId.trim();
  const title = input.title.trim();
  const body = input.body.trim();
  if (!organizationId) return { ok: false, error: "Organization is required." };
  if (!title) return { ok: false, error: "Title is required." };
  if (title.length > TITLE_MAX) return { ok: false, error: "Title is too long." };
  if (!body) return { ok: false, error: "Body is required." };
  if (body.length > BODY_MAX) return { ok: false, error: "Body is too long." };

  ensureExamplePages(organizationId);
  const now = new Date().toISOString();
  const page: KnowledgePage = {
    id: crypto.randomUUID(),
    organizationId,
    title,
    slug: uniqueSlug(organizationId, title),
    body,
    source: "member",
    createdAt: now,
    updatedAt: now,
  };
  const store = memory();
  store.pages.push(page);
  const event: DomainEvent<KnowledgeSavedPayload> = {
    name: KNOWLEDGE_SAVED_EVENT,
    organizationId,
    occurredAt: now,
    payload: { pageId: page.id, title: page.title, slug: page.slug },
  };
  if (input.actorId) event.actorId = input.actorId;
  store.events.push(event);
  return { ok: true, page: copyPage(page) };
}

export function loadKnowledge(
  organizationId: string,
  input: { q?: string; page?: string } = {},
): KnowledgeView {
  const query = (input.q ?? "").trim();
  const pages = listKnowledgePages(organizationId);
  const selectedSlug = (input.page ?? "").trim();
  const selected = (selectedSlug ? getKnowledgePage(organizationId, selectedSlug) : null) ?? pages[0] ?? null;
  return {
    query,
    pages,
    citations: query ? searchKnowledge(organizationId, query) : [],
    selected,
  };
}
