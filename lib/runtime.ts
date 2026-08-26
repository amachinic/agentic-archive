/**
 * Vercel hosts the public, read-only product showcase. The working archive
 * remains local because its SQLite database and managed files require durable
 * host storage.
 */
export const IS_HOSTED_DEMO =
  process.env.ATLAS_DEMO === "1" || process.env.VERCEL === "1";
