export type KnowledgePageSource = "example" | "member";

/** A markdown page owned by one organization. */
export type KnowledgePage = {
  id: string;
  organizationId: string;
  title: string;
  slug: string;
  body: string;
  source: KnowledgePageSource;
  createdAt: string;
  updatedAt: string;
};

/**
 * A search hit shaped like a citation: which page, which organization,
 * and a short excerpt a reader can open.
 */
export type KnowledgeCitation = {
  pageId: string;
  organizationId: string;
  title: string;
  slug: string;
  excerpt: string;
  href: string;
};

export type KnowledgeSavedPayload = {
  pageId: string;
  title: string;
  slug: string;
};

export type CreateKnowledgePageInput = {
  organizationId: string;
  title: string;
  body: string;
  actorId?: string;
};

export type CreateKnowledgePageResult =
  | { ok: true; page: KnowledgePage }
  | { ok: false; error: string };

export type KnowledgeView = {
  query: string;
  pages: KnowledgePage[];
  citations: KnowledgeCitation[];
  selected: KnowledgePage | null;
};
