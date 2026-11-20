import type { Metadata } from "next";

/**
 * PubCommand's own logo, from the logo kit in apps/web/public/brand. Use `on` for the
 * surface it sits on: the dark-text logo on light surfaces, the light-text logo on dark ones.
 * The app itself has no dark theme, so its screens use on="light".
 */
export function BrandLogo({ on = "light", className = "h-8 w-auto" }: { on?: "light" | "dark"; className?: string }) {
  return <img src={on === "dark" ? "/brand/logo-dark.svg" : "/brand/logo-light.svg"} alt="PubCommand" className={className} width={130} height={32} />;
}

/** Favicon, app icons, manifest and social card for PubCommand's own pages (never customers' public sites). */
export const brandMetadata: Metadata = {
  icons: {
    icon: [
      { url: "/brand/favicon.ico", sizes: "any" },
      { url: "/brand/favicon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/brand/apple-touch-icon.png", sizes: "180x180" }],
  },
  manifest: "/brand/site.webmanifest",
  openGraph: { images: [{ url: "/brand/og.jpg", width: 1200, height: 630 }] },
  twitter: { card: "summary_large_image", images: ["/brand/og.jpg"] },
};

export const brandThemeColor = "#7C3AED";
