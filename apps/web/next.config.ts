import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["mammoth", "@resvg/resvg-js"],
  experimental: {
    // Promo PDFs and Word files are often 10-50 MB.
    serverActions: { bodySizeLimit: "60mb" },
  },
  transpilePackages: [
    "@pubcommand/ai",
    "@pubcommand/auth",
    "@pubcommand/core",
    "@pubcommand/db",
    "@pubcommand/market",
    "@pubcommand/modules",
    "@pubcommand/ui",
  ],
};

export default nextConfig;
