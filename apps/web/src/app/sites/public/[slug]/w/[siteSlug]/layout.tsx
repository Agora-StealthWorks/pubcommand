import localFont from "next/font/local";
import "@/features/websites/site.css";

// The brand's three faces (style guide): Oswald for display, Bodoni Moda for editorial, Inter for text.
// Self-hosted files from @fontsource-variable 5.3.0 (SIL OFL 1.1, licenses next to the files; see
// modules/websites/README.md): builds never download fonts,
// and pages load no third-party font CSS.
const display = localFont({ src: "../../../../../../features/websites/fonts/oswald-latin-wght-normal.woff2", weight: "200 700", variable: "--ws-display", display: "swap" });
const serif = localFont({
  src: [
    { path: "../../../../../../features/websites/fonts/bodoni-moda-latin-opsz-normal.woff2", weight: "400 900", style: "normal" },
    { path: "../../../../../../features/websites/fonts/bodoni-moda-latin-opsz-italic.woff2", weight: "400 900", style: "italic" },
  ],
  variable: "--ws-serif",
  display: "swap",
});
const body = localFont({ src: "../../../../../../features/websites/fonts/inter-latin-wght-normal.woff2", weight: "100 900", variable: "--ws-body", display: "swap" });

export default function WebsiteLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${display.variable} ${serif.variable} ${body.variable}`}>{children}</div>;
}
