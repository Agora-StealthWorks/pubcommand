import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // ChartBuilder exports: pdfkit reads its font data from disk and subset-font loads a wasm file, so neither can be bundled.
  serverExternalPackages: ["mammoth", "@resvg/resvg-js", "pdfkit", "svg-to-pdfkit", "subset-font"],
  experimental: {
    // Promo PDFs and Word files are often 10-50 MB.
    serverActions: { bodySizeLimit: "60mb" },
    // The middleware buffers request bodies and cuts them at 10 MB by default,
    // which truncates large uploads (promo files, Brain vault zips) before the action sees them.
    middlewareClientMaxBodySize: "60mb",
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
