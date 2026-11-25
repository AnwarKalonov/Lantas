/**
 * Names people say out loud, and the address they mean.
 *
 * "Open YouTube" is a destination, not a query. Without this the browser has
 * only two options: search the words, which is what made "open GitHub" land on
 * a Google results page, or ask the model to guess. This is a small, explicit
 * table of the sites people actually name, checked only after the input has
 * been stripped of its command verb. Anything not listed stays the model's
 * decision; nothing here invents a route.
 */

const SITES: Record<string, string> = {
  amazon: "https://www.amazon.com",
  apple: "https://www.apple.com",
  calendar: "https://calendar.google.com",
  canva: "https://www.canva.com",
  chatgpt: "https://chatgpt.com",
  claude: "https://claude.ai",
  discord: "https://discord.com",
  docs: "https://docs.google.com",
  drive: "https://drive.google.com",
  dropbox: "https://www.dropbox.com",
  facebook: "https://www.facebook.com",
  figma: "https://www.figma.com",
  gmail: "https://mail.google.com",
  github: "https://github.com",
  gitlab: "https://gitlab.com",
  google: "https://www.google.com",
  instagram: "https://www.instagram.com",
  linkedin: "https://www.linkedin.com",
  mail: "https://mail.google.com",
  maps: "https://maps.google.com",
  netflix: "https://www.netflix.com",
  notion: "https://www.notion.so",
  pinterest: "https://www.pinterest.com",
  reddit: "https://www.reddit.com",
  sheets: "https://docs.google.com/spreadsheets",
  slack: "https://app.slack.com",
  slides: "https://docs.google.com/presentation",
  spotify: "https://open.spotify.com",
  stackoverflow: "https://stackoverflow.com",
  telegram: "https://web.telegram.org",
  tiktok: "https://www.tiktok.com",
  trello: "https://trello.com",
  twitch: "https://www.twitch.tv",
  weather: "https://weather.com",
  whatsapp: "https://web.whatsapp.com",
  wikipedia: "https://www.wikipedia.org",
  x: "https://x.com",
  youtube: "https://www.youtube.com",
  zoom: "https://zoom.us",
};

/** Command phrasing in front of a destination. */
const OPEN_VERB =
  /^(?:please\s+|hey\s+|ok(?:ay)?\s+)*(?:can\s+you\s+|could\s+you\s+)?(?:open(?:\s+up)?|go\s+to|goto|take\s+me\s+to|bring\s+me\s+to|navigate\s+to|visit|launch|show\s+me|pull\s+up)\s+/i;

/** Politeness and instructions that trail a destination. */
const TRAILING = /[\s,.!?]*(?:please|for\s+me|in\s+(?:a\s+)?new\s+tab|in\s+the\s+browser|in\s+chrome|on\s+the\s+web)[\s,.!?]*$/i;

/**
 * Remove "open", "go to", "take me to" and the trailing "please" from a
 * command. Returns the destination text and whether a command was present.
 */
export function stripOpenCommand(raw: string): { value: string; commanded: boolean } {
  let value = String(raw ?? "").trim();
  const commanded = OPEN_VERB.test(value);
  if (commanded) value = value.replace(OPEN_VERB, "").trim();
  value = value.replace(TRAILING, "").replace(/^["'`]+|["'`]+$/g, "").trim();
  return { value, commanded };
}

/** The address behind a site name such as `youtube` or `my email`. */
export function siteForName(raw: string): string | null {
  const key = String(raw ?? "")
    .toLowerCase()
    .replace(/^\s*(?:the|a|my|our)\s+/, "")
    .replace(/\b(?:website|site|page|app|homepage|home\s+page)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!key) return null;
  return SITES[key] ?? SITES[key.replace(/\s+/g, "")] ?? null;
}
