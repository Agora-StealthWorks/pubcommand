import type { Metadata } from "next";
import "./globals.css";

// No PubCommand name here: this layout also wraps customers' public pages (websites, funnels,
// forms, Mini-Blogs). PubCommand's own screens add their title and icons in their layouts.
export const metadata: Metadata = {};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
