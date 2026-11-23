/**
 * Update checks.
 *
 * Two paths, both free and anonymous:
 *
 * - the desktop build asks the Tauri updater, which reads `latest.json` from the
 *   newest public release, verifies the bundle against the public key compiled
 *   into the app, and can install it in place;
 * - a browser tab has no shell, so it reads the GitHub release list and links to
 *   the download instead.
 *
 * Nothing about the machine or the user is sent either way.
 */

import { inTauri } from "./native";

/** The version compiled into this build. Keep in step with src-tauri/tauri.conf.json. */
export const APP_VERSION = "1.0.4";

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

export interface DownloadProgress {
  downloaded: number;
  total: number;
}

export interface NativeUpdate {
  version: string;
  notes: string;
  /** Downloads the bundle, verifies its signature and installs it in place. */
  install: (onProgress: (progress: DownloadProgress) => void) => Promise<void>;
  /** Quits and reopens on the new build. */
  restart: () => Promise<void>;
}

/**
 * The signed update the desktop shell has waiting, if any.
 *
 * Returns null on the web, when there is no newer release, or when the manifest
 * cannot be read — the caller then falls back to the release link.
 */
export async function checkNativeUpdate(): Promise<NativeUpdate | null> {
  if (!inTauri()) return null;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return null;

    const version = update.version.replace(/^v/i, "");
    if (dismissedVersion() === version) return null;

    return {
      version,
      notes: firstLine(update.body || ""),
      install: async (onProgress) => {
        let total = 0;
        let downloaded = 0;
        await update.downloadAndInstall((event) => {
          if (event.event === "Started") {
            total = event.data.contentLength ?? 0;
            onProgress({ downloaded: 0, total });
          } else if (event.event === "Progress") {
            downloaded += event.data.chunkLength;
            onProgress({ downloaded, total });
          } else {
            onProgress({ downloaded: total || downloaded, total });
          }
        });
      },
      restart: async () => {
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      },
    };
  } catch {
    return null;
  }
}
