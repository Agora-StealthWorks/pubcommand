import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "PubCommand", template: "%s · PubCommand" },
  description: "Publishing command hub for One Nation Financial.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
