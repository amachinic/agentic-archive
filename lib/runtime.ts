/**
 * Runtime modes are intentionally explicit:
 * - local: the existing writable archive
 * - demo: the synthetic, read-only Vercel fallback
 * - public: the sanitized, read-only archive bundled with the deployment
 */
export const IS_PUBLIC_ARCHIVE =
  process.env.ATLAS_ARCHIVE_MODE?.trim() === "public";

export const IS_HOSTED_DEMO =
  !IS_PUBLIC_ARCHIVE &&
  (process.env.ATLAS_DEMO?.trim() === "1" || process.env.VERCEL?.trim() === "1");

export const IS_HOSTED_READ_ONLY =
  IS_PUBLIC_ARCHIVE || IS_HOSTED_DEMO;

/** where the full build lives */
export const REPO_URL = "https://github.com/amachinic/agentic-archive";

/**
 * The one sentence for every limit the public copy has — a refused write, a
 * feature that needs storage, a key that cannot live in a shared deployment.
 * Written for a person, and pointing somewhere: the full build is a download
 * away, and saying so is more useful than saying no.
 */
export const HOSTED_LIMIT =
  "this is the public, read-only copy of Agentic Archive, so it can look but not write. " +
  "For full access — tagging, filing, uploads, exports and your own archive — download the full build from the GitHub repo: " + REPO_URL;
