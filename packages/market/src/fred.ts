/** FRED public graph CSV: https://fred.stlouisfed.org/graph/fredgraph.csv?id=<id>&cosd=<from>&coed=<to>. No key. */
import { failure, get } from "./http";
import { MarketError, type Bar, type FetchLike } from "./types";

export function parseFredCsv(text: string, id: string): Bar[] {
  if (!/^\s*(observation_date|DATE)\b/i.test(text)) throw new MarketError("not_found", `FRED has no series "${id}".`);
  const out: Bar[] = [];
  for (const line of text.trim().split(/\r?\n/).slice(1)) {
    const [date = "", raw = ""] = line.split(",");
    const value = Number(raw);
    const t = Date.parse(`${date.trim()}T00:00:00Z`);
    if (raw.trim() !== "." && raw.trim() !== "" && Number.isFinite(value) && Number.isFinite(t)) {
      out.push({ t, o: value, h: value, l: value, c: value });
    }
  }
  return out;
}

export async function fredSeries(fetcher: FetchLike, id: string, from: string, to: string): Promise<Bar[]> {
  if (!/^[A-Za-z0-9_.-]{1,40}$/.test(id)) throw new MarketError("bad_request", `"${id}" is not a FRED series id.`);
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}&cosd=${from}&coed=${to}`;
  const response = await get(fetcher, url, "FRED");
  if (!response.ok) throw await failure("FRED", response.status, await response.text(), id);
  return parseFredCsv(await response.text(), id);
}
