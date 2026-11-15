export type Competitor = {
  id: string;
  organizationId: string;
  name: string;
  domain: string;
};

export type IngestedEmail = {
  id: string;
  organizationId: string;
  subject: string;
  from: string;
  receivedAt: string;
  bodyExcerpt: string;
};

/** A historical-call row shipped as an example. This slice never downloads a transcript. */
export type HistoricalCall = {
  id: string;
  organizationId: string;
  occurredOn: string;
  title: string;
  summary: string;
  example: true;
};
