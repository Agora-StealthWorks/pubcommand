import type { Viewport } from "next";
import { brandMetadata, brandThemeColor, OwnerFooter } from "@/components/brand";

/** PubCommand's favicon and icons on its own pages (public customer sites set their own). */
export const metadata = brandMetadata;
export const viewport: Viewport = { themeColor: brandThemeColor };

export default function BrandedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      {children}
      <OwnerFooter />
    </div>
  );
}
