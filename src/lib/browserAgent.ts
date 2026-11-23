import {
  browserEngine,
  chromeCommand,
  type BrowserEngine,
  type ChromeElement,
  type ChromePage,
} from "./chrome";
import { getElContext, setElContext, type ElPage } from "./el";
import {
  elClick,
  elHistory,
  elNavigate,
  elReload,
  elVisible,
  inTauri,
  runInPage,
} from "./native";

/**
 * One surface for browser actions, so the assistant does not care whether the
 * page is in Lantas' own engine or in the user's Chrome via the extension.
 *
 * The native engine runs the same kind of accessibility scan as the Chrome
 * content script and returns its result through Tauri's eval callback. That is
 * the important difference from the old bridge: an action is only successful
 * when the page says it happened. Models get the new URL, title and controls
 * after every step, so they can verify rather than invent.
 */

const looksLikeSelector = (value: string) =>
  /^[#.]/.test(value) || /^\w+\[/.test(value) || /^[a-z][\w-]*\s*>/.test(value);

let engineOverride: BrowserEngine | null = null;

export function setBrowserEngineOverride(engine: BrowserEngine | null) {
  engineOverride = engine;
}

function activeEngine(): BrowserEngine {
  return engineOverride ?? browserEngine();
}

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
  supports: string[];
}

/* ------------------------------------------------------- native page bridge */

interface NativeRead {
  ok?: boolean;
  error?: string;
  page: ElPage;
  elements: ChromeElement[];
}

/**
 * The page scan used by the native engine. It tags every visible control with
 * a stable ref, reads the page in a model-friendly form, and includes the aria
 * labels that canvas-heavy apps such as Desmos use instead of text nodes.
 */
const READ_SCRIPT = `
  const cleanText = (value, max) =>
    String(value || "").replace(/\\s+/g, " ").trim().slice(0, max || 160);
  const visible = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0.04;
  };
  const kindFor = (el) => {
    const tag = el.tagName.toLowerCase();
    if (el.isContentEditable) return "text";
    if (tag === "a") return "link";
    if (tag === "button") return "button";
    if (tag === "input") return el.type || "input";
    if (tag === "textarea") return "text";
    if (tag === "select") return "select";
    if (tag === "summary") return "button";
    if (el.classList && el.classList.contains("dcg-expressionitem")) return "math";
    return el.getAttribute("role") || tag;
  };
  const labelFor = (el) => {
    const direct =
      el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      el.getAttribute("title") ||
      (el.tagName === "INPUT" || el.tagName === "TEXTAREA" ? el.value : "") ||
      el.innerText ||
      el.textContent;
    const label = cleanText(direct, 120);
    if (label) return label;
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const node = document.getElementById(by);
      if (node && node.textContent) return cleanText(node.textContent, 120);
    }
    return kindFor(el);
  };
  const selectorFor = (el) => {
    if (el.id && /^[A-Za-z][\\w:-]*$/.test(el.id)) return "#" + CSS.escape(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 5) {
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
        if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
      if (node === document.body) break;
      node = parent;
    }
    return parts.join(" > ");
  };

  const candidates = Array.from(document.querySelectorAll(
    'a[href],button,[role="button"],input:not([type="hidden"]),textarea,select,summary,' +
    '[contenteditable="true"],[contenteditable=""],[role="textbox"],[role="listitem"],' +
    '.dcg-expressionitem,.dcg-action-add-expression'
  )).filter(visible);

  document.querySelectorAll("[data-lantas-ref]").forEach((node) =>
    node.removeAttribute("data-lantas-ref")
  );

  const elements = [];
  for (const el of candidates) {
    if (elements.length >= 120) break;
    const i = elements.length;
    el.setAttribute("data-lantas-ref", String(i));
    elements.push({
      i,
      tag: el.tagName.toLowerCase(),
      kind: kindFor(el),
      label: labelFor(el),
      selector: selectorFor(el),
    });
  }

  const clone = document.body ? document.body.cloneNode(true) : null;
  if (clone) {
    clone
      .querySelectorAll("script,style,noscript,svg,template,iframe,canvas")
      .forEach((node) => node.remove());
  }
  const bodyText = String(clone ? clone.textContent : "")
    .replace(/[ \\t\\u00a0]+/g, " ")
    .replace(/\\n{3,}/g, "\\n\\n")
    .trim();
  const aria = Array.from(document.querySelectorAll("[aria-label]"))
    .map((el) => cleanText(el.getAttribute("aria-label"), 100))
    .filter((value, index, all) => value && all.indexOf(value) === index)
    .slice(0, 160)
    .join(" | ");
  const graphExpressions = (() => {
    try {
      if (!window.Calc || typeof window.Calc.getExpressions !== "function") return "";
      return window.Calc.getExpressions()
        .map((item) => item.id + ": " + (item.latex || "(empty)"))
        .join(" | ");
    } catch (_) {
      return "";
    }
  })();
  const text = [
    bodyText,
    aria ? "Accessible controls: " + aria : "",
    graphExpressions ? "Graph expressions: " + graphExpressions : "",
  ]
    .filter(Boolean)
    .join("\\n\\n")
    .slice(0, 30000);
  const description =
    document.querySelector("meta[name='description']")?.getAttribute("content") ||
    document.querySelector("meta[property='og:description']")?.getAttribute("content") ||
    "";

  return {
    ok: true,
    page: {
      url: location.href,
      title: document.title || location.hostname,
      description: cleanText(description, 300),
      text,
      words: text ? text.split(/\\s+/).length : 0,
    },
    elements,
  };
`;

let lastNativeReadAt = 0;

async function readNative(): Promise<NativeRead | null> {
  if (!inTauri()) return null;
  try {
    const result = await runInPage<NativeRead>(READ_SCRIPT);
    if (!result || !result.page) return null;
    const page: ElPage = {
      url: result.page.url || "",
      title: result.page.title || "",
      description: result.page.description || "",
      text: result.page.text || "",
      words: Number(result.page.words) || 0,
    };
    const elements = Array.isArray(result.elements) ? result.elements : [];
    lastNativeReadAt = Date.now();
    setElContext(page);
    window.dispatchEvent(
      new CustomEvent("lantas:page", { detail: { page, elements, engine: "local" } }),
    );
    return { ...result, page, elements };
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function samePage(current: string, wanted: string) {
  if (!current || !wanted) return false;
  if (current === wanted) return true;
  try {
    const a = new URL(current);
    const b = new URL(wanted);
    return a.origin === b.origin && a.pathname === b.pathname;
  } catch {
    return current.startsWith(wanted) || wanted.startsWith(current);
  }
}

/** Polls the hidden webview until navigation has actually landed. */
export async function waitForNativePage(
  wanted?: string,
  attempts = 20,
): Promise<NativeRead | null> {
  let last: NativeRead | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await readNative();
    if (last?.page?.url && (!wanted || samePage(last.page.url, wanted))) return last;
    await sleep(attempt < 4 ? 250 : 450);
  }
  return last;
}

/* --------------------------------------------------------------- actions */

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

  const result = await runInPage<{ ok: boolean; error?: string }>(`
    const want = ${JSON.stringify(target)};
    const cleanText = (value, max) =>
      String(value || "").replace(/\\s+/g, " ").trim().slice(0, max || 160);
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return false;
      const style = getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden";
    };
    const labelFor = (el) =>
      cleanText(
        el.getAttribute("aria-label") ||
        el.getAttribute("placeholder") ||
        el.getAttribute("title") ||
        (el.tagName === "INPUT" || el.tagName === "TEXTAREA" ? el.value : "") ||
        el.innerText ||
        el.textContent
      );
    let el = null;
    try { el = document.querySelector(want); } catch (_) {}
    if (!el) {
      const options = Array.from(document.querySelectorAll(
        'a[href],button,[role="button"],input:not([type="hidden"]),textarea,select,summary,' +
        '[contenteditable="true"],[role="textbox"],[role="listitem"],.dcg-expressionitem'
      )).filter(visible);
      const folded = want.toLowerCase();
      el =
        options.find((node) => labelFor(node).toLowerCase() === folded) ||
        options.find((node) => labelFor(node).toLowerCase().includes(folded));
    }
    if (!el) return { ok: false, error: "Nothing on the page matched " + want };
    el.scrollIntoView({ block: "center", inline: "center" });
    if (typeof el.focus === "function") el.focus();
    const rect = el.getBoundingClientRect();
    const x = rect.left + Math.min(120, Math.max(8, rect.width / 2));
    const y = rect.top + Math.min(25, Math.max(8, rect.height / 2));
    const base = {
      bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y,
      button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true,
    };
    for (const type of ["pointerover", "pointerenter", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      const Ctor = type.indexOf("pointer") === 0 ? PointerEvent : MouseEvent;
      el.dispatchEvent(new Ctor(type, { ...base, buttons: type.endsWith("down") ? 1 : 0 }));
    }
    return { ok: true, detail: labelFor(el) || el.tagName.toLowerCase() };
  `);
  if (result?.ok) {
    await sleep(450);
    return true;
  }
  return false;
}

export async function agentClickRef(index: number): Promise<boolean> {
  if (activeEngine() === "chrome") {
    try {
      await chromeCommand("act", { action: "click", index });
      return true;
    } catch {
      return false;
    }
  }
  const result = await runInPage<{ ok: boolean }>(`
    const el = document.querySelector('[data-lantas-ref="${Math.max(0, Math.floor(index))}"]');
    if (!el) return { ok: false };
    el.scrollIntoView({ block: "center", inline: "center" });
    if (typeof el.focus === "function") el.focus();
    const rect = el.getBoundingClientRect();
    const x = rect.left + Math.min(120, Math.max(8, rect.width / 2));
    const y = rect.top + Math.min(25, Math.max(8, rect.height / 2));
    const base = {
      bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y,
      button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true,
    };
    for (const type of ["pointerover", "pointerenter", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      const Ctor = type.indexOf("pointer") === 0 ? PointerEvent : MouseEvent;
      el.dispatchEvent(new Ctor(type, { ...base, buttons: type.endsWith("down") ? 1 : 0 }));
    }
    return { ok: true };
  `);
  if (result?.ok) {
    await sleep(450);
    return true;
  }
  return false;
}

export async function agentType(
  text: string,
  selector?: string,
  submit = false,
): Promise<boolean> {
  if (activeEngine() === "chrome") {
    try {
      await chromeCommand("act", { action: "type", text, selector, submit });
      return true;
    } catch {
      return false;
    }
  }

  const result = await runInPage<{ ok: boolean; detail?: string; error?: string }>(`
    const text = ${JSON.stringify(text)};
    const wanted = ${JSON.stringify(selector ?? "")};
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return false;
      const style = getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden";
    };
    let el = wanted ? document.querySelector(wanted) : document.activeElement;
    if (!el || el === document.body) {
      el = Array.from(document.querySelectorAll(
        'input:not([type="hidden"]), textarea, [contenteditable="true"], [contenteditable=""]'
      )).find(visible) || null;
    }
    if (!el) return { ok: false, error: "No editable field was focused. Click the field first." };

    el.scrollIntoView({ block: "center", inline: "center" });
    if (typeof el.focus === "function") el.focus();

    // Desmos draws its equation editor on a canvas and drives MathQuill from a
    // hidden textarea. Synthetic key events do not reach it reliably, but the
    // page exposes the same graph API the calculator itself uses. This keeps
    // the action real and verifiable: set the expression, then read it back.
    const calc = window.Calc;
    const desmosRow = el.closest ? el.closest(".dcg-expressionitem") : null;
    const onDesmos = location.hostname.indexOf("desmos.") >= 0;
    if (
      onDesmos &&
      calc &&
      typeof calc.setExpression === "function" &&
      (desmosRow || (el.tagName === "TEXTAREA" && Boolean(document.querySelector(".dcg-expressionitem.dcg-selected"))))
    ) {
      try {
        const first = typeof calc.getExpressions === "function" ? calc.getExpressions()[0] : null;
        const id = (desmosRow && desmosRow.getAttribute("expr-id")) || calc.selectedExpressionId || (first && first.id) || "1";
        calc.setExpression({ id: String(id), latex: text });
        const stored = typeof calc.getExpressions === "function"
          ? calc.getExpressions().some((item) => item.id === String(id) && item.latex === text)
          : false;
        return { ok: stored, detail: "Desmos expression " + id };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    }

    if (el.isContentEditable) {
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(el);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      let inserted = false;
      try { inserted = document.execCommand("insertText", false, text); } catch (_) {}
      if (!inserted) {
        el.textContent = text;
        el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
      }
    } else if (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.tagName === "SELECT") {
      const proto =
        el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype :
        el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, text); else el.value = text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      el.textContent = text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
    }

    if (${submit ? "true" : "false"}) {
      for (const type of ["keydown", "keypress", "keyup"]) {
        el.dispatchEvent(new KeyboardEvent(type, {
          key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true,
        }));
      }
      const form = el.form || el.closest("form");
      if (form && typeof form.requestSubmit === "function") form.requestSubmit();
    }
    return { ok: true, detail: text.slice(0, 120) };
  `);
  if (result?.ok) {
    await sleep(400);
    return true;
  }
  return false;
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
  const result = await runInPage<{ ok: boolean }>(`
    const key = ${JSON.stringify(key)};
    const el = document.activeElement || document.body;
    if (!el) return { ok: false };
    for (const type of ["keydown", "keypress", "keyup"]) {
      el.dispatchEvent(new KeyboardEvent(type, {
        key, code: key, bubbles: true, cancelable: true,
        keyCode: key === "Enter" ? 13 : undefined,
        which: key === "Enter" ? 13 : undefined,
      }));
    }
    if (key === "Enter" && el.form && typeof el.form.requestSubmit === "function") {
      el.form.requestSubmit();
    }
    return { ok: true };
  `);
  if (result?.ok) {
    await sleep(350);
    return true;
  }
  return false;
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
  const result = await runInPage<{ ok: boolean }>(`
    window.scrollBy({ top: ${Number(pixels) || 600}, behavior: "smooth" });
    return { ok: true };
  `);
  return Boolean(result?.ok);
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

  // BrowserView owns the address bar, tab title, history and the native
  // webview. Even when the user is in chat, it can create the child webview
  // off-screen so the agent can work before "Open browser" is pressed.
  window.dispatchEvent(new CustomEvent("lantas:navigate", { detail: { url } }));
  await sleep(500);
  await elNavigate(url);
  const landed = await waitForNativePage(url, 16);
  return Boolean(landed?.page?.url);
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
  await sleep(600);
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
  await sleep(800);
  return true;
}

export async function agentPage(): Promise<ElPage | null> {
  if (activeEngine() !== "chrome") {
    const read = await readNative();
    return read?.page ?? getElContext();
  }
  try {
    const result = await chromeCommand("read");
    return asElPage(result.page ?? null);
  } catch {
    return null;
  }
}

/** Page text plus the numbered interactive elements the engine can see. */
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

  const read = await readNative();
  return {
    engine,
    page: read?.page ?? null,
    elements: read?.elements ?? [],
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
}

export async function agentOpenChrome(url: string, newTab = false): Promise<boolean> {
  try {
    await chromeCommand("navigate", { url, newTab });
    return true;
  } catch {
    return false;
  }
}

/**
 * Makes sure a native page exists even while the Browser tab is not on screen.
 * The child webview is kept alive at one pixel off-screen; this is what lets
 * the chat drive a real page while a mini live view sits above the composer.
 */
export async function ensureNativeBrowserPage(url: string): Promise<boolean> {
  if (!inTauri()) return false;
  window.dispatchEvent(new CustomEvent("lantas:navigate", { detail: { url } }));
  await sleep(550);
  await elNavigate(url);
  await elVisible(false);
  const read = await waitForNativePage(url, 18);
  return Boolean(read?.page?.url);
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
