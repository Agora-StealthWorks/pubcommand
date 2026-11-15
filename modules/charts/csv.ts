export type ChartPoint = { label: string; value: number };

export type CsvChart = {
  xLabel: string;
  yLabel: string;
  points: ChartPoint[];
};

export type CsvResult = { ok: true; chart: CsvChart } | { ok: false; error: string };

const MAX_POINTS = 60;

function parseRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? "";
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

export function parseCsv(text: string): CsvResult {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) return { ok: false, error: "CSV needs a header and at least one row." };
  const header = parseRow(lines[0] ?? "");
  const xLabel = header[0] ?? "";
  const yLabel = header[1] ?? "";
  if (!xLabel || !yLabel) return { ok: false, error: "CSV needs two columns." };

  const points: ChartPoint[] = [];
  for (const line of lines.slice(1)) {
    const cells = parseRow(line);
    const label = cells[0] ?? "";
    const raw = (cells[1] ?? "").replace(/,/g, "");
    if (!label) return { ok: false, error: "A row is missing its label." };
    const value = Number(raw);
    if (!Number.isFinite(value)) return { ok: false, error: `"${label}" is not a number.` };
    points.push({ label, value });
  }
  if (points.length === 0) return { ok: false, error: "CSV has no data rows." };
  if (points.length > MAX_POINTS) return { ok: false, error: `Use ${MAX_POINTS} points or fewer.` };
  return { ok: true, chart: { xLabel, yLabel, points } };
}
