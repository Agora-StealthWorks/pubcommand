import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
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
