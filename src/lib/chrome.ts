import { useCallback, useEffect, useState } from "react";
import { inTauri } from "./native";

export const CHROME_PORT = 47654;
const ENGINE_KEY = "lantas.browser.engine.v1";
const ID_KEY = "lantas.chrome.extension.v1";

/** Which engine the browser tab uses: Lantas' own webview, or real Chrome. */
export type BrowserEngine = "local" | "chrome";

/** How Lantas reaches the extension: desktop bridge, page messaging, or not at all. */
export type ChromeTransport = "bridge" | "extension" | "none";

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
  text?: string;
  page?: ChromePage;
  elements?: ChromeElement[];
}

export interface ChromeStatus {
  transport: ChromeTransport;
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
  transport: "none",
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

/* ------------------------------------------------------- the extension's ID */

export function chromeExtensionId(): string {
  try {
    return localStorage.getItem(ID_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setChromeExtensionId(raw: string) {
  const value = raw.trim();
  try {
    if (value) localStorage.setItem(ID_KEY, value);
    else localStorage.removeItem(ID_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function looksLikeExtensionId(value: string): boolean {
  return /^[a-p]{32}$/i.test(value.trim());
}

/* ----------------------------------------- web page <-> extension messaging */

interface PageRuntime {
  sendMessage: (
    extensionId: string,
    message: unknown,
    callback: (response: unknown) => void,
  ) => void;
  lastError?: { message?: string };
}

function pageRuntime(): PageRuntime | null {
  if (typeof window === "undefined") return null;
  const runtime = (window as unknown as { chrome?: { runtime?: PageRuntime } }).chrome?.runtime;
  return runtime?.sendMessage ? runtime : null;
}

function pageSend(payload: unknown): Promise<Record<string, unknown>> {
  const runtime = pageRuntime();
  const id = chromeExtensionId();
  if (!runtime || !id) {
    return Promise.reject(new Error("Paste the Chrome extension ID in this panel first."));
  }

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error("The extension did not answer. Is it installed and enabled?")),
      10000,
    );
    try {
      runtime.sendMessage(id, payload, (response) => {
        window.clearTimeout(timer);
        const failure = runtime.lastError?.message;
        if (failure) reject(new Error(failure));
        else resolve((response ?? {}) as Record<string, unknown>);
      });
    } catch (error) {
      window.clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/* --------------------------------------------------------------- transport */

async function call<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!inTauri()) {
    throw new Error("That needs the desktop build.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(name, args ?? {});
}

export async function chromeStatus(): Promise<ChromeStatus> {
  if (!inTauri()) {
    if (!pageRuntime() || !chromeExtensionId()) {
      return { ...EMPTY_CHROME, running: Boolean(pageRuntime()) };
    }
    try {
      const response = await pageSend({ type: "status" });
      const connected = Boolean(response.ok);
      return {
        ...EMPTY_CHROME,
        transport: "extension",
        running: true,
        connected,
        agent: String(response.version ?? ""),
        tabs: (response.tabs as ChromeTab[]) ?? [],
        active: (response.active as ChromeTab | null) ?? null,
        page: (response.page as ChromePage | null) ?? null,
        elements: (response.elements as ChromeElement[]) ?? [],
      };
    } catch (error) {
      return {
        ...EMPTY_CHROME,
        transport: "extension",
        running: true,
        connected: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  try {
    const raw = await call<string>("chrome_bridge_state");
    const parsed = JSON.parse(raw) as Partial<ChromeStatus>;
    return {
      ...EMPTY_CHROME,
      ...parsed,
      transport: "bridge",
      tabs: parsed.tabs ?? [],
      elements: parsed.elements ?? [],
      events: parsed.events ?? [],
    };
  } catch (error) {
    return {
      ...EMPTY_CHROME,
      transport: "bridge",
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
  const payload = { id, type, ...args };

  if (!inTauri()) {
    const response = (await pageSend(payload)) as unknown as ChromeEvent;
    if (response.ok === false) {
      throw new Error(response.error || "Chrome could not do that.");
    }
    return response as T;
  }

  await call<number>("chrome_bridge_send", { payload: JSON.stringify(payload) });

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

/** Sends a frame without waiting for a result — used for chat replies. */
export async function chromeSendRaw(payload: Record<string, unknown>): Promise<boolean> {
  if (!inTauri()) return false;
  try {
    await call<number>("chrome_bridge_send", { payload: JSON.stringify(payload) });
    return true;
  } catch {
    return false;
  }
}

export function chromeChatStatus(chatId: string, text: string) {
  return chromeSendRaw({ type: "chat_status", chatId, text });
}

export function chromeChatReply(chatId: string, text: string, note?: string) {
  return chromeSendRaw({
    type: "chat_reply",
    chatId,
    text,
    ...(note ? { note } : {}),
  });
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
