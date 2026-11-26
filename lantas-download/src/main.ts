import "./style.css";

/**
 * The developer download page.
 *
 * One job: show the current build and hand it over. The build itself is
 * described by `public/build.json`, so publishing a new app means replacing
 * that file (and the artifact it points at), not touching this code.
 */

interface BuildInfo {
  label: string;
  /** True when this is a build of the working branch, not a public release. */
  dev: boolean;
  builtAt: string;
  url: string;
  size?: number;
  sha256?: string;
  /** Short, human lines: what changed in this build. */
  changes?: string[];
}

/**
 * Only a hash of the developer key is shipped. It cannot be turned back into
 * the key, and it keeps the phrase out of the bundle.
 *
 * This gates the page, not the artifact: a static page cannot enforce access
 * to a file it links to. If the download itself must be private, the host or
 * the storage behind it has to check the visitor (see README.md).
 */
const DEFAULT_KEY_HASH =
  "c9a9f7a6301b62173ab2d473a79c1e960d3632b5766fe0295f82da8d7fc8169f";
const KEY_HASH = (
  (import.meta.env.VITE_DEV_KEY_HASH as string | undefined) || DEFAULT_KEY_HASH
).toLowerCase();
const UNLOCK_KEY = "lantas.download.unlocked";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("The page shell is missing.");
// A non-null alias: the narrowing above does not reach the functions below.
const app: HTMLDivElement = root;

const escape = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const shell = (inner: string) =>
  `<main class="card">${inner}<p class="foot">Lantas developer download</p></main>`;

async function sha256(text: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("This browser cannot check the key over an insecure connection.");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderGate(message = "") {
  app.innerHTML = shell(`
    <h1>Developer download</h1>
    <p class="muted">Enter the developer key to open this page.</p>
    <form id="gate" autocomplete="off">
      <input id="key" type="password" placeholder="Developer key" aria-label="Developer key" autofocus required />
      <button type="submit">Open</button>
    </form>
    <p class="error" id="gate-error">${escape(message)}</p>
  `);

  const form = document.querySelector<HTMLFormElement>("#gate");
  const input = document.querySelector<HTMLInputElement>("#key");
  const error = document.querySelector<HTMLParagraphElement>("#gate-error");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!input || !error) return;
    const value = input.value.trim();
    if (!value) return;
    try {
      if ((await sha256(value)) === KEY_HASH) {
        localStorage.setItem(UNLOCK_KEY, KEY_HASH);
        void renderDownload();
        return;
      }
    } catch (failure) {
      error.textContent = failure instanceof Error ? failure.message : String(failure);
      return;
    }
    error.textContent = "That key is not correct.";
    input.select();
  });
}

async function renderDownload() {
  app.innerHTML = shell(`<p class="muted">Loading build…</p>`);

  let build: BuildInfo | null = null;
  let failure = "";
  try {
    // No cache: a replaced build.json must show up on the next load.
    const response = await fetch(`build.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`build.json returned ${response.status}`);
    build = (await response.json()) as BuildInfo;
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  if (!build) {
    app.innerHTML = shell(`
      <h1>No build found</h1>
      <p class="muted">The page could not read build.json.</p>
      <p class="error">${escape(failure)}</p>
      <button class="quiet" id="lock" type="button">Lock this page</button>
    `);
    document.querySelector("#lock")?.addEventListener("click", lock);
    return;
  }

  const size = formatSize(build.size);
  const meta = [
    build.dev ? "Development build" : "Public build",
    formatDate(build.builtAt),
    size,
  ]
    .filter(Boolean)
    .join(" · ");

  // Only a web address may become a download link.
  const safeUrl = /^https:\/\//i.test(build.url) ? build.url : "";
  const download = safeUrl
    ? `<a class="download" href="${escape(safeUrl)}" rel="noreferrer">Download for macOS</a>`
    : `<p class="error">build.json does not contain a valid https download URL.</p>`;

  const changes = (build.changes ?? []).filter((line) => line.trim());
  app.innerHTML = shell(`
    <h1>${escape(build.label)}</h1>
    <p class="meta">${escape(meta)}</p>
    ${build.dev ? "" : `<p class="notice">This is not a development build yet. Replace build.json when a new one is ready.</p>`}
    ${changes.length ? `<h2>What changed</h2><ul class="changes">${changes.map((line) => `<li>${escape(line)}</li>`).join("")}</ul>` : ""}
    ${download}
    ${build.sha256 ? `<p class="sha">SHA-256 <code>${escape(build.sha256)}</code></p>` : ""}
    <button class="quiet" id="lock" type="button">Lock this page</button>
  `);
  document.querySelector("#lock")?.addEventListener("click", lock);
}

function lock() {
  localStorage.removeItem(UNLOCK_KEY);
  renderGate();
}

async function start() {
  const fromUrl = new URL(location.href).searchParams.get("key");
  if (fromUrl) {
    try {
      if ((await sha256(fromUrl.trim())) === KEY_HASH) {
        localStorage.setItem(UNLOCK_KEY, KEY_HASH);
        // Keep the key out of the address bar once it has been used.
        const clean = new URL(location.href);
        clean.searchParams.delete("key");
        history.replaceState(null, "", clean.pathname + clean.search);
        void renderDownload();
        return;
      }
    } catch {
      // Fall through to the key form, which explains the real problem.
    }
  }

  if (localStorage.getItem(UNLOCK_KEY) === KEY_HASH) {
    void renderDownload();
    return;
  }
  renderGate(fromUrl ? "That key is not correct." : "");
}

void start();
