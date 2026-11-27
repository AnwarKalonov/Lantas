/**
 * Product marks for the transcript timeline.
 *
 * A step says what it did and where it did it: “Searched issues · Linear”.
 * These helpers only pick the mark; the drawing lives in BrandMark.tsx, so
 * this module stays free of React and can be used while a part is built.
 */

export type BrandId =
  | "gmail"
  | "drive"
  | "slack"
  | "linear"
  | "notion"
  | "github"
  | "figma"
  | "vercel"
  | "browser";

const ALIASES: Record<string, BrandId> = {
  gmail: "gmail",
  googlemail: "gmail",
  "google-mail": "gmail",
  email: "gmail",
  mail: "gmail",
  googledrive: "drive",
  "google-drive": "drive",
  gdrive: "drive",
  drive: "drive",
  slack: "slack",
  linear: "linear",
  notion: "notion",
  github: "github",
  figma: "figma",
  vercel: "vercel",
  chrome: "browser",
  browser: "browser",
  web: "browser",
};

/** Reads a brand out of any text a tool produced, such as a slug or label. */
export function brandFromText(...values: Array<string | undefined>): BrandId | undefined {
  for (const value of values) {
    if (!value) continue;
    const squashed = value.toLowerCase().replace(/[^a-z0-9-]+/g, " ").trim();
    const words = squashed.split(/[\s_-]+/).filter(Boolean);
    for (const word of words) {
      const hit = ALIASES[word];
      if (hit) return hit;
    }
    // Slugs arrive glued: GMAIL_FETCH_EMAILS, googledrive_search.
    const glued = squashed.replace(/[\s-]+/g, "");
    for (const [key, brand] of Object.entries(ALIASES)) {
      if (glued.includes(key.replace(/-/g, ""))) return brand;
    }
  }
  return undefined;
}

/** Picks the mark for a tool call before the outcome exists. */
export function brandForTool(
  name: string,
  args: Record<string, unknown> = {},
): BrandId | undefined {
  if (name === "browser") return "browser";
  if (name !== "integrations" && name !== "git") return undefined;
  return brandFromText(
    typeof args.slug === "string" ? args.slug : undefined,
    typeof args.toolkit === "string" ? args.toolkit : undefined,
    typeof args.query === "string" ? args.query : undefined,
    typeof args.action === "string" ? args.action : undefined,
  );
}
