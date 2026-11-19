import { Bodoni_Moda, Inter, Oswald } from "next/font/google";
import "@/features/websites/site.css";

// The brand's three faces (style guide): Oswald for display, Bodoni Moda for editorial, Inter for text.
// next/font self-hosts them, so pages load no third-party font CSS.
const display = Oswald({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--ws-display", display: "swap" });
const serif = Bodoni_Moda({ subsets: ["latin"], axes: ["opsz"], style: ["normal", "italic"], variable: "--ws-serif", display: "swap" });
const body = Inter({ subsets: ["latin"], variable: "--ws-body", display: "swap" });

export default function WebsiteLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${display.variable} ${serif.variable} ${body.variable}`}>{children}</div>;
}
