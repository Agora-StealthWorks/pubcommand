import type { Metadata } from "next";

/**
 * PubCommand's own logo, from the logo kit in apps/web/public/brand. Use `on` for the
 * surface it sits on: the dark-text logo on light surfaces, the light-text logo on dark ones.
 * The app itself has no dark theme, so its screens use on="light".
 */
export function BrandLogo({ on = "light", className = "h-8 w-auto" }: { on?: "light" | "dark"; className?: string }) {
  return <img src={on === "dark" ? "/brand/logo-dark.svg" : "/brand/logo-light.svg"} alt="PubCommand" className={className} width={130} height={32} />;
}

/** Who owns PubCommand. Its logo sits in the footer of PubCommand's own screens. */
export const OWNER_NAME = "Agora StealthWorks";

/**
 * The footer on PubCommand's own screens (console, organization app, login, picker), never on
 * customers' public sites: the black "By Agora StealthWorks" stacked logo, centred.
 */
export function OwnerFooter({ className = "" }: { className?: string }) {
  return (
    <footer data-surface="owner-footer" className={`flex justify-center border-t border-line px-4 py-5 ${className}`}>
      <img src="/brand/agora-stealthworks-stacked-black.svg" alt={`By ${OWNER_NAME}`} width={88} height={40} className="h-10 w-auto" />
    </footer>
  );
}

/** Favicon, app icons, manifest and social card for PubCommand's own pages (never customers' public sites). */
export const brandMetadata: Metadata = {
  title: { default: "PubCommand", template: "%s · PubCommand" },
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
