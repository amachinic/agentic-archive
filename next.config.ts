import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp and node:sqlite are native/builtin: keep them out of the bundler.
  serverExternalPackages: ["sharp"],
  experimental: {
    // Full-resolution originals stream through a route handler; allow big bodies.
    proxyTimeout: 120_000,
  },
};

export default nextConfig;
