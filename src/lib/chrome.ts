import { useCallback, useEffect, useState } from "react";
import { inTauri } from "./native";

export const CHROME_PORT = 47654;
const ENGINE_KEY = "lantas.browser.engine.v1";

/** Which engine the browser tab uses: Lantas' own webview, or real Chrome. */
export type BrowserEngine = "local" | "chrome";

export interface ChromeTab {
  id: number;
  title: string;
  url: string;
  active: boolean;
  windowId?: number;
}

export interface ChromePage {
  url: string;
  title: string;
  description?: string;
  text: string;
  words: number;
}

export interface ChromeElement {
  i: number;
  tag: string;
  kind: string;
  label: string;
  selector: string;
}

export interface ChromeEvent {
  id?: string;
  kind?: string;
  type: string;
  ok?: boolean;
  error?: string;
  detail?: string;
  at?: number;
  page?: ChromePage;
  elements?: ChromeElement[];
}

export interface ChromeStatus {
  running: boolean;
  error: string;
  connected: boolean;
  port: number;
  agent: string;
  seen: number;
  tabs: ChromeTab[];
  active: ChromeTab | null;
  page: ChromePage | null;
  elements: ChromeElement[];
  events: ChromeEvent[];
}

export const EMPTY_CHROME: ChromeStatus = {
  running: false,
  error: "",
  connected: false,
  port: CHROME_PORT,
  agent: "",
  seen: 0,
  tabs: [],
  active: null,
  page: null,
  elements: [],
  events: [],
};

export function browserEngine(): BrowserEngine {
  try {
    return localStorage.getItem(ENGINE_KEY) === "chrome" ? "chrome" : "local";
  } catch {
    return "local";
  }
}

export function setBrowserEngine(engine: BrowserEngine) {
  try {
    localStorage.setItem(ENGINE_KEY, engine);
  } catch {
    /* storage unavailable */
  }
}

async function call<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!inTauri()) {
    throw new Error("Chrome control runs in the desktop build, not the web preview.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(name, args ?? {});
}

export async function chromeStatus(): Promise<ChromeStatus> {
  if (!inTauri()) {
    return {
      ...EMPTY_CHROME,
      error: "Chrome control runs in the desktop build. The web preview has no bridge.",
    };
  }
  try {
    const raw = await call<string>("chrome_bridge_state");
    const parsed = JSON.parse(raw) as Partial<ChromeStatus>;
    return {
      ...EMPTY_CHROME,
      ...parsed,
      tabs: parsed.tabs ?? [],
      elements: parsed.elements ?? [],
      events: parsed.events ?? [],
    };
  } catch (error) {
    return {
      ...EMPTY_CHROME,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Sends a command and waits for the extension's matching result. */
export async function chromeCommand<T extends ChromeEvent = ChromeEvent>(
  type: string,
  args: Record<string, unknown> = {},
  timeoutMs = 9000,
): Promise<T> {
  const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  await call<number>("chrome_bridge_send", {
    payload: JSON.stringify({ id, type, ...args }),
  });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await chromeStatus();
    const hit = status.events.find((event) => event.id === id);
    if (hit) {
      if (hit.ok === false) {
        throw new Error(hit.error || "Chrome could not do that.");
      }
      return hit as T;
    }
    await new Promise((resolve) => setTimeout(resolve, 160));
  }

  throw new Error("Chrome did not answer. Is the Lantas extension installed and Chrome open?");
}

export function openChromeUrl(url: string, newTab = false) {
  return chromeCommand("navigate", { url, newTab });
}

export function readChromeTab() {
  return chromeCommand<ChromeEvent & { page: ChromePage; elements: ChromeElement[] }>("read");
}

/** Opens a URL in Chrome itself rather than whichever browser is default. */
export async function openInChrome(url: string): Promise<boolean> {
  if (inTauri()) {
    try {
      await call<void>("open_in_chrome", { url });
      return true;
    } catch {
      /* fall through to a normal link */
    }
  }
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.click();
  return true;
}

export async function chromeExtensionPath(): Promise<string> {
  try {
    return await call<string>("chrome_extension_dir");
  } catch {
    return "";
  }
}

export async function revealChromeExtension(): Promise<string> {
  try {
    return await call<string>("chrome_extension_reveal");
  } catch {
    return "";
  }
}

/** Polls the bridge while the Chrome engine is on screen. */
export function useChromeBridge(active: boolean) {
  const [status, setStatus] = useState<ChromeStatus>(EMPTY_CHROME);

  const refresh = useCallback(async () => {
    setStatus(await chromeStatus());
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const next = await chromeStatus();
      if (alive) setStatus(next);
    };
    void tick();
    if (!active) {
      return () => {
        alive = false;
      };
    }
    const timer = window.setInterval(() => void tick(), 900);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [active]);

  return { status, refresh };
}
