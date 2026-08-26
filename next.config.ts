import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev overlay badge renders into the page itself, so it lands in
  // screenshots and in the recorded demo, sitting over Remove duplicates.
  // Off for the project rather than hidden per-session: the session hide
  // expires after a day and comes back silently. Compile and runtime errors
  // still surface without it.
  devIndicators: false,
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
