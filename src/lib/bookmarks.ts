import { inTauri } from "./native";

/**
 * Bookmarks already on this Mac.
 *
 * Chrome-family browsers keep a readable `Bookmarks` JSON file per profile.
 * Reading it is read-only and local; cookies, passwords and sessions stay in
 * the browser, which is why live accounts work through the Chrome engine and
 * the extension rather than by copying a profile.
 */

export interface ImportedBookmark {
  title: string;
  url: string;
  folder: string;
}

export interface BrowserProfile {
  name: string;
  bookmarks: ImportedBookmark[];
}

export interface BrowserBookmarks {
  name: string;
  profiles: BrowserProfile[];
}

export async function readBrowserBookmarks(): Promise<BrowserBookmarks[]> {
  if (!inTauri()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  const raw = await invoke<string>("browser_bookmarks");
  return JSON.parse(raw) as BrowserBookmarks[];
}

export function flattenBookmarks(browsers: BrowserBookmarks[]): ImportedBookmark[] {
  const seen = new Set<string>();
  const out: ImportedBookmark[] = [];
  for (const browser of browsers) {
    for (const profile of browser.profiles) {
      for (const bookmark of profile.bookmarks) {
        const url = bookmark.url.trim();
        if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
        seen.add(url);
        out.push(bookmark);
      }
    }
  }
  return out;
}
