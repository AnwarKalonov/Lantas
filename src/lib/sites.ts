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
  airbnb: "https://www.airbnb.com",
  amazon: "https://www.amazon.com",
  anthropic: "https://www.anthropic.com",
  apple: "https://www.apple.com",
  asana: "https://app.asana.com",
  atlassian: "https://www.atlassian.com",
  booking: "https://www.booking.com",
  calendar: "https://calendar.google.com",
  canva: "https://www.canva.com",
  chatgpt: "https://chatgpt.com",
  claude: "https://claude.ai",
  discord: "https://discord.com",
  desmos: "https://www.desmos.com/calculator",
  disney: "https://www.disneyplus.com",
  docs: "https://docs.google.com",
  drive: "https://drive.google.com",
  dropbox: "https://www.dropbox.com",
  excalidraw: "https://excalidraw.com",
  facebook: "https://www.facebook.com",
  figma: "https://www.figma.com",
  firebase: "https://console.firebase.google.com",
  framer: "https://www.framer.com",
  gmail: "https://mail.google.com",
  github: "https://github.com",
  gitlab: "https://gitlab.com",
  gemini: "https://gemini.google.com",
  google: "https://www.google.com",
  hackernews: "https://news.ycombinator.com",
  huggingface: "https://huggingface.co",
  hulu: "https://www.hulu.com",
  instagram: "https://www.instagram.com",
  jira: "https://www.atlassian.com/software/jira",
  linear: "https://linear.app",
  linkedin: "https://www.linkedin.com",
  loom: "https://www.loom.com",
  mail: "https://mail.google.com",
  maps: "https://maps.google.com",
  mdn: "https://developer.mozilla.org",
  miro: "https://miro.com",
  monday: "https://monday.com",
  netflix: "https://www.netflix.com",
  notion: "https://www.notion.so",
  npm: "https://www.npmjs.com",
  openai: "https://openai.com",
  outlook: "https://outlook.live.com/mail",
  photopea: "https://www.photopea.com",
  pinterest: "https://www.pinterest.com",
  reddit: "https://www.reddit.com",
  replit: "https://replit.com",
  sheets: "https://docs.google.com/spreadsheets",
  slack: "https://app.slack.com",
  slides: "https://docs.google.com/presentation",
  spotify: "https://open.spotify.com",
  stackoverflow: "https://stackoverflow.com",
  steam: "https://store.steampowered.com",
  supabase: "https://supabase.com/dashboard",
  telegram: "https://web.telegram.org",
  tiktok: "https://www.tiktok.com",
  trello: "https://trello.com",
  twitch: "https://www.twitch.tv",
  uber: "https://www.uber.com",
  vercel: "https://vercel.com/dashboard",
  weather: "https://weather.com",
  webflow: "https://webflow.com",
  whatsapp: "https://web.whatsapp.com",
  wikipedia: "https://www.wikipedia.org",
  wolfram: "https://www.wolframalpha.com",
  wolframalpha: "https://www.wolframalpha.com",
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

/**
 * The address behind a product name the table does not know.
 *
 * Most things people name are still one word: desmos, linear, figma. When the
 * sentence was a command ("open desmos"), `desmos.com` is the answer far more
 * often than a search results page is, and it is checked by the browser itself:
 * a domain that does not exist fails to load instead of silently becoming a
 * query. Only safe, single-token names qualify.
 */
export function guessDomain(raw: string): string | null {
  // A phrase is not a product name: "zzqx unknown thing" must not be welded
  // into zzqxunknownthing.com.
  const text = String(raw ?? "").trim();
  if (!text || /\s/.test(text)) return null;
  const token = text
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
  if (!/^[a-z][a-z0-9-]{1,28}[a-z0-9]$/.test(token)) return null;
  if (token.includes("--")) return null;
  return `https://www.${token}.com`;
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
