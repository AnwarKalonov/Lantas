/**
 * Lantas side panel — chat with the app, in the tab you are looking at.
 *
 * The panel talks to the service worker, which relays over the local socket to
 * the Lantas app. Answers come back as chat_reply frames with an optional note
 * about an action Lantas performed in this tab.
 */

const els = {
  dot: document.getElementById("dot"),
  statusText: document.getElementById("status-text"),
  tabMark: document.getElementById("tab-mark"),
  tabTitle: document.getElementById("tab-title"),
  tabUrl: document.getElementById("tab-url"),
  thread: document.getElementById("thread"),
  empty: document.getElementById("empty"),
  messages: document.getElementById("messages"),
  form: document.getElementById("form"),
  input: document.getElementById("input"),
  send: document.getElementById("send"),
  read: document.getElementById("read"),
  drive: document.getElementById("drive"),
  version: document.getElementById("version"),
  extId: document.getElementById("ext-id"),
  copyId: document.getElementById("copy-id"),
};

let online = false;
let pendingId = null;
let pending = false;
let messages = [];

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function shortUrl(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.hostname.replace(/^www\./, "")}${path}`.slice(0, 90);
  } catch {
    return "";
  }
}

function addMessage(role, text) {
  if (!text) return;
  messages.push({ role, text });
  render();
}

function render() {
  els.empty.hidden = messages.length > 0;
  els.messages.replaceChildren();

  for (const message of messages) {
    const row = document.createElement("div");
    row.className = `msg ${message.role}`;

    if (message.role !== "note") {
      const role = document.createElement("span");
      role.className = "msg-role";
      role.textContent = message.role === "user" ? "You" : "Lantas";
      row.appendChild(role);
    }

    const body = document.createElement("div");
    body.className = "msg-body";
    body.textContent = message.text;
    row.appendChild(body);
    els.messages.appendChild(row);
  }

  if (pending) {
    const row = document.createElement("div");
    row.className = "msg assistant";
    const role = document.createElement("span");
    role.className = "msg-role";
    role.textContent = "Lantas";
    row.appendChild(role);
    const typing = document.createElement("span");
    typing.className = "typing";
    typing.innerHTML = "<span></span><span></span><span></span>";
    row.appendChild(typing);
    els.messages.appendChild(row);
  }

  els.thread.scrollTop = els.thread.scrollHeight;
}

function syncSend() {
  els.send.disabled = !online || pending || !els.input.value.trim();
}

function resize() {
  els.input.style.height = "auto";
  els.input.style.height = `${Math.min(120, els.input.scrollHeight)}px`;
}

async function refresh() {
  let status = null;
  try {
    status = await chrome.runtime.sendMessage({ cmd: "status" });
  } catch {
    status = null;
  }

  online = Boolean(status?.lantas);
  els.dot.classList.toggle("is-on", online);
  els.statusText.textContent = online ? "Connected to Lantas" : "Lantas is closed";
  els.empty.querySelector(".empty-copy").textContent = online
    ? "Lantas reads this tab and can act in it."
    : "Open the Lantas app on this Mac to chat and to let the agent act.";

  const active = status?.active || null;
  els.tabMark.textContent = active?.url ? (hostOf(active.url)[0] || "·").toUpperCase() : "·";
  els.tabTitle.textContent = active?.title || "No website open";
  els.tabUrl.textContent = active?.url
    ? shortUrl(active.url)
    : "Open a page to give the agent context";
  els.version.textContent = status?.version ? `v${status.version}` : "Chrome";

  syncSend();
}

async function submit() {
  const text = els.input.value.trim();
  if (!text || pending) return;
  if (!online) {
    addMessage("note", "Open Lantas on this Mac to chat.");
    return;
  }

  els.input.value = "";
  resize();
  messages.push({ role: "user", text });
  pending = true;
  render();
  syncSend();

  try {
    const response = await chrome.runtime.sendMessage({ cmd: "chat", text });
    if (!response?.ok) {
      pending = false;
      render();
      addMessage("note", response?.error || "Lantas did not answer.");
      syncSend();
      return;
    }
    pendingId = response.id;
  } catch (error) {
    pending = false;
    render();
    addMessage("note", String(error?.message || error));
    syncSend();
  }
}

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  void submit();
});

els.input.addEventListener("input", () => {
  resize();
  syncSend();
});

els.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void submit();
  }
});

els.empty.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    els.input.value = button.dataset.prompt || "";
    resize();
    syncSend();
    void submit();
  });
});

els.read.addEventListener("click", async () => {
  els.read.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ cmd: "read" });
    if (!result?.ok) throw new Error(result?.error || "Could not read this page.");
    addMessage(
      "note",
      `Read ${result.page.words.toLocaleString()} words · ${result.elements.length} controls`,
    );
  } catch (error) {
    addMessage("note", String(error?.message || error));
  } finally {
    els.read.disabled = false;
  }
});

els.drive.addEventListener("change", () => {
  chrome.storage.local.set({ lantasDrive: els.drive.checked }).catch(() => {});
});

els.extId.textContent = chrome.runtime.id;
els.copyId.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(chrome.runtime.id);
    els.copyId.textContent = "Copied";
    setTimeout(() => {
      els.copyId.textContent = "Copy";
    }, 1200);
  } catch {
    /* selection still works */
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || (message.type !== "chat_reply" && message.type !== "chat_status")) return;
  if (!pendingId || message.chatId !== pendingId) return;

  if (message.type === "chat_status") {
    render();
    return;
  }

  pending = false;
  pendingId = null;
  if (message.note) messages.push({ role: "note", text: message.note });
  messages.push({ role: "assistant", text: message.text || "No answer." });
  render();
  syncSend();
  setTimeout(() => void refresh(), 900);
});

chrome.storage.local.get({ lantasDrive: true }).then((stored) => {
  els.drive.checked = Boolean(stored.lantasDrive);
});

void refresh();
setInterval(() => void refresh(), 2000);
render();
