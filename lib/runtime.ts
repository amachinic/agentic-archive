/**
 * Runtime modes are intentionally explicit:
 * - local: the existing writable archive
 * - demo: the synthetic, read-only Vercel fallback
 * - public: the sanitized, read-only archive bundled with the deployment
 */
export const IS_PUBLIC_ARCHIVE =
  process.env.ATLAS_ARCHIVE_MODE === "public";

export const IS_HOSTED_DEMO =
  !IS_PUBLIC_ARCHIVE &&
  (process.env.ATLAS_DEMO === "1" || process.env.VERCEL === "1");

export const IS_HOSTED_READ_ONLY =
  IS_PUBLIC_ARCHIVE || IS_HOSTED_DEMO;
