export type ScrapeRequest = {
  organizationId: string;
  url: string;
};

export type ScrapeResult = {
  status: "not-implemented";
  reason: string;
};

// TODO: Competitor scrapers. This slice must not crawl, fetch, or call the network.
export function scrapeCompetitorPage(_request: ScrapeRequest): ScrapeResult {
  return {
    status: "not-implemented",
    reason: "Live scraping is not part of this slice. Competitors are stored records only.",
  };
}
