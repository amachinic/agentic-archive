import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp and node:sqlite are native/builtin: keep them out of the bundler.
  serverExternalPackages: ["sharp"],
  // Dynamic local file paths must never pull the private archive or its
  // derived cache into a server trace or deployment bundle.
  outputFileTracingExcludes: {
    "/*": ["./library/**/*", "./.cache/**/*", "./atlas.db*", "./.env*"],
  },
  // The sanitized public database is opened dynamically by path at runtime,
  // so every server route that may query it needs the file in its trace.
  outputFileTracingIncludes: {
    "/*": ["./data/atlas-public.db"],
  },
  experimental: {
    // Full-resolution originals stream through a route handler; allow big bodies.
    proxyTimeout: 120_000,
  },
};

export default nextConfig;
