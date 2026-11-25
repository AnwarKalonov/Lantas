/**
 * Recognising a workspace path inside free text.
 *
 * The obvious regex also matches the path part of a URL. A tool row saying
 * "Opened https://www.desmos.com/calculator" therefore grew a file chip for
 * `www.desmos.com/calculator`, and clicking it switched to the editor — the
 * "calculator" that sent people to the IDE. A URL is never a file here, so
 * URLs are masked before matching and host-looking matches are rejected.
 */

export const PATH_RE =
  /((?:[\w@.-]+\/)+[\w@.-]+|[\w@.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|css|scss|html|md|mdx|py|rs|go|sh|yml|yaml|toml|swift|java|kt|cs|php|rb|sql|graphql|vue|svelte|astro|lock|txt))(?::(\d+))?/g;

const HOST_SEGMENT = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i;
const URL_START = /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.)/i;

/**
 * Blank out every URL without changing the string's length, so match indices
 * still line up when callers slice the original text.
 */
export function maskUrls(value: string): string {
  return value.replace(/\b(?:https?:\/\/|www\.)\S+/gi, (url) => " ".repeat(url.length));
}

/** `desmos.com/calculator` is a page, not a path in the workspace. */
function isHostPath(candidate: string): boolean {
  if (URL_START.test(candidate)) return true;
  if (!candidate.includes("/")) return false;
  const first = candidate.split("/")[0];
  return HOST_SEGMENT.test(first);
}

export function looksLikePath(value: string): boolean {
  const text = value.trim();
  if (!text || URL_START.test(text) || isHostPath(text)) return false;
  return /^(?:[\w@.-]+\/)+[\w@.-]+$|^[\w@.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|css|scss|html|md|mdx|py|rs|go|sh|yml|yaml|toml|swift|java|kt|cs|php|rb|sql|graphql|vue|svelte|astro|lock|txt)$/.test(
    text,
  );
}

/** The first path in a label, with an optional `:line` and no URL false positives. */
export function pathFrom(value?: string): { path: string; line?: number } | null {
  if (!value) return null;
  PATH_RE.lastIndex = 0;
  const match = PATH_RE.exec(maskUrls(value));
  PATH_RE.lastIndex = 0;
  if (!match || isHostPath(match[1])) return null;
  return { path: match[1], line: match[2] ? Number(match[2]) : undefined };
}
