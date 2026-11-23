/**
 * Update checks.
 *
 * The app reads the public release list from the download repository on GitHub:
 * free, anonymous, no server of ours and no token. Nothing about the machine or
 * the user is sent with the request, and the answer is only used to show a
 * notice — installing a new version is always a download the person starts.
 */

/** The version compiled into this build. Keep in step with src-tauri/tauri.conf.json. */
export const APP_VERSION = "0.1.0";

export const RELEASES_REPO = "AnwarKalonov/Lantas-download";
export const RELEASES_URL = `https://github.com/${RELEASES_REPO}/releases`;

const API = `https://api.github.com/repos/${RELEASES_REPO}/releases?per_page=20`;
const DISMISSED_KEY = "lantas.update.dismissed";

export interface AvailableUpdate {
  version: string;
  url: string;
  notes: string;
  published: string;
}

interface GithubRelease {
  tag_name?: string;
  name?: string;
  html_url?: string;
  body?: string;
  published_at?: string;
  draft?: boolean;
  prerelease?: boolean;
}

function parts(version: string): number[] {
  return String(version)
    .replace(/^v/i, "")
    .split(/[.\-+]/)
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
}

/** True when `candidate` is a later version than `current`. */
export function isNewer(candidate: string, current: string): boolean {
  const a = parts(candidate);
  const b = parts(current);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

/** The version the person said "not now" to, if any. */
export function dismissedVersion(): string {
  try {
    return localStorage.getItem(DISMISSED_KEY) || "";
  } catch {
    return "";
  }
}

export function dismissUpdate(version: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, version);
  } catch {
    /* storage blocked: the notice simply comes back next launch */
  }
}

/** First useful line of the release notes, for the tooltip. */
function firstLine(body: string): string {
  const line = String(body || "")
    .split("\n")
    .map((row) => row.replace(/^[#>\-*\s]+/, "").replace(/[*_`]/g, "").trim())
    .filter(Boolean)
    .filter((row) => !/^what'?s changed$/i.test(row))
    .filter((row) => !/^full changelog/i.test(row))
    .find(Boolean);
  return (line || "").slice(0, 220);
}

/**
 * The newest stable release, when it is later than this build.
 *
 * Throws when GitHub cannot be reached, so a manual check can say so; the
 * launch-time check swallows that and stays quiet.
 */
export async function checkForUpdate(
  current: string = APP_VERSION,
  options: { ignoreDismissed?: boolean } = {}
): Promise<AvailableUpdate | null> {
  const response = await fetch(API, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);

  const releases = (await response.json()) as GithubRelease[];
  if (!Array.isArray(releases)) return null;

  const latest = releases.find((release) => !release.draft && !release.prerelease);
  const version = (latest?.tag_name || latest?.name || "").replace(/^v/i, "").trim();
  if (!latest || !version || !isNewer(version, current)) return null;
  if (!options.ignoreDismissed && dismissedVersion() === version) return null;

  return {
    version,
    url: latest.html_url || RELEASES_URL,
    notes: firstLine(latest.body || ""),
    published: latest.published_at || "",
  };
}
