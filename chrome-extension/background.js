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
const VERSION = "0.3.0";

let socket = null;
let retry = 0;
let retryTimer = null;
let heartbeat = null;
let state = { tabs: [], active: null, page: null, elements: [] };
let stateTimer = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  if (!value) throw new Error("No address was given.");
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(value)) return `https://${value}`;
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
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
        if (message.newTab) {
          const created = await chrome.tabs.create({ url, active: true });
          if (created.windowId != null) {
            await chrome.windows.update(created.windowId, { focused: true });
          }
        } else {
          await chrome.tabs.update(tab.id, { url, active: true });
          if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
        }
        await sleep(500);
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
        const result = await sendToTab(tab.id, {
          cmd: "act",
          action: message.action,
          selector: message.selector,
          text: message.text,
          index: message.index,
          dy: message.dy,
          submit: message.submit,
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

      case "chat": {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          throw new Error("Open Lantas on this Mac to chat with it.");
        }
        const tab = await targetTab();
        let page = null;
        if (tab && isWebTab(tab)) {
          try {
            const snapshot = await sendToTab(tab.id, { cmd: "inspect" });
            page = snapshot?.page || null;
          } catch {
            page = null;
          }
        }
        const id = `chat_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
        send({ type: "chat", id, text: String(message.text || ""), page });
        return { ok: true, id };
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
