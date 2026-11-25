/**
 * Mini-Blog themes: look presets for the public pages. A Mini-Blog picks one in
 * Settings → Look; its header color, button color and logo size are customized
 * on top of it (or follow the brand). The admin gallery, the live preview and
 * the public pages all read these tokens, so the preview cannot drift. PURE.
 */

export type ThemeId = "t-letter" | "classic" | "newsprint" | "minimal" | "midnight";

export type MiniBlogTheme = {
  id: ThemeId;
  name: string;
  description: string;
  /** Default header bar and button colors when the Mini-Blog sets none of its own. */
  headerBg: string;
  accent: string;
  /** Page ground, card and text. */
  pageBg: string;
  cardBg: string;
  cardBorder: string;
  /** Hairlines (footer rule, archive rows, table cells). */
  line: string;
  ink: string;
  muted: string;
  /** Post title color; "header" = the header bar color (the T-Letter look). */
  title: "header" | string;
  font: "system" | "serif";
  radius: number;
  /** "tletter" = grey box, bold green action text; "boxed" = accent-bordered box. */
  action: "tletter" | "boxed";
  /** Action text color for the tletter style. */
  actionInk: string;
  /** "tletter" = one 3-column row (name · © · View Archives) with the archive folded under it. */
  footer: "tletter" | "classic";
  /** Light-grey top/content text-ad box. */
  adBg: string;
};

export const THEMES: readonly MiniBlogTheme[] = [
  {
    id: "t-letter",
    name: "T-Letter",
    description: "The OxfordHub T-Letter look: navy bar, centered logo, one white card, green action text, archive under the footer.",
    headerBg: "#0f2440",
    accent: "#1c5fd6",
    pageBg: "#f4f6f9",
    cardBg: "#ffffff",
    cardBorder: "transparent",
    line: "#e4e9f0",
    ink: "#1a1a1a",
    muted: "#64748b",
    title: "header",
    font: "system",
    radius: 12,
    action: "tletter",
    actionInk: "#2e9b3f",
    footer: "tletter",
    adBg: "#f0f2f6",
  },
  {
    id: "classic",
    name: "Classic",
    description: "Bordered cards on a light grey page, a bold title and an accent-bordered action box.",
    headerBg: "#111827",
    accent: "#1d4ed8",
    pageBg: "#f5f6f8",
    cardBg: "#ffffff",
    cardBorder: "rgba(0,0,0,0.1)",
    line: "rgba(0,0,0,0.1)",
    ink: "#1f2937",
    muted: "#475467",
    title: "#111827",
    font: "system",
    radius: 12,
    action: "boxed",
    actionInk: "#1f2937",
    footer: "classic",
    adBg: "#f2f4f7",
  },
  {
    id: "newsprint",
    name: "Newsprint",
    description: "A serif newsletter on warm paper with a black masthead.",
    headerBg: "#141414",
    accent: "#9a3412",
    pageBg: "#f7f3ea",
    cardBg: "#fffdf8",
    cardBorder: "#e7dfcc",
    line: "#e7dfcc",
    ink: "#1c1917",
    muted: "#6b6358",
    title: "#141414",
    font: "serif",
    radius: 4,
    action: "boxed",
    actionInk: "#1c1917",
    footer: "tletter",
    adBg: "#efe8d8",
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "White page, no card edges, lots of space. The header color does the branding.",
    headerBg: "#ffffff",
    accent: "#111827",
    pageBg: "#ffffff",
    cardBg: "#ffffff",
    cardBorder: "transparent",
    line: "#e5e7eb",
    ink: "#111827",
    muted: "#6b7280",
    title: "#111827",
    font: "system",
    radius: 8,
    action: "tletter",
    actionInk: "#047857",
    footer: "classic",
    adBg: "#f3f4f6",
  },
  {
    id: "midnight",
    name: "Midnight",
    description: "Dark page with light text, for night-time reading.",
    headerBg: "#020617",
    accent: "#38bdf8",
    pageBg: "#0b1220",
    cardBg: "#111a2e",
    cardBorder: "#1e293b",
    line: "#1e293b",
    ink: "#e2e8f0",
    muted: "#94a3b8",
    title: "#f8fafc",
    font: "system",
    radius: 12,
    action: "tletter",
    actionInk: "#4ade80",
    footer: "tletter",
    adBg: "#1e293b",
  },
];

export const DEFAULT_THEME: ThemeId = "t-letter";

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEMES.some((theme) => theme.id === value);
}

/** The theme by id; unknown ids get Classic (the look every Mini-Blog had before themes). */
export function themeById(id: string | null | undefined): MiniBlogTheme {
  return THEMES.find((theme) => theme.id === id) ?? THEMES.find((theme) => theme.id === "classic")!;
}

export const FONT_STACKS = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", Times, serif',
} as const;
