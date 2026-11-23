const dot = document.getElementById("dot");
const statusTitle = document.getElementById("status-title");
const statusDetail = document.getElementById("status-detail");
const tabTitle = document.getElementById("tab-title");
const tabUrl = document.getElementById("tab-url");
const drive = document.getElementById("drive");
const readButton = document.getElementById("read");
const result = document.getElementById("result");
const version = document.getElementById("version");

function setResult(text, error = false) {
  result.textContent = text;
  result.classList.toggle("is-error", error);
}

async function renderStatus() {
  let status = null;
  try {
    status = await chrome.runtime.sendMessage({ cmd: "status" });
  } catch {
    status = null;
  }

  const connected = Boolean(status?.connected);
  dot.classList.toggle("is-on", connected);
  statusTitle.textContent = connected ? "Connected to Lantas" : "Waiting for Lantas";
  statusDetail.textContent = connected
    ? `${status.tabs || 0} Chrome tabs · port ${status.port}`
    : `Open the Lantas app, then Lantas listens on 127.0.0.1:${status?.port || 47654}`;
  version.textContent = `Chrome extension ${status?.version || "0.1.0"}`;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const web = /^https?:/i.test(tab?.url || "");
  tabTitle.textContent = tab?.title || (web ? "" : "No website open");
  tabUrl.textContent = web ? tab.url : "Open a website to let Lantas read it.";
  readButton.disabled = !web;
}

async function loadToggle() {
  const stored = await chrome.storage.local.get({ lantasDrive: true });
  drive.checked = Boolean(stored.lantasDrive);
}

drive.addEventListener("change", async () => {
  await chrome.storage.local.set({ lantasDrive: drive.checked });
  setResult(drive.checked ? "Lantas can drive Chrome." : "Paused. Lantas cannot act in Chrome.");
});

readButton.addEventListener("click", async () => {
  readButton.disabled = true;
  setResult("Reading…");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No tab to read.");
    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { cmd: "inspect" });
    } catch {
      // Tabs opened before the extension was installed have no content script yet.
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      response = await chrome.tabs.sendMessage(tab.id, { cmd: "inspect" });
    }
    if (!response?.ok) throw new Error(response?.error || "Could not read this page.");
    setResult(`${response.page.words.toLocaleString()} words · ${response.elements.length} controls found`);
  } catch (error) {
    setResult(String(error?.message || error), true);
  } finally {
    readButton.disabled = false;
  }
});

void loadToggle();
void renderStatus();
setInterval(renderStatus, 1500);
