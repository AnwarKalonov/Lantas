/**
 * Lantas Browser Bridge — service worker.
 *
 * Two ways in, both local:
 *   1. Lantas desktop connects to 127.0.0.1:47654 over a WebSocket.
 *   2. Lantas running as a web page (Lantas.command / npm start) messages this
 *      worker directly through chrome.runtime.sendMessage.
 *
 * Either way the commands act on the Chrome tab the user is looking at, and
 * nothing leaves this machine.
 */

const PORT = 47654;
const ENDPOINT = `ws://127.0.0.1:${PORT}/lantas`;
const VERSION = "0.6.1";

let socket = null;
let retry = 0;
let retryTimer = null;
let heartbeat = null;
let state = { tabs: [], active: null, page: null, elements: [] };
let stateTimer = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* -------------------------------------------------------------- real input */

/**
 * DOM clicks are invisible to some canvas apps and easy for a site to tell
 * apart from a person. When Chrome grants the debugger permission, these
 * helpers send actual browser-level mouse and keyboard input through CDP.
 * The content script still finds the control; CDP only presses it.
 */
const debuggerTabs = new Set();

async function attachDebugger(tabId) {
  if (debuggerTabs.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    debuggerTabs.add(tabId);
  } catch (error) {
    // Already attached by this worker after a restart is harmless; DevTools
    // owning the tab is not, and the caller falls back to a DOM action.
    const message = String(error?.message || error);
    if (!/already attached/i.test(message)) throw error;
    debuggerTabs.add(tabId);
  }
}

async function cdp(tabId, method, params = {}) {
  await attachDebugger(tabId);
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

async function cdpClick(tabId, x, y) {
  const point = { x, y, button: "left", clickCount: 1 };
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", clickCount: 0 });
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", ...point, buttons: 1 });
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", ...point, buttons: 0 });
}

function keyInfo(key) {
  const map = {
    Enter: { code: "Enter", vk: 13 },
    Tab: { code: "Tab", vk: 9 },
    Escape: { code: "Escape", vk: 27 },
    Backspace: { code: "Backspace", vk: 8 },
    Delete: { code: "Delete", vk: 46 },
    ArrowUp: { code: "ArrowUp", vk: 38 },
    ArrowDown: { code: "ArrowDown", vk: 40 },
    ArrowLeft: { code: "ArrowLeft", vk: 37 },
    ArrowRight: { code: "ArrowRight", vk: 39 },
  };
  return map[key] || { code: key, vk: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0 };
}

function charInfo(ch) {
  if (/[a-z]/.test(ch)) {
    const upper = ch.toUpperCase();
    return { key: ch, code: `Key${upper}`, vk: upper.charCodeAt(0), modifiers: 0 };
  }
  if (/[A-Z]/.test(ch)) {
    return { key: ch, code: `Key${ch}`, vk: ch.charCodeAt(0), modifiers: 8 };
  }
  if (/[0-9]/.test(ch)) {
    return { key: ch, code: `Digit${ch}`, vk: ch.charCodeAt(0), modifiers: 0 };
  }
  const shifted = {
    "+": { code: "Equal", vk: 187 },
    "^": { code: "Digit6", vk: 54 },
    "(": { code: "Digit9", vk: 57 },
    ")": { code: "Digit0", vk: 48 },
    "*": { code: "Digit8", vk: 56 },
    "_": { code: "Minus", vk: 189 },
    "{": { code: "BracketLeft", vk: 219 },
    "}": { code: "BracketRight", vk: 221 },
    ":": { code: "Semicolon", vk: 186 },
  }[ch];
  if (shifted) return { key: ch, ...shifted, modifiers: 8 };
  const plain = {
    " ": { code: "Space", vk: 32 },
    "=": { code: "Equal", vk: 187 },
    "-": { code: "Minus", vk: 189 },
    "/": { code: "Slash", vk: 191 },
    ".": { code: "Period", vk: 190 },
    ",": { code: "Comma", vk: 188 },
    ";": { code: "Semicolon", vk: 186 },
    "[": { code: "BracketLeft", vk: 219 },
    "]": { code: "BracketRight", vk: 221 },
    "\\": { code: "Backslash", vk: 220 },
  }[ch];
  if (plain) return { key: ch, ...plain, modifiers: 0 };
  return { key: ch, code: "", vk: 0, modifiers: 0 };
}

async function cdpType(tabId, text) {
  for (const ch of String(text || "")) {
    const info = charInfo(ch);
    await cdp(tabId, "Input.dispatchKeyEvent", {
      type: "keyDown",
      key: info.key,
      code: info.code,
      text: ch,
      unmodifiedText: ch,
      windowsVirtualKeyCode: info.vk,
      nativeVirtualKeyCode: info.vk,
      modifiers: info.modifiers,
    });
    await cdp(tabId, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key: info.key,
      code: info.code,
      windowsVirtualKeyCode: info.vk,
      nativeVirtualKeyCode: info.vk,
      modifiers: info.modifiers,
    });
  }
}

async function cdpPress(tabId, key) {
  const { code, vk } = keyInfo(key);
  await cdp(tabId, "Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  });
  await cdp(tabId, "Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  });
}

async function waitForLoad(tabId, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") return;
    } catch {
      return;
    }
    await sleep(150);
  }
}

async function inspectTab(tabId) {
  try {
    const result = await sendToTab(tabId, { cmd: "inspect" });
    return result?.ok ? { page: result.page, elements: result.elements } : {};
  } catch {
    return {};
  }
}

/**
 * Returns null before anything happens when real input is unavailable, so the
 * caller can safely use the DOM fallback without clicking twice.
 */
async function realAct(tab, message) {
  const action = message.action;
  try {
    if (action === "click") {
      const point = await sendToTab(tab.id, {
        cmd: "act",
        action: "point",
        selector: message.selector,
        index: message.index,
        text: message.text,
      });
      if (!point?.ok) return null;
      await cdpClick(tab.id, point.x, point.y);
      await sleep(300);
      await waitForLoad(tab.id);
      const state = await inspectTab(tab.id);
      return { ok: true, detail: `Clicked ${point.label || "control"}`, ...state };
    }

    if (action === "type") {
      const focused = await sendToTab(tab.id, {
        cmd: "act",
        action: "focus",
        selector: message.selector,
        index: message.index,
        text: message.text,
      });
      if (!focused?.ok) return null;
      await attachDebugger(tab.id);
      await cdpType(tab.id, String(message.text ?? ""));
      if (message.submit) await cdpPress(tab.id, "Enter");
      await sleep(300);
      await waitForLoad(tab.id);
      const state = await inspectTab(tab.id);

      return { ok: true, detail: "Typed with the keyboard", ...state };
    }

    if (action === "press") {
      await cdpPress(tab.id, String(message.key || "Enter"));
      await sleep(250);
      const state = await inspectTab(tab.id);
      return { ok: true, detail: `Pressed ${message.key || "Enter"}`, ...state };
    }

    if (action === "click_at") {
      await cdpClick(tab.id, Number(message.x) || 0, Number(message.y) || 0);
      await sleep(300);
      const state = await inspectTab(tab.id);
      return { ok: true, detail: `Clicked at ${message.x}, ${message.y}`, ...state };
    }
  } catch {
    return null;
  }
  return null;
}

chrome.debugger?.onDetach.addListener((source) => {
  if (source.tabId != null) debuggerTabs.delete(source.tabId);
});

function send(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  try {
    socket.send(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

function schedule() {
  if (retryTimer) return;
  retry = Math.min(retry + 1, 10);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connect();
  }, retry * 400 + 300);
}

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  try {
    socket = new WebSocket(ENDPOINT);
  } catch {
    socket = null;
    schedule();
    return;
  }

  socket.onopen = () => {
    retry = 0;
    send({ type: "hello", version: VERSION, browser: browserName() });
    void pushState();
    clearInterval(heartbeat);
    // Traffic keeps the service worker alive while Lantas is open.
    heartbeat = setInterval(() => send({ type: "ping" }), 20_000);
  };

  socket.onmessage = (event) => {
    let message = null;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    void forward(message);
  };

  socket.onclose = () => {
    clearInterval(heartbeat);
    heartbeat = null;
    socket = null;
    schedule();
  };

  socket.onerror = () => {
    try {
      socket?.close();
    } catch {
      /* already closing */
    }
  };
}

function browserName() {
  const agent = navigator.userAgent;
  if (agent.includes("Edg/")) return "Edge";
  if (agent.includes("Brave")) return "Brave";
  if (agent.includes("OPR/")) return "Opera";
  return "Chrome";
}

/* ---------------------------------------------------------------- Chrome state */

function tabSummary(tab) {
  return {
    id: tab.id,
    title: tab.title || "",
    url: tab.url || "",
    active: Boolean(tab.active),
    windowId: tab.windowId,
  };
}

function isWebTab(tab) {
  return /^https?:/i.test(tab?.url || "");
}

function pushState() {
  if (stateTimer) return;
  stateTimer = setTimeout(() => {
    stateTimer = null;
    void collectState().then((snapshot) => {
      state = { ...state, ...snapshot };
      send({ type: "state", ...snapshot });
    });
  }, 250);
}

async function collectState() {
  const tabs = await chrome.tabs.query({});
  const list = tabs
    .filter((tab) => isWebTab(tab) || !String(tab.url || "").startsWith("chrome-extension://"))
    .map(tabSummary);
  const active = list.find((tab) => tab.active) || list[0] || null;
  return { tabs: list, active };
}

chrome.tabs.onUpdated.addListener(() => pushState());
chrome.tabs.onActivated.addListener(() => pushState());
chrome.tabs.onRemoved.addListener(() => pushState());
chrome.windows.onFocusChanged.addListener(() => pushState());

/* ------------------------------------------------------------------- Commands */

async function targetTab(tabId) {
  if (typeof tabId === "number") {
    try {
      return await chrome.tabs.get(tabId);
    } catch {
      return null;
    }
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab) return tab;
  const [fallback] = await chrome.tabs.query({ active: true });
  return fallback || null;
}

function normalizeUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) throw new Error("No address was given. The model must send a complete https:// URL.");
  if (/\s/.test(value)) {
    throw new Error(`"${value}" is not a web address. The model must choose the exact page and send a complete https:// URL.`);
  }
  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      if (parsed.hostname) return parsed.href;
    } catch {
      /* handled below */
    }
  }
  if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/\S*)?$/i.test(value)) {
    return `https://${value}`;
  }
  if (/^localhost(?::\d+)?(?:\/\S*)?$/i.test(value)) return `http://${value}`;
  throw new Error(
    `"${value}" is not a full web address. The app will not guess a site or search for it; the model must send an exact https:// URL.`,
  );
}

async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return await chrome.tabs.sendMessage(tabId, message);
  }
}

async function actOnTab(tab) {
  if (!isWebTab(tab)) {
    throw new Error("Chrome is on a browser page, not a website. Open a site first.");
  }
  const stored = await chrome.storage.local.get({ lantasDrive: true });
  if (!stored.lantasDrive) {
    throw new Error("You paused Lantas in the Chrome side panel.");
  }
}

/**
 * One command in, one plain result out. The WebSocket path wraps this in a
 * result frame; the web-page path returns it to the caller directly.
 */
async function execute(message) {
  if (!message || typeof message.type !== "string") {
    return { ok: false, error: "No command was given." };
  }

  try {
    switch (message.type) {
      case "hello":
      case "ping": {
        return { ok: true, detail: "pong", version: VERSION };
      }

      case "status": {
        const snapshot = await collectState();
        state = { ...state, ...snapshot };
        return {
          ok: true,
          connected: true,
          version: VERSION,
          ...snapshot,
          page: state.page,
          elements: state.elements,
        };
      }

      case "tabs": {
        const snapshot = await collectState();
        state = { ...state, ...snapshot };
        send({ type: "state", ...snapshot });
        return { ok: true, ...snapshot };
      }

      case "activate": {
        const tab = await targetTab(message.tabId);
        if (!tab) throw new Error("That Chrome tab is gone.");
        await chrome.tabs.update(tab.id, { active: true });
        if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
        const snapshot = await collectState();
        state = { ...state, ...snapshot };
        send({ type: "state", ...snapshot });
        return { ok: true, detail: `Focused ${tab.title || tab.url}` };
      }

      case "close": {
        const tab = await targetTab(message.tabId);
        if (!tab) throw new Error("That Chrome tab is gone.");
        await chrome.tabs.remove(tab.id);
        return { ok: true, detail: "Tab closed" };
      }

      case "focus": {
        const tab = await targetTab();
        if (tab?.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
        return { ok: true };
      }

      case "navigate": {
        const tab = await targetTab(message.tabId);
        if (!tab) throw new Error("No Chrome tab is available. Open Chrome first.");
        const url = normalizeUrl(message.url);
        let targetId = tab.id;
        if (message.newTab) {
          const created = await chrome.tabs.create({ url, active: true });
          targetId = created.id;
          if (created.windowId != null) {
            await chrome.windows.update(created.windowId, { focused: true });
          }
        } else {
          await chrome.tabs.update(tab.id, { url, active: true });
          if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
        }
        await sleep(250);
        if (targetId != null) await waitForLoad(targetId, 4500);
        pushState();
        return { ok: true, detail: `Opened ${url}` };
      }

      case "history": {
        const tab = await targetTab(message.tabId);
        if (!tab) throw new Error("No Chrome tab is available.");
        if (message.direction === "forward") await chrome.tabs.goForward(tab.id);
        else await chrome.tabs.goBack(tab.id);
        await sleep(500);
        pushState();
        return { ok: true, detail: message.direction === "forward" ? "Went forward" : "Went back" };
      }

      case "reload": {
        const tab = await targetTab(message.tabId);
        if (!tab) throw new Error("No Chrome tab is available.");
        await chrome.tabs.reload(tab.id);
        await sleep(600);
        pushState();
        return { ok: true, detail: "Reloaded" };
      }

      case "read": {
        const tab = await targetTab(message.tabId);
        if (!tab) throw new Error("No Chrome tab is available.");
        if (!isWebTab(tab)) {
          throw new Error("Open a website in Chrome first — browser pages cannot be read.");
        }
        const result = await sendToTab(tab.id, { cmd: "inspect" });
        if (!result?.ok) throw new Error(result?.error || "Chrome could not read that page.");
        const active = tabSummary(tab);
        state = { ...state, active, page: result.page, elements: result.elements };
        send({ type: "state", active, page: result.page, elements: result.elements });
        return {
          ok: true,
          page: result.page,
          elements: result.elements,
          detail: `Read ${result.page.title}`,
        };
      }

      case "act": {
        const tab = await targetTab(message.tabId);
        if (!tab) throw new Error("No Chrome tab is available.");
        await actOnTab(tab);

        const real = await realAct(tab, message);
        if (real) {
          const active = tabSummary(tab);
          state = {
            ...state,
            active,
            page: real.page || state.page,
            elements: real.elements || state.elements,
          };
          send({
            type: "state",
            active,
            page: real.page || state.page,
            elements: real.elements || state.elements,
          });
          return real;
        }

        const result = await sendToTab(tab.id, {
          cmd: "act",
          action: message.action,
          selector: message.selector,
          text: message.text,
          index: message.index,
          dy: message.dy,
          submit: message.submit,
          key: message.key,
          value: message.value,
          x: message.x,
          y: message.y,
        });
        if (!result?.ok) throw new Error(result?.error || "That action did not land.");
        if (result.page || result.elements) {
          state = {
            ...state,
            active: tabSummary(tab),
            page: result.page || state.page,
            elements: result.elements || state.elements,
          };
          send({
            type: "state",
            active: tabSummary(tab),
            page: result.page || state.page,
            elements: result.elements || state.elements,
          });
        }
        return {
          ok: true,
          detail: result.detail || "Done",
          page: result.page,
          elements: result.elements,
        };
      }

      case "evaluate": {
        const tab = await targetTab(message.tabId);
        if (!tab) throw new Error("No Chrome tab is available.");
        await actOnTab(tab);
        const expression = String(message.code || "").trim();
        if (!expression) throw new Error("No page script was given.");
        try {
          const result = await cdp(tab.id, "Runtime.evaluate", {
            expression,
            awaitPromise: true,
            returnByValue: true,
            userGesture: true,
          });
          if (result?.exceptionDetails) {
            return {
              ok: false,
              error: result.exceptionDetails.text || "The page script threw an error.",
            };
          }
          return { ok: true, value: result?.result?.value ?? null, detail: "Ran page script" };
        } catch (error) {
          throw new Error(
            `Chrome did not allow real input: ${String(error?.message || error)}. Reload the extension and try again.`,
          );
        }
      }

      case "chat": {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          throw new Error("Open Lantas on this Mac to chat with it.");
        }
        const tab = await targetTab();
        let page = null;
        let elements = [];
        if (tab && isWebTab(tab)) {
          try {
            const snapshot = await sendToTab(tab.id, { cmd: "inspect" });
            page = snapshot?.page || null;
            elements = snapshot?.elements || [];
          } catch {
            page = null;
          }
        }
        const id = `chat_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
        send({
          type: "chat",
          id,
          text: String(message.text || ""),
          mode: message.mode === "ask" ? "ask" : "act",
          provider: String(message.provider || ""),
          model: String(message.model || ""),
          page,
          elements,
        });
        return { ok: true, id };
      }

      case "catalog": {
        const catalog = Array.isArray(message.catalog) ? message.catalog.slice(0, 40) : [];
        if (!catalog.length) return { ok: false, error: "No models were offered." };
        await chrome.storage.local.set({ lantasCatalog: catalog });
        chrome.runtime.sendMessage({ type: "catalog", catalog }).catch(() => {});
        return { ok: true, detail: `${catalog.length} providers` };
      }

      case "catalog_request": {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          return { ok: false, error: "Lantas is closed." };
        }
        send({ type: "catalog_request" });
        return { ok: true };
      }

      default:
        return { ok: false, error: `Unknown command: ${message.type}` };
    }
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

async function forward(message) {
  if (!message || typeof message.type !== "string") return;
  // Answers from the Lantas app go to the side panel, not through execute().
  if (message.type === "chat_reply" || message.type === "chat_status") {
    chrome.runtime.sendMessage(message).catch(() => {});
    return;
  }
  const result = await execute(message);
  send({ id: message.id, type: "result", ...result });
}

/* ------------------------------------------------------------------- Transports */

chrome.runtime.onMessageExternal.addListener((message, _sender, respond) => {
  if (!message || typeof message.type !== "string") return undefined;
  void (async () => respond(await execute(message)))();
  return true;
});

// The side panel talks in `cmd`; execute() takes the same value as `type`.
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (!message || typeof message.cmd !== "string") return undefined;

  if (message.cmd === "status") {
    const open = Boolean(socket && socket.readyState === WebSocket.OPEN);
    respond({
      connected: true,
      lantas: open,
      port: PORT,
      version: VERSION,
      active: state.active,
      tabs: state.tabs.length,
      socket: open,
    });
    return true;
  }

  void (async () => respond(await execute({ ...message, type: message.cmd })))();
  return true;
});

// Clicking the toolbar button opens the chat panel instead of a popup.
function openPanelOnClick() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get({ lantasDrive: true }).catch(() => {});
  chrome.alarms.create("lantas-keepalive", { periodInMinutes: 0.5 });
  openPanelOnClick();
  connect();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("lantas-keepalive", { periodInMinutes: 0.5 });
  openPanelOnClick();
  connect();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "lantas-keepalive") return;
  if (!socket) connect();
  else send({ type: "ping" });
});

chrome.alarms.create("lantas-keepalive", { periodInMinutes: 0.5 });
openPanelOnClick();
connect();
