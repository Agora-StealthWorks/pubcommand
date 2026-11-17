import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["mammoth"],
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
    "@pubcommand/modules",
    "@pubcommand/ui",
  ],
};

export default nextConfig;
