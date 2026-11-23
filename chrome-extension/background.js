/**
 * Lantas Browser Bridge — service worker.
 *
 * Connects to the Lantas desktop app on 127.0.0.1:47654 and forwards commands
 * (navigate, read, click, type, scroll, back/forward, reload) to the Chrome tab
 * the user is looking at. Nothing leaves this machine.
 */

const PORT = 47654;
const ENDPOINT = `ws://127.0.0.1:${PORT}/lantas`;
const VERSION = "0.1.0";

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
    void handle(message);
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

async function pushState() {
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

chrome.tabs.onUpdated.addListener(() => void pushState());
chrome.tabs.onActivated.addListener(() => void pushState());
chrome.tabs.onRemoved.addListener(() => void pushState());
chrome.windows.onFocusChanged.addListener(() => void pushState());

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
    throw new Error("You paused Lantas in the Chrome extension popup.");
  }
}

async function handle(message) {
  if (!message || typeof message.type !== "string") return;
  const id = message.id;
  const reply = (payload) => send({ id, type: "result", ...payload });

  try {
    switch (message.type) {
      case "hello":
      case "ping": {
        reply({ ok: true, detail: "pong", version: VERSION });
        return;
      }

      case "tabs": {
        const snapshot = await collectState();
        state = { ...state, ...snapshot };
        send({ type: "state", ...snapshot });
        reply({ ok: true, ...snapshot });
        return;
      }

      case "activate": {
        const tab = await targetTab(message.tabId);
        if (!tab) throw new Error("That Chrome tab is gone.");
        await chrome.tabs.update(tab.id, { active: true });
        if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
        const snapshot = await collectState();
        state = { ...state, ...snapshot };
        send({ type: "state", ...snapshot });
        reply({ ok: true, detail: `Focused ${tab.title || tab.url}` });
        return;
      }

      case "close": {
        const tab = await targetTab(message.tabId);
        if (!tab) throw new Error("That Chrome tab is gone.");
        await chrome.tabs.remove(tab.id);
        reply({ ok: true, detail: "Tab closed" });
        return;
      }

      case "focus": {
        const tab = await targetTab();
        if (tab?.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
        reply({ ok: true });
        return;
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
        reply({ ok: true, detail: `Opened ${url}` });
        await sleep(500);
        await pushState();
        return;
      }

      case "history": {
        const tab = await targetTab(message.tabId);
        if (!tab) throw new Error("No Chrome tab is available.");
        if (message.direction === "forward") await chrome.tabs.goForward(tab.id);
        else await chrome.tabs.goBack(tab.id);
        reply({ ok: true, detail: message.direction === "forward" ? "Went forward" : "Went back" });
        await sleep(500);
        await pushState();
        return;
      }

      case "reload": {
        const tab = await targetTab(message.tabId);
        if (!tab) throw new Error("No Chrome tab is available.");
        await chrome.tabs.reload(tab.id);
        reply({ ok: true, detail: "Reloaded" });
        await sleep(600);
        await pushState();
        return;
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
        reply({ ok: true, page: result.page, elements: result.elements, detail: `Read ${result.page.title}` });
        return;
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
        reply({
          ok: true,
          detail: result.detail || "Done",
          page: result.page,
          elements: result.elements,
        });
        return;
      }

      default: {
        reply({ ok: false, error: `Unknown command: ${message.type}` });
      }
    }
  } catch (error) {
    reply({ ok: false, error: String(error?.message || error) });
  }
}

/* -------------------------------------------------------------- Popup support */

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (!message || message.cmd !== "status") return undefined;
  respond({
    connected: Boolean(socket && socket.readyState === WebSocket.OPEN),
    port: PORT,
    version: VERSION,
    active: state.active,
    tabs: state.tabs.length,
  });
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get({ lantasDrive: true }).catch(() => {});
  chrome.alarms.create("lantas-keepalive", { periodInMinutes: 0.5 });
  connect();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("lantas-keepalive", { periodInMinutes: 0.5 });
  connect();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "lantas-keepalive") return;
  if (!socket) connect();
  else send({ type: "ping" });
});

chrome.alarms.create("lantas-keepalive", { periodInMinutes: 0.5 });
connect();
