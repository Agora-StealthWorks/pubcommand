/**
 * Agent tool definitions: the one source for the rendered agent guide, the ElevenLabs
 * webhook-tool push and the exported bundle. A platform adapter translates these; it
 * never invents its own.
 */
import { searchableCategories, tradesAllowed, type Scope } from "./scope";
import { CATEGORIES } from "./taxonomy";

export type ToolParam = { name: string; type: "string" | "integer"; description: string; required?: boolean };

export type ToolDef = {
  name: string;
  description: string;
  /** Under /api/v1/support. */
  path: string;
  params: ToolParam[];
};

export function toolsFor(scope: Scope, brand: { name: string; niche: string }): ToolDef[] {
  const searchable = searchableCategories(scope);
  const tools: ToolDef[] = [];
  if (searchable.length) {
    tools.push({
      name: "search_knowledge",
      description: `Search ${brand.name}'s customer support knowledge. Use it before answering any question about ${brand.name}, its products, membership, billing or website.`,
      path: "/search",
      params: [
        { name: "q", type: "string", description: "The customer's question, or its key words.", required: true },
        { name: "category", type: "string", description: `Optional, to search one kind of knowledge only: ${searchable.map((key) => `${key} (${CATEGORIES[key].label})`).join(", ")}.` },
      ],
    });
    tools.push({
      name: "get_record",
      description: "Read one knowledge record in full, by the id a search result gave you.",
      path: "/records",
      params: [{ name: "id", type: "string", description: "The record id from a search result.", required: true }],
    });
    tools.push({
      name: "list_categories",
      description: "List the kinds of knowledge you can search, with how many records each has.",
      path: "/categories",
      params: [],
    });
  }
  if (scope.categories.includes("website")) {
    tools.push({
      name: "find_articles",
      description: `Find posts, articles and reports on ${brand.name}'s website by topic, publication or date, with their links. Use it when someone asks for a specific article or what has been written about a topic.`,
      path: "/articles",
      params: [
        { name: "topic", type: "string", description: "What the article is about, or words from its title." },
        { name: "publication", type: "string", description: "A publication name or code, to list only its articles." },
        { name: "from", type: "string", description: "Earliest date, YYYY-MM-DD." },
        { name: "to", type: "string", description: "Latest date, YYYY-MM-DD." },
      ],
    });
  }
  if (tradesAllowed(scope, brand.niche)) {
    tools.push({
      name: "lookup_trades",
      description: `Look up CLOSED trades in ${brand.name}'s official track record: when a position was opened and closed and its result. Members only. Give at least a ticker or a publication.`,
      path: "/trades",
      params: [
        { name: "ticker", type: "string", description: "Ticker symbol, e.g. ABC." },
        { name: "publication", type: "string", description: "Publication or portfolio name." },
        { name: "from", type: "string", description: "Closed on or after, YYYY-MM-DD." },
        { name: "to", type: "string", description: "Closed on or before, YYYY-MM-DD." },
      ],
    });
  }
  return tools;
}
