import {
  browserEngine,
  chromeCommand,
  type BrowserEngine,
  type ChromeElement,
  type ChromePage,
} from "./chrome";
import { getElContext, type ElPage } from "./el";
import { elClick, elEval, elHistory, elNavigate, elReload } from "./native";

/**
 * One surface for browser actions, so the assistant does not care whether the
 * page is in Lantas' own engine or in the user's Chrome via the extension.
 *
 * The shape follows opencode's tool contract: every action takes a small typed
 * argument set, reports what it actually did, and refuses when there is no
 * page. Lantas' native engine exposes a narrower surface than Chrome (no
 * element references, no tab control), so capabilities are reported rather
 * than faked.
 */

const looksLikeSelector = (value: string) =>
  /^[#.]/.test(value) || /^\w+\[/.test(value) || /^[a-z][\w-]*\s*>/.test(value);

/**
 * One turn can force a target engine. The Chrome side panel always talks to the
 * user's Chrome tab, even when the app's own browser is showing Lantas' engine.
 */
let engineOverride: BrowserEngine | null = null;

export function setBrowserEngineOverride(engine: BrowserEngine | null) {
  engineOverride = engine;
}

function activeEngine(): BrowserEngine {
  return engineOverride ?? browserEngine();
}

/** Chrome's page shape has an optional description; the model side does not. */
function asElPage(page: ChromePage | null): ElPage | null {
  if (!page) return null;
  return {
    url: page.url,
    title: page.title,
    description: page.description ?? "",
    text: page.text,
    words: page.words,
  };
}

export interface BrowserSnapshot {
  engine: BrowserEngine;
  page: ElPage | null;
  elements: ChromeElement[];
  /** What this engine can do, so the model does not call a missing action. */
  supports: string[];
}

export async function agentClick(target: string): Promise<boolean> {
  if (activeEngine() === "chrome") {
    try {
      await chromeCommand("act", {
        action: "click",
        text: looksLikeSelector(target) ? undefined : target,
        selector: looksLikeSelector(target) ? target : undefined,
      });
      return true;
    } catch {
      return false;
    }
  }
  return elClick(target);
}

/** Clicks the Nth interactive element from the last snapshot. */
export async function agentClickRef(index: number): Promise<boolean> {
  if (activeEngine() !== "chrome") return false;
  try {
    await chromeCommand("act", { action: "click", index });
    return true;
  } catch {
    return false;
  }
}

export async function agentType(text: string, selector?: string, submit = false): Promise<boolean> {
  if (activeEngine() === "chrome") {
    try {
      await chromeCommand("act", { action: "type", text, selector, submit });
      return true;
    } catch {
      return false;
    }
  }
  const target = selector ? JSON.stringify(selector) : "document.activeElement";
  const payload = JSON.stringify(text);
  await elEval(
    `(() => {
      const el = ${target};
      if (!el) return;
      el.focus();
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, ${payload}); else el.value = ${payload};
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    })()`,
  );
  return true;
}

export async function agentEnter(): Promise<boolean> {
  return agentPress("Enter");
}

export async function agentPress(key: string): Promise<boolean> {
  if (activeEngine() === "chrome") {
    try {
      await chromeCommand("act", { action: "press", key });
      return true;
    } catch {
      return false;
    }
  }
  const payload = JSON.stringify(key);
  await elEval(
    `(() => {
      const key = ${payload};
      const el = document.activeElement || document.body;
      if (!el) return;
      for (const type of ["keydown", "keypress", "keyup"]) {
        el.dispatchEvent(new KeyboardEvent(type, { key, code: key, bubbles: true, cancelable: true }));
      }
      if (key === "Enter" && el.form && typeof el.form.requestSubmit === "function") el.form.requestSubmit();
    })()`,
  );
  return true;
}

export async function agentScroll(pixels: number): Promise<boolean> {
  if (activeEngine() === "chrome") {
    try {
      await chromeCommand("act", { action: "scroll", dy: pixels });
      return true;
    } catch {
      return false;
    }
  }
  await elEval(`window.scrollBy({ top: ${pixels}, behavior: "smooth" })`);
  return true;
}

export async function agentNavigate(url: string): Promise<boolean> {
  if (activeEngine() === "chrome") {
    try {
      await chromeCommand("navigate", { url });
      return true;
    } catch {
      return false;
    }
  }
  // BrowserView owns the address bar, tab title and history. Ask it to
  // navigate so an agent-driven page change is visible in the app, then fall
  // back to the native webview for when that panel is not mounted.
  window.dispatchEvent(new CustomEvent("lantas:navigate", { detail: { url } }));
  await elNavigate(url);
  return true;
}

export async function agentHistory(direction: "back" | "forward"): Promise<boolean> {
  if (activeEngine() === "chrome") {
    try {
      await chromeCommand("history", { direction });
      return true;
    } catch {
      return false;
    }
  }
  await elHistory(direction);
  return true;
}

export async function agentReload(): Promise<boolean> {
  if (activeEngine() === "chrome") {
    try {
      await chromeCommand("reload");
      return true;
    } catch {
      return false;
    }
  }
  await elReload();
  return true;
}

/** The page's text as the model should see it, from Chrome or from the native engine. */
export async function agentPage(): Promise<ElPage | null> {
  if (activeEngine() !== "chrome") return getElContext();
  try {
    const result = await chromeCommand("read");
    return asElPage(result.page ?? null);
  } catch {
    return null;
  }
}

/** Page text plus the numbered interactive elements Chrome can see. */
export async function agentSnapshot(): Promise<BrowserSnapshot> {
  const engine = activeEngine();
  if (engine === "chrome") {
    try {
      const result = await chromeCommand("read");
      return {
        engine,
        page: asElPage(result.page ?? null),
        elements: result.elements ?? [],
        supports: [
          "snapshot",
          "extract",
          "click",
          "click_ref",
          "type",
          "press",
          "scroll",
          "navigate",
          "back",
          "forward",
          "reload",
        ],
      };
    } catch {
      return {
        engine,
        page: null,
        elements: [],
        supports: ["snapshot", "extract", "navigate"],
      };
    }
  }
  return {
    engine,
    page: getElContext(),
    elements: [],
    supports: ["extract", "click", "type", "press", "scroll", "navigate", "back", "forward", "reload"],
  };
}

export async function agentOpenChrome(url: string, newTab = false): Promise<boolean> {
  try {
    await chromeCommand("navigate", { url, newTab });
    return true;
  } catch {
    return false;
  }
}

/** Formatted page + element map, capped so it fits comfortably in context. */
export function describeSnapshot(snapshot: BrowserSnapshot): string {
  const page = snapshot.page;
  if (!page) {
    return snapshot.engine === "chrome"
      ? "Chrome is open but no readable website is active. Open a site or navigate first."
      : "No page has been read in Lantas Browser yet. Open a URL, then snapshot again.";
  }
  const header = [
    `Engine: ${snapshot.engine}`,
    `URL: ${page.url}`,
    `Title: ${page.title}`,
    page.description ? `Description: ${page.description}` : "",
    `Words: ${page.words}`,
  ]
    .filter(Boolean)
    .join("\n");
  const elements = snapshot.elements.length
    ? `\n\nInteractive elements (use click_ref with the number):\n${snapshot.elements
        .slice(0, 120)
        .map((el) => `${el.i}. [${el.kind}] ${el.label}`)
        .join("\n")}`
    : "";
  return `${header}\n\nText:\n${page.text.slice(0, 16_000)}${elements}`;
}
