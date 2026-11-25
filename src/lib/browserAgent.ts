import {
  browserEngine,
  chromeCommand,
  type BrowserEngine,
  type ChromeElement,
  type ChromeEvent,
  type ChromePage,
  type ChromeTab,
} from "./chrome";
import { getElContext, loadEl, setElContext, type ElPage } from "./el";
import {
  checkedStateScript,
  clickAtScript,
  clickRefScript,
  clickScript,
  evaluateScript,
  hoverScript,
  pointerScript,
  pressScript,
  scrollScript,
  selectScript,
  snapshotScript,
  toggleScript,
  typeScript,
} from "./pageScripts";
import {
  elClick,
  elHistory,
  elNavigate,
  elOpen,
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

function isRealHostname(host: string): boolean {
  return (
    host === "localhost" ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) ||
    /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(host)
  );
}

export type BrowserAddress = { ok: true; url: string } | { ok: false; error: string };

/**
 * Validates the address the model chose. It deliberately does not know site
 * names, infer a route from the task, repair typos, or fall back to a search:
 * those are decisions for the model. A rejected value is returned as a tool
 * error so the model can choose the real page on its next step.
 */
export function parseBrowserAddress(raw: string): BrowserAddress {
  const original = String(raw ?? "")
    .trim()
    .replace(/^[`"']+|[`"']+$/g, "")
    .trim();

  if (!original) {
    return { ok: false, error: "No address was given. Choose the exact page and call navigate with a full https:// URL." };
  }

  try {
    if (/^https?:\/\//i.test(original)) {
      const url = new URL(original);
      if (url.hostname && isRealHostname(url.hostname)) return { ok: true, url: url.href };
    } else if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/\S*)?$/i.test(original)) {
      return { ok: true, url: `https://${original}` };
    } else if (/^localhost(?::\d+)?(?:\/\S*)?$/i.test(original)) {
      return { ok: true, url: `http://${original}` };
    }
  } catch {
    /* fall through to the error below */
  }

  return {
    ok: false,
    error: `“${original}” is not a web address. Decide the real site yourself and call navigate with its domain (for example example.com) or a full https:// URL; never send the user's sentence to a search engine.`,
  };
}

/**
 * The short browser manual shared by the coding agent and the Chrome panel.
 * It teaches a workflow, not a hidden shortcut: named apps get their real
 * front door, canvas editors get one deliberate click and keystroke at a time,
 * and every step is checked against the page that comes back.
 */
export const BROWSER_GUIDE = [
  "Browser playbook (follow this instead of guessing):",
  "- Work in one step at a time: navigate, then snapshot the live page, then click/type using the controls you actually see. When you already know the sequence, send up to 12 of those actions at once with `browser {\"action\":\"steps\",\"steps\":[...]}`; it runs them in order and returns one fresh snapshot.",
  "- \"Open X\", \"go to X\" and \"take me to X\" mean X's real home page. Decide the address and navigate straight there (https://github.com, https://www.youtube.com, https://notion.so). Never route an open request through a search engine, and never replace it with a query, unless the user actually said search.",
  "- A bare domain is a valid address: `github.com` becomes https://github.com. Only ask for a full URL when the value is not a domain at all.",
  "- You choose every destination. The app does not know product names, infer a route, repair an address or search for you. Send a complete `https://` URL. If you only have a name, decide the real site yourself; if you only have a page name inside a site, open the site and click its visible control.",
  "- After every action, read the returned URL, title and controls. Use a ref or an exact label from that result; never invent coordinates or selectors. A ref stays tied to its element while it is on the page: if it no longer exists the click fails instead of hitting whatever moved into that slot. A click or fill proves only that action; verify the user-visible outcome once.",
  "- Tabs are part of the task: `tabs` lists them, `switch_tab` targets one by id or index, `new_tab` opens one and `close_tab` closes one. Prefer the id; after switching, snapshot the new page before acting.",
  "- Confirm before irreversible actions: submitting a payment, deleting data, changing account settings or closing something the user may need. Respect a denial instead of finding another way to do the same thing.",
  "- If the task names a page inside a site (for example a calculator, a settings page or a specific tool), open the site, snapshot, then click the matching navigation control. Do not stop after the homepage.",
  "- Canvas and math editors often ignore a value assignment. Click into the editor first, then type or press keys. If the page exposes a documented API, `evaluate` may call it, but read the expression back to verify it. A calculator's expression row usually already holds `y=` or the solver prompt, so type only the part that is missing, then submit with the site's own button or Enter.",
  "- `click_at` and `evaluate` exist for canvas apps and site APIs. Use them only for the user's task, not to read private storage or change unrelated settings.",
  "- If a page does not open, try its canonical address once (github.com, then https://www.github.com). If you need a search, navigate to the search URL yourself. Do not repeat an identical failing call.",
  "- Page snapshots pierce open shadow roots and same-origin iframes. If a control is still missing, evaluate `(() => document.querySelector('my-app')?.shadowRoot?.querySelector('button')?.outerHTML)()` to inspect it; never guess a selector.",
  "- Login walls: use browser {\"action\":\"open_in_chrome\",\"url\":...} so the user signs in in their own Chrome profile, then switch to the Chrome engine and read the authenticated page.",
  "- Form snapshots include a `Forms:` line with field names. Use the numbered refs for the fields and the submit button instead of blind Enter presses.",
  "- If a tool result says it did not work, inspect the page and try one different, supported action. Never claim success from a call you have not seen succeed.",
].join("\n");

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

let lastNativeReadAt = 0;

async function readNative(): Promise<NativeRead | null> {
  if (!inTauri()) return null;
  try {
    const result = await runInPage<NativeRead>(snapshotScript());
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

/**
 * Move the visible pointer to where the agent is working.
 *
 * Best effort on purpose: a page that blocks injected elements must never make
 * the action itself fail, so the result is ignored.
 */
function drawPointer(x: number, y: number, kind: "move" | "click" | "type" | "scroll") {
  if (activeEngine() === "chrome") return;
  void runInPage(pointerScript(x, y, kind)).catch(() => {});
}

async function pointerAt(fallback?: { x: number; y: number }) {
  if (fallback) return fallback;
  try {
    const box = await runInPage<{ x: number; y: number }>(
      "return { x: Math.round((window.innerWidth || 1200) / 2), y: Math.round((window.innerHeight || 800) / 2) };",
    );
    return box ?? { x: 600, y: 400 };
  } catch {
    return { x: 600, y: 400 };
  }
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

  const result = await runInPage<{ ok: boolean; error?: string; x?: number; y?: number }>(
    clickScript(target),
  );
  if (!result?.ok) return false;
  const point = await pointerAt(
    typeof result.x === "number" && typeof result.y === "number"
      ? { x: result.x, y: result.y }
      : undefined,
  );
  drawPointer(point.x, point.y, "click");
  await sleep(200);
  return true;
}

export async function agentClickRef(index: number | string): Promise<boolean> {
  if (activeEngine() === "chrome") {
    try {
      // The extension numbers its own controls; the native engine uses stable
      // string refs, which arrive here as numbers.
      const numeric = Number(String(index).replace(/^e/i, ""));
      await chromeCommand("act", {
        action: "click",
        index: Number.isFinite(numeric) ? numeric : index,
      });
      return true;
    } catch {
      return false;
    }
  }

  const result = await runInPage<{ ok: boolean; x?: number; y?: number }>(clickRefScript(index));
  if (!result?.ok) return false;
  const point = await pointerAt(
    typeof result.x === "number" && typeof result.y === "number"
      ? { x: result.x, y: result.y }
      : undefined,
  );
  drawPointer(point.x, point.y, "click");
  await sleep(200);
  return true;
}

export interface TypeResult {
  ok: boolean;
  error?: string;
  /** What the field actually contains afterwards, read back from the page. */
  value?: string;
}

/**
 * Type into the page and report *why* it failed.
 *
 * A bare boolean turned "the editor is focused but its model is empty" into
 * "no editable field was found", which sent the agent looking for another
 * field instead of clicking into the one in front of it. The page's own error
 * is more useful than a guess.
 */
export async function agentTypeResult(
  text: string,
  selector?: string,
  submit = false,
): Promise<TypeResult> {
  if (activeEngine() === "chrome") {
    try {
      await chromeCommand("act", { action: "type", text, selector, submit });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  const result = await runInPage<{ ok: boolean; error?: string; value?: string; x?: number; y?: number }>(
    typeScript(text, selector, submit),
  );
  if (!result?.ok) return { ok: false, error: result?.error };
  const point = await pointerAt(
    typeof result.x === "number" && typeof result.y === "number"
      ? { x: result.x, y: result.y }
      : undefined,
  );
  drawPointer(point.x, point.y, "type");
  // Some editors commit on the next frame; a snapshot taken immediately would
  // report the old page and make a good fill look ignored.
  await sleep(220);
  return { ok: true, value: result.value };
}

export async function agentType(
  text: string,
  selector?: string,
  submit = false,
): Promise<boolean> {
  return (await agentTypeResult(text, selector, submit)).ok;
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

  const result = await runInPage<{ ok: boolean; error?: string; x?: number; y?: number }>(
    pressScript(key),
  );
  if (!result?.ok) return false;
  if (typeof result.x === "number" && typeof result.y === "number" && result.x > 0) {
    drawPointer(result.x, result.y, "click");
  }
  await sleep(200);
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

  // The script scrolls the surface under the pointer and reports whether
  // anything actually moved, so "scrolled" never means "asked to scroll".
  const result = await runInPage<{ ok: boolean; moved?: number }>(scrollScript(pixels));
  if (result?.ok) {
    const point = await pointerAt();
    drawPointer(point.x, point.y, "scroll");
  }
  await sleep(180);
  return Boolean(result?.ok);
}

async function navigateNative(url: string): Promise<boolean> {
  const before = getElContext()?.url ?? "";

  // BrowserView owns the address bar, tab title, history and the native
  // webview. Even when the user is in chat, it can create the child webview
  // off-screen so the agent can work before "Open browser" is pressed. The
  // App-level listener also switches to the Browser tab when this starts from
  // Code mode, where BrowserView is not mounted.
  window.dispatchEvent(new CustomEvent("lantas:navigate", { detail: { url } }));
  await sleep(350);
  await elNavigate(url);

  let landed: NativeRead | null = null;
  for (let attempt = 0; attempt < 18; attempt += 1) {
    landed = await readNative();
    const current = landed?.page?.url ?? "";
    if (/^https?:/i.test(current) && (samePage(current, url) || current !== before)) break;
    await sleep(attempt < 4 ? 250 : 450);
  }

  // A code-mode turn has no mounted BrowserView to create the child webview.
  // Open it directly off-screen, then let the Browser tab adopt the same page.
  if (!landed?.page?.url || !/^https?:/i.test(landed.page.url)) {
    await elOpen(url, { x: -12000, y: -12000, width: 1280, height: 900 });
    await sleep(450);
    await elVisible(false);
    landed = await waitForNativePage(url, 20);
  }

  return Boolean(landed?.page?.url && /^https?:/i.test(landed.page.url));
}

/**
 * Poll the active page until it lands somewhere new. Chrome's navigate, form
 * submits and SPA route changes all finish at different times, so callers get
 * a real answer instead of a fire-and-forget acknowledgement.
 */
export async function waitForNavigation(
  target = "",
  timeoutMs = 10_000,
  from = "",
): Promise<boolean> {
  const previous = from || getElContext()?.url || "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(250);
    const page = await agentPage();
    if (!page?.url) continue;
    if (target && samePage(page.url, target)) return true;
    if (page.url !== previous) return true;
  }
  return false;
}

export async function agentNavigate(target: string): Promise<boolean> {
  if (activeEngine() === "chrome") {
    const before = getElContext()?.url ?? "";
    try {
      await chromeCommand("navigate", { url: target });
    } catch {
      return false;
    }
    if (before && samePage(before, target)) {
      await sleep(500);
      return true;
    }
    return waitForNavigation(target, 10_000, before);
  }
  return navigateNative(target);
}

export interface AgentTab {
  id: string;
  title: string;
  url: string;
  active: boolean;
}

/** The tabs the browser agent can target, for either engine. */
export async function agentTabs(): Promise<AgentTab[]> {
  if (activeEngine() === "chrome") {
    try {
      const result = await chromeCommand<ChromeEvent & { tabs?: ChromeTab[] }>("tabs");
      return (result.tabs ?? []).map((tab) => ({
        id: String(tab.id),
        title: tab.title || tab.url,
        url: tab.url,
        active: Boolean(tab.active),
      }));
    } catch {
      return [];
    }
  }
  const data = loadEl();
  return data.tabs.map((tab) => ({
    id: tab.id,
    title: tab.title || tab.url,
    url: tab.url,
    active: tab.id === data.active,
  }));
}

function resolveTab(tabs: AgentTab[], target?: string | number): AgentTab | null {
  if (!tabs.length) return null;
  if (target == null || target === "") return tabs.find((tab) => tab.active) ?? tabs[0];
  const value = String(target);
  const index = Number(value);
  if (Number.isInteger(index) && index >= 0 && index < tabs.length) return tabs[index];
  return tabs.find((tab) => tab.id === value) ?? null;
}

/** Native tabs live in BrowserView; the event keeps its title bar in sync. */
function sendNativeTab(action: "activate" | "new" | "close", detail: Record<string, string>) {
  if (!document.querySelector(".el")) return false;
  window.dispatchEvent(new CustomEvent("lantas:tab", { detail: { action, ...detail } }));
  return true;
}

/** Switch the page the agent is driving. */
export async function agentSwitchTab(target?: string | number): Promise<boolean> {
  const tab = resolveTab(await agentTabs(), target);
  if (!tab) return false;
  if (activeEngine() === "chrome") {
    try {
      await chromeCommand("activate", { tabId: Number(tab.id) });
      await sleep(500);
      return true;
    } catch {
      return false;
    }
  }
  if (!sendNativeTab("activate", { id: tab.id })) return false;
  await sleep(500);
  return true;
}

/** Open a tab in the active engine and make it the agent's target. */
export async function agentNewTab(url: string): Promise<boolean> {
  if (activeEngine() === "chrome") {
    try {
      await chromeCommand("navigate", { url, newTab: true });
      await sleep(600);
      return true;
    } catch {
      return false;
    }
  }
  if (sendNativeTab("new", { url })) {
    await sleep(600);
    return true;
  }
  // Code mode has no mounted BrowserView to own a tab strip, so open the page
  // in the child webview directly; the Browser tab adopts it when opened.
  return navigateNative(url);
}

/** Close a tab by id or current index. */
export async function agentCloseTab(target?: string | number): Promise<boolean> {
  const tabs = await agentTabs();
  // Closing the last tab can close the window or lose the page the user is
  // reading. Ask the model to leave one tab instead.
  if (tabs.length < 2) return false;
  const tab = resolveTab(tabs, target);
  if (!tab) return false;
  if (activeEngine() === "chrome") {
    try {
      await chromeCommand("close", { tabId: Number(tab.id) });
      await sleep(500);
      return true;
    } catch {
      return false;
    }
  }
  if (!sendNativeTab("close", { id: tab.id })) return false;
  await sleep(500);
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

/** Real mouse click at viewport coordinates, for canvas editors. */
export async function agentClickAt(x: number, y: number): Promise<boolean> {
  const px = Math.max(0, Math.round(Number(x) || 0));
  const py = Math.max(0, Math.round(Number(y) || 0));
  if (activeEngine() === "chrome") {
    try {
      await chromeCommand("act", { action: "click_at", x: px, y: py });
      return true;
    } catch {
      return false;
    }
  }

  const result = await runInPage<{ ok: boolean; error?: string }>(clickAtScript(px, py));
  if (!result?.ok) return false;
  drawPointer(px, py, "click");
  await sleep(250);
  return true;
}

/** Hover a visible control so menus and tooltips open. */
export async function agentHover(target: string): Promise<boolean> {
  if (activeEngine() === "chrome") {
    try {
      await chromeCommand("act", {
        action: "hover",
        text: looksLikeSelector(target) ? undefined : target,
        selector: looksLikeSelector(target) ? target : undefined,
      });
      return true;
    } catch {
      return false;
    }
  }

  const result = await runInPage<{ ok: boolean; error?: string; x?: number; y?: number }>(
    hoverScript(target),
  );
  if (!result?.ok) return false;
  const point = await pointerAt(
    typeof result.x === "number" && typeof result.y === "number"
      ? { x: result.x, y: result.y }
      : undefined,
  );
  drawPointer(point.x, point.y, "move");
  await sleep(250);
  return true;
}

/** Pick an option in a real select element by visible label or value. */
export async function agentSelect(target: string, value: string): Promise<boolean> {
  if (activeEngine() === "chrome") {
    try {
      await chromeCommand("act", {
        action: "select",
        text: looksLikeSelector(target) ? undefined : target,
        selector: looksLikeSelector(target) ? target : undefined,
        value,
      });
      return true;
    } catch {
      return false;
    }
  }

  const result = await runInPage<{ ok: boolean }>(selectScript(target, value));
  if (!result?.ok) return false;
  await sleep(200);
  return true;
}

/** Set a checkbox or radio control and verify its state. */
export async function agentCheck(target: string, checked = true): Promise<boolean> {
  // This action used to run against the native page whatever engine was
  // active, so checking a box in Chrome silently changed nothing.
  if (activeEngine() === "chrome") {
    try {
      await chromeCommand("act", {
        action: "check",
        text: looksLikeSelector(target) ? undefined : target,
        selector: looksLikeSelector(target) ? target : undefined,
        checked,
      });
      return true;
    } catch {
      return false;
    }
  }

  const result = await runInPage<{ ok: boolean; error?: string }>(toggleScript(target, checked));
  if (!result?.ok) return false;
  // React and other frameworks update aria-checked a tick after the click.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const state = await runInPage<{ ok: boolean; state?: boolean }>(checkedStateScript());
    if (state?.ok && state.state === checked) return true;
    await sleep(80);
  }
  return false;
}

/** Wait for text to appear or disappear, without guessing a selector. */
export async function agentWaitForText(
  text: string,
  timeoutMs = 8_000,
  gone = false,
): Promise<boolean> {
  const deadline = Date.now() + Math.min(30_000, Math.max(500, timeoutMs));
  while (Date.now() < deadline) {
    const page = await agentPage();
    const present = Boolean(page?.text && page.text.includes(text));
    if (gone ? !present : present) return true;
    await sleep(300);
  }
  return false;
}

/** Run page JavaScript (a site's own API or a verification read). */
export async function agentEvaluate(
  code: string,
): Promise<{ ok: boolean; value?: unknown; error?: string }> {
  if (activeEngine() === "chrome") {
    try {
      const result = await chromeCommand<ChromeEvent & { value?: unknown }>("evaluate", {
        code,
      });
      return { ok: result.ok !== false, value: result.value, error: result.error };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // Statements with a return are as valid as expressions here; the page
  // script picks the right wrapper instead of failing with a syntax error.
  const result = await runInPage<{ ok: boolean; value?: unknown; error?: string }>(
    evaluateScript(code),
  );
  return result ?? { ok: false, error: "The page did not answer." };
}

/**
 * Install one page-level MutationObserver and reset its counter. Native and
 * Chrome evaluate different shapes, so each gets a single executable IIFE.
 */
export async function resetDomObservation(): Promise<void> {
  const body =
    'window.__lantasMutations = 0;' +
    'if (!window.__lantasObserver) {' +
    ' window.__lantasObserver = new MutationObserver(function (list) {' +
    '  window.__lantasMutations = (window.__lantasMutations || 0) + list.length;' +
    ' });' +
    ' window.__lantasObserver.observe(document.documentElement, {' +
    '  childList: true, subtree: true, characterData: true, attributes: true' +
    ' });' +
    '}';
  await agentEvaluate(
    activeEngine() === "chrome"
      ? `(() => { ${body} return window.__lantasMutations; })()`
      : `${body} return window.__lantasMutations;`,
  );
}

/** Wait briefly for a DOM update; resolves as soon as one is observed. */
export async function waitForDomChange(timeoutMs = 2_500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(150);
    const result = await agentEvaluate(
      activeEngine() === "chrome"
        ? "(() => window.__lantasMutations || 0)()"
        : "return window.__lantasMutations || 0;",
    );
    if (result.ok && Number(result.value) > 0) return true;
  }
  return false;
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
          "click_at",
          "evaluate",
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

  if (!inTauri()) {
    // A browser tab renders a fetched, read-only copy of the page. There is no
    // live DOM to script, but the text it already read is still worth handing
    // back instead of claiming that nothing is open.
    return {
      engine,
      page: getElContext(),
      elements: [],
      supports: ["snapshot", "extract", "find", "navigate"],
    };
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
  return navigateNative(url);
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
    ? `\n\nInteractive elements (click with {"ref":N} from this list; a ref that has left the page fails):\n${snapshot.elements
        .slice(0, 120)
        .map((el) => `${el.i}. [${el.kind}] ${el.label}`)
        .join("\n")}`
    : "";
  return `${header}\n\nText:\n${page.text.slice(0, 16_000)}${elements}`;
}
