import type { CsvChart } from "./csv";

/** PubCommand brand accent. Brands do not store a color yet, so charts use this. */
export const BRAND_ACCENT = "#1d4ed8";

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const HEX3 = /^#[0-9a-fA-F]{3}$/;

export function normalizeAccent(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (HEX6.test(trimmed)) return trimmed.toLowerCase();
  if (HEX3.test(trimmed)) {
    const [r, g, b] = trimmed.slice(1).split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return BRAND_ACCENT;
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatTick(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

export function renderLineChartSvg(input: { chart: CsvChart; accent: string; annotation: string }): string {
  const accent = normalizeAccent(input.accent);
  const width = 720;
  const height = 400;
  const padL = 56;
  const padR = 20;
  const padT = 40;
  const padB = 48;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const values = input.chart.points.map((point) => point.value);
  const min = Math.min(0, ...values);
  const max = Math.max(...values, 1);
  const span = max - min || 1;
  const count = input.chart.points.length;
  const coords = input.chart.points.map((point, index) => {
    const x = padL + (count === 1 ? innerW / 2 : (index / (count - 1)) * innerW);
    const y = padT + innerH - ((point.value - min) / span) * innerH;
    return { x, y, point };
  });
  const line = coords.map((coord) => `${coord.x.toFixed(1)},${coord.y.toFixed(1)}`).join(" ");
  const dots = coords
    .map(
      (coord) =>
        `<circle cx="${coord.x.toFixed(1)}" cy="${coord.y.toFixed(1)}" r="3.5" fill="${accent}" />`,
    )
    .join("");
  const step = Math.ceil(count / 8);
  const labels = coords
    .map((coord, index) => {
      if (count > 8 && index % step !== 0 && index !== count - 1) return "";
      return `<text x="${coord.x.toFixed(1)}" y="${height - 16}" text-anchor="middle" font-size="11" fill="#3e4a5c">${xml(coord.point.label)}</text>`;
    })
    .join("");
  const note = input.annotation.trim();
  const annotation = note
    ? `<text x="${padL}" y="24" font-size="13" font-weight="600" fill="${accent}">${xml(note)}</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${xml(input.chart.yLabel)}" style="display:block;width:100%;height:auto;max-width:100%" font-family="ui-sans-serif, system-ui, sans-serif">
  <rect width="100%" height="100%" fill="#ffffff"/>
  ${annotation}
  <text x="${padL - 8}" y="${padT + 4}" text-anchor="end" font-size="11" fill="#3e4a5c">${xml(formatTick(max))}</text>
  <text x="${padL - 8}" y="${padT + innerH}" text-anchor="end" font-size="11" fill="#3e4a5c">${xml(formatTick(min))}</text>
  <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + innerH}" stroke="#e1e4ea"/>
  <line x1="${padL}" y1="${padT + innerH}" x2="${padL + innerW}" y2="${padT + innerH}" stroke="#e1e4ea"/>
  <polyline fill="none" stroke="${accent}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="${line}"/>
  ${dots}
  ${labels}
</svg>`;
}
