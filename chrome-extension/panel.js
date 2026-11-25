/**
 * Lantas side panel.
 *
 * The panel holds one thread per browser session. A turn is sent to the
 * service worker, which snapshots the tab and relays it to the app over the
 * loopback socket. The app answers with chat_status frames while it works and
 * one chat_reply frame with the final text plus a note about what it touched.
 */

const STORE = "lantasPanel.v1";

const els = {
  dot: document.getElementById("dot"),
  statusText: document.getElementById("status-text"),
  ctxMark: document.getElementById("ctx-mark"),
  ctxTitle: document.getElementById("ctx-title"),
  ctxUrl: document.getElementById("ctx-url"),
  ctxState: document.getElementById("ctx-state"),
  thread: document.getElementById("thread"),
  empty: document.getElementById("empty"),
  emptyCopy: document.getElementById("empty-copy"),
  emptyPage: document.getElementById("empty-page"),
  agentsSpace: document.getElementById("agents-space"),
  messages: document.getElementById("messages"),
  form: document.getElementById("form"),
  input: document.getElementById("input"),
  send: document.getElementById("send"),
  refreshPage: document.getElementById("refresh-page"),
  newChat: document.getElementById("new-chat"),
  modeButton: document.getElementById("mode-button"),
  modeLabel: document.getElementById("mode-label"),
  modeDot: document.getElementById("mode-dot"),
  modeMenu: document.getElementById("mode-menu"),
  modelButton: document.getElementById("model-button"),
  modelLabel: document.getElementById("model-label"),
  modelMenu: document.getElementById("model-menu"),
  modelList: document.getElementById("model-list"),
  modelFilter: document.getElementById("model-filter"),
  modelManage: document.getElementById("model-manage"),
  footNote: document.getElementById("foot-note"),
  extId: document.getElementById("ext-id"),
};

const FALLBACK_CATALOG = [
  {
    id: "anthropic",
    name: "Anthropic",
    models: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"],
    configured: false,
  },
  { id: "openai", name: "OpenAI", models: ["gpt-5.1", "gpt-5.1-mini", "gpt-4.1"], configured: false },
  {
    id: "openrouter",
    name: "OpenRouter",
    models: ["anthropic/claude-opus-4.5", "openai/gpt-5.1", "qwen/qwen3-coder"],
    configured: false,
  },
  { id: "groq", name: "Groq", models: ["llama-3.3-70b-versatile", "qwen-3-32b"], configured: false },
  {
    id: "google",
    name: "Google",
    models: ["gemini-3.8-flash", "gemini-4-argon", "gemini-2.5-pro"],
    configured: false,
  },
  {
    id: "nvidia",
    name: "NVIDIA NIM",
    models: ["minimaxai/minimax-m3.1-flash", "moonshotai/kimi-k3.1-pro"],
    configured: false,
  },
  {
    id: "ollama",
    name: "Ollama",
    models: ["qwen3-coder:30b", "llama3.3:latest"],
    configured: true,
  },
];

let online = false;
let pendingId = null;
let pending = false;
let statusNote = "";
let messages = [];
let catalog = FALLBACK_CATALOG;
let pick = { provider: "", model: "", mode: "act" };

function prettyModel(model) {
  const value = String(model || "").split("/").pop() || "";
  const claude = /^claude-(opus|sonnet|haiku)-(\d+)-(\d+)$/i.exec(value);
  if (claude) {
    const family = claude[1][0].toUpperCase() + claude[1].slice(1).toLowerCase();
    return `${family} ${claude[2]}.${claude[3]}`;
  }
  return value
    .replace(/^gpt-/i, "GPT-")
    .replace(/^gemini-/i, "Gemini ")
    .replace(/:latest$/i, "")
    .slice(0, 42);
}

function allModels() {
  const rows = [];
  for (const provider of catalog) {
    for (const model of provider.models || []) {
      rows.push({ provider: provider.id, providerName: provider.name, model, configured: provider.configured !== false });
    }
  }
  return rows;
}

function currentModel() {
  return allModels().find((row) => row.provider === pick.provider && row.model === pick.model) || null;
}

function ensurePick() {
  const rows = allModels();
  if (!rows.length) return;
  const found = currentModel();
  if (found) return;
  const preferred = rows.find((row) => row.configured) || rows[0];
  pick.provider = preferred.provider;
  pick.model = preferred.model;
}

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
    return `${parsed.hostname.replace(/^www\./, "")}${path}`.slice(0, 96);
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------ render */

function renderMessages() {
  els.empty.hidden = messages.length > 0 || pending;
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
    if (statusNote) {
      const note = document.createElement("div");
      note.className = "msg-body";
      note.textContent = statusNote;
      row.appendChild(note);
    }
    const typing = document.createElement("span");
    typing.className = "typing";
    typing.innerHTML = "<span></span><span></span><span></span>";
    row.appendChild(typing);
    els.messages.appendChild(row);
  }

  els.thread.scrollTop = els.thread.scrollHeight;
}

function renderPicks() {
  ensurePick();
  const mode = pick.mode === "ask" ? "Ask" : "Act";
  els.modeLabel.textContent = mode;
  els.modeDot.classList.toggle("is-act", pick.mode === "act");
  els.footNote.textContent =
    pick.mode === "act"
      ? "Replies can be wrong. Check before acting."
      : "Ask mode · reads this tab, changes nothing";

  const row = currentModel();
  els.modelLabel.textContent = row ? prettyModel(row.model) : "Choose a model";
  els.modelButton.title = row ? `${row.providerName} · ${row.model}` : "Choose a model";

  for (const button of els.modeMenu.querySelectorAll("[data-mode]")) {
    button.classList.toggle("is-active", button.dataset.mode === pick.mode);
  }

  renderModelList();
}

function renderModelList() {
  const query = els.modelFilter.value.trim().toLowerCase();
  els.modelList.replaceChildren();
  let shown = 0;

  for (const provider of catalog) {
    const models = (provider.models || []).filter((model) =>
      query
        ? `${provider.name} ${model}`.toLowerCase().includes(query)
        : true,
    );
    if (!models.length) continue;

    const group = document.createElement("div");
    group.className = "model-group";
    group.textContent = provider.configured === false ? `${provider.name} · not connected` : provider.name;
    els.modelList.appendChild(group);

    for (const model of models) {
      shown += 1;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "model-row";
      button.setAttribute("role", "option");
      const active = provider.id === pick.provider && model === pick.model;
      button.setAttribute("aria-selected", String(active));
      if (active) button.classList.add("is-active");
      if (provider.configured === false) button.classList.add("is-off");

      const label = document.createElement("span");
      label.className = "menu-name";
      label.textContent = prettyModel(model);
      button.appendChild(label);

      if (active) {
        const check = document.createElement("span");
        check.className = "check";
        check.textContent = "✓";
        button.appendChild(check);
      }

      button.addEventListener("click", () => {
        pick.provider = provider.id;
        pick.model = model;
        persist();
        closeMenus();
        renderPicks();
      });
      els.modelList.appendChild(button);
    }
  }

  if (!shown) {
    const empty = document.createElement("p");
    empty.className = "model-empty";
    empty.textContent = query
      ? "No model matches that filter."
      : "No models yet. Add a provider in Lantas → Settings → Providers.";
    els.modelList.appendChild(empty);
  }
}

/* --------------------------------------------------------------- persistence */

function persist() {
  chrome.storage.local
    .set({
      [STORE]: { messages: messages.slice(-80), pick },
      lantasDrive: pick.mode === "act",
    })
    .catch(() => {});
}

async function load() {
  const stored = await chrome.storage.local.get({ [STORE]: null, lantasCatalog: null, lantasDrive: true });
  const saved = stored[STORE];
  if (saved && Array.isArray(saved.messages)) messages = saved.messages;
  if (saved && saved.pick) {
    pick = {
      provider: String(saved.pick.provider || ""),
      model: String(saved.pick.model || ""),
      mode: saved.pick.mode === "ask" ? "ask" : "act",
    };
  } else {
    pick.mode = stored.lantasDrive === false ? "ask" : "act";
  }
  if (Array.isArray(stored.lantasCatalog) && stored.lantasCatalog.length) {
    catalog = stored.lantasCatalog;
  }
  ensurePick();
  renderPicks();
  renderMessages();
}

/* -------------------------------------------------------------------- state */

function syncSend() {
  els.send.disabled = !online || pending || !els.input.value.trim();
}

function resize() {
  els.input.style.height = "auto";
  els.input.style.height = `${Math.min(132, els.input.scrollHeight)}px`;
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
  els.statusText.textContent = online ? "Connected" : "Offline";
  els.emptyCopy.textContent = online
    ? "Lantas reads this tab and can act in it. Work stays in the agents group."
    : "Open the Lantas app on this Mac to chat and to let the agent act.";

  const active = status?.active || null;
  if (els.emptyPage) {
    const title = String(active?.title || "").replace(/\s+/g, " ").trim();
    els.emptyPage.textContent = title
      ? title.length > 44
        ? `${title.slice(0, 44)}…`
        : title
      : "this page";
  }
  els.ctxMark.textContent = active?.url ? (hostOf(active.url)[0] || "·").toUpperCase() : "·";
  els.ctxTitle.textContent = active?.title || "No page open";
  els.ctxUrl.textContent = active?.url ? shortUrl(active.url) : "Open a site, then ask about it";
  els.ctxState.textContent = active?.url ? "Live" : "";

  syncSend();
}

/* --------------------------------------------------------------------- chat */

async function submit() {
  const text = els.input.value.trim();
  if (!text || pending) return;
  if (!online) {
    messages.push({ role: "note", text: "Open Lantas on this Mac to chat." });
    renderMessages();
    return;
  }

  els.input.value = "";
  resize();
  messages.push({ role: "user", text });
  pending = true;
  statusNote = "";
  renderMessages();
  syncSend();
  persist();

  try {
    const response = await chrome.runtime.sendMessage({
      cmd: "chat",
      text,
      mode: pick.mode,
      provider: pick.provider,
      model: pick.model,
    });
    if (!response?.ok) {
      pending = false;
      renderMessages();
      messages.push({ role: "note", text: response?.error || "Lantas did not answer." });
      renderMessages();
      persist();
      syncSend();
      return;
    }
    pendingId = response.id;
  } catch (error) {
    pending = false;
    renderMessages();
    messages.push({ role: "note", text: String(error?.message || error) });
    renderMessages();
    persist();
    syncSend();
  }
}

function closeMenus() {
  els.modeMenu.hidden = true;
  els.modelMenu.hidden = true;
  els.modeButton.setAttribute("aria-expanded", "false");
  els.modelButton.setAttribute("aria-expanded", "false");
}

function toggleMenu(menu, button) {
  const open = menu.hidden;
  closeMenus();
  menu.hidden = !open;
  button.setAttribute("aria-expanded", String(open));
  if (open && menu === els.modelMenu) {
    els.modelFilter.value = "";
    renderModelList();
    requestAnimationFrame(() => els.modelFilter.focus());
  }
}

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  void submit();
});

els.agentsSpace?.addEventListener("click", async () => {
  try {
    const result = await chrome.runtime.sendMessage({ cmd: "agents" });
    if (!result?.ok) {
      messages.push({
        role: "note",
        text: result?.error || "Chrome would not open the agents group. Try again from a website tab.",
      });
      renderMessages();
      persist();
    }
  } catch (error) {
    messages.push({ role: "note", text: String(error?.message || error) });
    renderMessages();
    persist();
  }
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

els.modeButton.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleMenu(els.modeMenu, els.modeButton);
});

els.modelButton.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleMenu(els.modelMenu, els.modelButton);
});

els.modeMenu.addEventListener("click", (event) => {
  const button = event.target.closest("[data-mode]");
  if (!button) return;
  pick.mode = button.dataset.mode === "ask" ? "ask" : "act";
  persist();
  closeMenus();
  renderPicks();
  syncSend();
});

els.modelFilter.addEventListener("input", renderModelList);

els.modelManage.addEventListener("click", () => {
  closeMenus();
  messages.push({
    role: "note",
    text: "Open Lantas → Settings → Providers to connect a provider, then reopen this panel.",
  });
  renderMessages();
  persist();
});

document.addEventListener("click", (event) => {
  if (els.modeMenu.contains(event.target) || els.modelMenu.contains(event.target)) return;
  closeMenus();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenus();
});

els.refreshPage.addEventListener("click", async () => {
  els.refreshPage.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ cmd: "read" });
    if (!result?.ok) throw new Error(result?.error || "Could not read this page.");
    messages.push({
      role: "note",
      text: `Read ${result.page.words.toLocaleString()} words · ${result.elements.length} controls`,
    });
    renderMessages();
    persist();
  } catch (error) {
    messages.push({ role: "note", text: String(error?.message || error) });
    renderMessages();
    persist();
  } finally {
    els.refreshPage.disabled = false;
  }
});

els.newChat.addEventListener("click", () => {
  messages = [];
  pending = false;
  pendingId = null;
  statusNote = "";
  persist();
  renderMessages();
  syncSend();
  els.input.focus();
});

els.extId.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(chrome.runtime.id);
    els.extId.textContent = "Copied";
    setTimeout(() => {
      els.extId.textContent = "Extension ID";
    }, 1200);
  } catch {
    /* selection still works */
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message) return;

  if (message.type === "catalog") {
    if (Array.isArray(message.catalog) && message.catalog.length) {
      catalog = message.catalog;
      ensurePick();
      renderPicks();
    }
    return;
  }

  if (message.type !== "chat_reply" && message.type !== "chat_status") return;
  if (!pendingId || message.chatId !== pendingId) return;

  if (message.type === "chat_status") {
    statusNote = String(message.text || "");
    renderMessages();
    return;
  }

  pending = false;
  pendingId = null;
  statusNote = "";
  if (message.note) messages.push({ role: "note", text: message.note });
  messages.push({ role: "assistant", text: message.text || "No answer." });
  persist();
  renderMessages();
  syncSend();
  setTimeout(() => void refresh(), 600);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.lantasCatalog?.newValue?.length) {
    catalog = changes.lantasCatalog.newValue;
    ensurePick();
    renderPicks();
  }
});

void load().then(() => {
  void refresh();
  els.input.focus();
  chrome.runtime.sendMessage({ cmd: "catalog_request" }).catch(() => {});
});
setInterval(() => void refresh(), 2000);
