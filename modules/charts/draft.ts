export const CSV_LIMIT = 4_000;
export const ANNOTATION_LIMIT = 240;

export type ChartDraft = {
  csv: string;
  annotation: string;
  accent: string;
};

export type ShareResult = { url: string } | { error: string };

export function asChartDraft(value: Partial<ChartDraft> | null | undefined): ChartDraft {
  return {
    csv: typeof value?.csv === "string" ? value.csv : "",
    annotation: typeof value?.annotation === "string" ? value.annotation : "",
    accent: typeof value?.accent === "string" ? value.accent : "",
  };
}
