import { httpFetch } from "./providers";

const KEY = "lantas.el.v1";
export const EL_HOME = "el://home";

export interface ElTab {
  id: string;
  url: string;
  title: string;
}

export interface ElVisit {
  url: string;
  title: string;
  at: number;
}

export interface ElProfile {
  name: string;
  email: string;
  joined: number;
}

export interface ElData {
  tabs: ElTab[];
  active: string;
  history: ElVisit[];
  bookmarks: Array<{ url: string; title: string }>;
  profile: ElProfile | null;
}

export interface ElPage {
  url: string;
  title: string;
  description: string;
  text: string;
  words: number;
}

let context: ElPage | null = null;

export function setElContext(page: ElPage | null) {
  context = page;
  try {
    if (page) sessionStorage.setItem("lantas.el.page", JSON.stringify(page));
    else sessionStorage.removeItem("lantas.el.page");
  } catch {
    /* private mode */
  }
}

export function getElContext(): ElPage | null {
  if (context) return context;
  try {
    const raw = sessionStorage.getItem("lantas.el.page");
    return raw ? (JSON.parse(raw) as ElPage) : null;
  } catch {
    return null;
  }
}

export function loadEl(): ElData {
  const fallback: ElData = {
    tabs: [{ id: "tab-home", url: EL_HOME, title: "New tab" }],
    active: "tab-home",
    history: [],
    bookmarks: [
      { url: "https://github.com", title: "GitHub" },
      { url: "https://developer.mozilla.org", title: "MDN" },
    ],
    profile: null,
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<ElData>;
    if (!parsed.tabs?.length) return fallback;
    return {
      tabs: parsed.tabs,
      active:
        parsed.active && parsed.tabs.some((tab) => tab.id === parsed.active)
          ? parsed.active
          : parsed.tabs[0].id,
      history: (parsed.history ?? []).slice(0, 60),
      bookmarks: parsed.bookmarks ?? [],
      profile: parsed.profile ?? null,
    };
  } catch {
    return fallback;
  }
}

export function saveEl(data: ElData) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...data, history: data.history.slice(0, 60) }));
  } catch {
    /* quota */
  }
}

/** Is this a hostname such as `github.com` or `example.co.uk/path`? */
function isHostname(value: string): boolean {
  return /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(value);
}

/**
 * The address bar resolves addresses, nothing else.
 *
 * It does not recognise product names, strip a command verb, guess a `.com`
 * or decide which page a sentence meant. Those are the assistant's decisions:
 * the app opening a page on its own is a page the user never asked the model
 * for. A real address is used as written; anything else is a search.
 */
export function normalizeUrl(raw: string): string {
  const original = raw.trim();
  if (!original) return EL_HOME;
  if (original === EL_HOME) return original;

  if (/^https?:\/\//i.test(original)) {
    try {
      // Do not hand a hostless string such as `https://` to the browser: it
      // renders as an empty page and looks like a successful navigation.
      if (new URL(original).hostname) return original;
    } catch {
      /* fall through */
    }
  }
  if (/^localhost(?::\d+)?(?:\/\S*)?$/i.test(original)) return `http://${original}`;
  if (isHostname(original)) return `https://${original}`;

  return `https://www.google.com/search?q=${encodeURIComponent(original)}`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Fetch a page through the Rust bridge when available and reduce it to text. */
export async function readPage(url: string): Promise<ElPage> {
  const response = await httpFetch(url, {
    headers: { accept: "text/html,application/xhtml+xml" },
  });
  if (!response.ok) throw new Error(`El ${response.status} · ${hostOf(url)}`);
  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc
    .querySelectorAll("script,style,noscript,svg,iframe,nav,footer,aside,form")
    .forEach((node) => node.remove());
  const title =
    doc.querySelector("meta[property='og:title']")?.getAttribute("content") ||
    doc.querySelector("title")?.textContent?.trim() ||
    hostOf(url);
  const description =
    doc.querySelector("meta[name='description']")?.getAttribute("content") ||
    doc.querySelector("meta[property='og:description']")?.getAttribute("content") ||
    "";
  const main = doc.querySelector("article,main,[role='main']") ?? doc.body;
  const text = (main?.textContent ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s([.,;:!?])/g, "$1")
    .trim()
    .slice(0, 40000);
  return {
    url,
    title,
    description,
    text,
    words: text ? text.split(/\s+/).length : 0,
  };
}

const AGENT_KEY = "lantas.browser.agent.v1";

/** Whether the model may click, type and navigate in Lantas Browser. */
export function aiDriving(): boolean {
  try {
    return localStorage.getItem(AGENT_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setAiDriving(on: boolean) {
  try {
    localStorage.setItem(AGENT_KEY, on ? "on" : "off");
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new CustomEvent("lantas:agent", { detail: { on } }));
}
