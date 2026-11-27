import type { WorkspaceFile } from "./types";

/**
 * Real workspace access.
 *
 * Desktop: Tauri's dialog + fs plugins read a folder the user picks.
 * Browser: the File System Access API reads the same kind of folder, with the
 * user's permission, straight from this tab. Nothing is uploaded anywhere.
 */

/** The picked folder, kept so the IDE can write a file back after an edit. */
let rootHandle: any = null;
let rootPath = "";
/** prefix -> absolute root for folders added next to the primary workspace. */
const EXTRA_ROOTS_KEY = "lantas.extra-roots.v1";
const extraRoots = new Map<string, string>();
let extraRootsLoaded = false;

function loadExtraRoots() {
  if (extraRootsLoaded) return;
  extraRootsLoaded = true;
  try {
    const raw = localStorage.getItem(EXTRA_ROOTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Array<[string, string]>) : [];
    for (const [prefix, root] of parsed) if (prefix && root) extraRoots.set(prefix, root);
  } catch {
    /* a malformed entry just means no extra folders this launch */
  }
}

function saveExtraRoots() {
  try {
    localStorage.setItem(EXTRA_ROOTS_KEY, JSON.stringify(Array.from(extraRoots.entries())));
  } catch {
    /* the workspace still works for this session */
  }
}

const MAX_FILES = 600;
const TEXT_LIMIT = 400_000;
const SKIP = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".logs",
  ".cache",
  ".venv",
  "__pycache__",
  ".turbo",
  "Library",
  "Pods",
]);

const TEXT_EXTENSIONS = /\.(txt|md|mdx|markdown|ts|tsx|js|jsx|mjs|cjs|json|jsonc|css|scss|sass|less|html|htm|svg|xml|yml|yaml|toml|ini|conf|env|sh|bash|zsh|fish|py|rb|go|rs|java|kt|kts|swift|c|h|cc|cpp|hpp|cs|php|sql|graphql|gql|prisma|vue|svelte|astro|lua|ex|exs|erl|hs|clj|scala|dart|r|jl|pl|proto|lock|gitignore|dockerfile|makefile)$/i;

export function isTextFile(name: string) {
  return TEXT_EXTENSIONS.test(name) || !name.includes(".");
}

export function fileKind(name: string): "text" | "image" | "other" {
  if (/\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i.test(name)) return "image";
  if (isTextFile(name)) return "text";
  return "other";
}

export function supportsFolderAccess() {
  return (
    typeof window !== "undefined" &&
    ("showDirectoryPicker" in window || "__TAURI_INTERNALS__" in window)
  );
}

function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export interface OpenedWorkspace {
  name: string;
  /** Absolute path in the desktop build; empty in a browser tab. */
  root: string;
  files: WorkspaceFile[];
}

/** Ask for a folder and return every text file inside it. */
export async function openWorkspaceFolder(): Promise<OpenedWorkspace | null> {
  if (isTauri()) return openWithTauri();
  return openWithFileSystemAccess();
}

async function openWithFileSystemAccess() {
  const picker = (window as unknown as {
    showDirectoryPicker?: (options?: { mode?: string }) => Promise<any>;
  }).showDirectoryPicker;
  if (!picker) {
    throw new Error(
      "This browser can't share a folder. In the desktop app the folder picker is native; here you can still drop files onto the Code tab.",
    );
  }

  const root = await picker({ mode: "readwrite" });
  rootHandle = root;
  rootPath = "";
  const files: WorkspaceFile[] = [];
  await walk(root, "", files);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { name: root.name, root: "", files };
}

async function walk(dir: any, prefix: string, out: WorkspaceFile[]) {
  for await (const entry of dir.values()) {
    if (out.length >= MAX_FILES) return;
    const name = String(entry.name);
    if (SKIP.has(name)) continue;
    const path = prefix ? `${prefix}/${name}` : name;

    if (entry.kind === "directory") {
      out.push({
        id: path,
        name,
        path,
        size: 0,
        added: 0,
        text: "",
        dir: true,
      });
      await walk(entry, path, out);
      continue;
    }

    try {
      const file = await entry.getFile();
      const kind = fileKind(name);
      out.push({
        id: path,
        name,
        path,
        size: file.size,
        added: 0,
        binary: kind !== "text",
        text: kind === "text" && file.size <= TEXT_LIMIT ? await file.text() : "",
      });
    } catch {
      /* a file can disappear or be locked mid-walk */
    }
  }
}

async function openWithTauri() {
  const dialog = await import("@tauri-apps/plugin-dialog");
  const fs = await import("@tauri-apps/plugin-fs");
  const dir = await dialog.open({ directory: true, multiple: false, title: "Open a project folder" });
  if (!dir || typeof dir !== "string") return null;

  const files: WorkspaceFile[] = [];
  const readDir = async (path: string, prefix: string) => {
    const entries = await fs.readDir(path);
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      if (SKIP.has(entry.name)) continue;
      const child = `${path}/${entry.name}`;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        files.push({
          id: relative,
          name: entry.name,
          path: relative,
          size: 0,
          added: 0,
          text: "",
          dir: true,
        });
        await readDir(child, relative);
        continue;
      }
      const kind = fileKind(entry.name);
      if (kind !== "text") {
        files.push({
          id: relative,
          name: entry.name,
          path: relative,
          size: 0,
          added: 0,
          text: "",
          binary: true,
        });
        continue;
      }
      const text = await fs.readTextFile(child).catch(() => "");
      files.push({
        id: relative,
        name: entry.name,
        path: relative,
        size: text.length,
        added: 0,
        text: text.length <= TEXT_LIMIT ? text : text.slice(0, TEXT_LIMIT),
      });
    }
  };

  await readDir(dir, "");
  files.sort((a, b) => a.path.localeCompare(b.path));
  rootPath = dir;
  rootHandle = null;
  return {
    name: dir.split("/").filter(Boolean).pop() ?? "Workspace",
    root: dir,
    files,
  };
}

/**
 * Add a second folder to the open workspace. Its files are prefixed with the
 * folder name (frontend/src/App.tsx), and the absolute root is remembered so
 * edits still go to the right folder on disk.
 */
export async function addWorkspaceFolder(
  existing: WorkspaceFile[] = [],
): Promise<OpenedWorkspace | null> {
  if (!isTauri()) {
    throw new Error("Adding a second folder needs the desktop app. Drop files here instead.");
  }
  loadExtraRoots();
  const dialog = await import("@tauri-apps/plugin-dialog");
  const dir = await dialog.open({
    directory: true,
    multiple: false,
    title: "Add a folder to this workspace",
  });
  if (!dir || typeof dir !== "string") return null;
  const loaded = await readWorkspaceAt(dir);
  if (!loaded) return null;

  const base = loaded.name.replace(/[^\w.-]+/g, "-") || "folder";
  const used = new Set(existing.map((file) => file.path.split("/")[0]));
  let prefix = base;
  let suffix = 2;
  while (used.has(prefix)) prefix = `${base}-${suffix++}`;
  extraRoots.set(prefix, dir);
  saveExtraRoots();

  return {
    name: loaded.name,
    root: dir,
    files: loaded.files.map((file) => ({
      ...file,
      id: `${prefix}/${file.path}`,
      path: `${prefix}/${file.path}`,
      root: dir,
      relative: file.path,
    })),
  };
}

/** Resolve a visible workspace path to the folder and relative path on disk. */
export function resolveWorkspaceTarget(
  primaryRoot: string,
  path: string,
): { root: string; relative: string } {
  loadExtraRoots();
  const [prefix, ...rest] = path.split("/");
  const extra = extraRoots.get(prefix);
  if (extra && rest.length) return { root: extra, relative: rest.join("/") };
  return { root: primaryRoot, relative: path };
}

/** Read a file back from disk for write verification. */
export async function readWorkspacePath(
  primaryRoot: string,
  path: string,
): Promise<string | null> {
  if (!isTauri()) return null;
  const target = resolveWorkspaceTarget(primaryRoot, path);
  if (!target.root) return null;
  try {
    const fs = await import("@tauri-apps/plugin-fs");
    return await fs.readTextFile(`${target.root}/${target.relative}`);
  } catch {
    return null;
  }
}

/** Write a file, respecting a folder that was added to the workspace. */
export async function writeWorkspacePath(
  primaryRoot: string,
  path: string,
  text: string,
): Promise<boolean> {
  const target = resolveWorkspaceTarget(primaryRoot, path);
  return writeWorkspaceFile(target.root, target.relative, text);
}

/**
 * Watch the open folder for edits made outside Lantas. The plugin reports
 * absolute paths; only text files inside the workspace are read and returned.
 */
export async function watchWorkspace(
  root: string,
  onChange: (path: string, text: string) => void,
  onRemove?: (path: string) => void,
): Promise<() => void> {
  if (!root || !isTauri()) return () => {};
  const fs = await import("@tauri-apps/plugin-fs");
  const unwatch = await fs.watch(
    root,
    (event) => {
      for (const changed of event.paths) {
        const normalized = changed.replace(/\\/g, "/");
        const prefix = `${root.replace(/\\/g, "/").replace(/\/$/, "")}/`;
        if (!normalized.startsWith(prefix)) continue;
        const relative = normalized.slice(prefix.length);
        if (!relative || relative.split("/").some((part) => SKIP.has(part))) continue;
        // A removed folder never reaches the text-read path, so check the
        // path itself first and let the store drop the folder and its children.
        void fs
          .exists(changed)
          .then(async (exists) => {
            if (!exists) {
              onRemove?.(relative);
              return;
            }
            if (!isTextFile(relative.split("/").pop() ?? relative)) return;
            const text = await fs.readTextFile(changed).catch(() => null);
            if (text !== null) onChange(relative, text);
          })
          .catch(() => undefined);
      }
    },
    { recursive: true, delayMs: 450 },
  );
  return unwatch;
}

/** Extra folders the user added, as prefix -> absolute root. */
export function clearExtraWorkspaceFolders(): void {
  loadExtraRoots();
  extraRoots.clear();
  saveExtraRoots();
}

export function extraWorkspaceFolders(): Array<{ prefix: string; root: string }> {
  loadExtraRoots();
  return Array.from(extraRoots.entries()).map(([prefix, root]) => ({ prefix, root }));
}

/** Re-read the primary folder plus every added folder. */
export async function readWorkspaceWithExtras(
  root: string,
): Promise<OpenedWorkspace | null> {
  const primary = await readWorkspaceAt(root);
  if (!primary) return null;
  const files = [...primary.files];
  for (const extra of extraWorkspaceFolders()) {
    const loaded = await readWorkspaceAt(extra.root);
    if (!loaded) continue;
    for (const file of loaded.files) {
      files.push({
        ...file,
        id: `${extra.prefix}/${file.path}`,
        path: `${extra.prefix}/${file.path}`,
        root: extra.root,
        relative: file.path,
      });
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { ...primary, files };
}

/** Watch every open folder, prefixing paths from added folders. */
export async function watchWorkspaceTree(
  primaryRoot: string,
  onChange: (path: string, text: string) => void,
  onRemove?: (path: string) => void,
): Promise<() => void> {
  if (!primaryRoot) return () => {};
  const stops: Array<() => void> = [];
  const primary = await watchWorkspace(primaryRoot, onChange, onRemove);
  stops.push(primary);
  for (const extra of extraWorkspaceFolders()) {
    const stop = await watchWorkspace(
      extra.root,
      (path, text) => onChange(`${extra.prefix}/${path}`, text),
      onRemove ? (path) => onRemove(`${extra.prefix}/${path}`) : undefined,
    );
    stops.push(stop);
  }
  return () => stops.forEach((stop) => stop());
}

/** Re-reads an already-picked desktop folder without opening another dialog. */
export async function readWorkspaceAt(root: string): Promise<OpenedWorkspace | null> {
  if (!root || !isTauri()) return null;
  const fs = await import("@tauri-apps/plugin-fs");
  const files: WorkspaceFile[] = [];
  const readDir = async (path: string, prefix: string) => {
    const entries = await fs.readDir(path);
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      if (SKIP.has(entry.name)) continue;
      const child = `${path}/${entry.name}`;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        files.push({ id: relative, name: entry.name, path: relative, size: 0, added: 0, text: "", dir: true });
        await readDir(child, relative);
        continue;
      }
      const kind = fileKind(entry.name);
      if (kind !== "text") {
        files.push({ id: relative, name: entry.name, path: relative, size: 0, added: 0, text: "", binary: true });
        continue;
      }
      const text = await fs.readTextFile(child).catch(() => "");
      files.push({
        id: relative,
        name: entry.name,
        path: relative,
        size: text.length,
        added: 0,
        text: text.length <= TEXT_LIMIT ? text : text.slice(0, TEXT_LIMIT),
      });
    }
  };
  await readDir(root, "");
  files.sort((a, b) => a.path.localeCompare(b.path));
  return {
    name: root.split("/").filter(Boolean).pop() ?? "Workspace",
    root,
    files,
  };
}

/** Creates a folder (and its parents) inside the open desktop workspace. */
export async function createWorkspaceFolder(root: string, path: string): Promise<boolean> {
  if (!root || !isTauri()) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("workspace_create_dir", { root, path });
  return true;
}

/** Creates a new text file, including any folders in its path. */
export async function createWorkspaceFile(root: string, path: string, text = ""): Promise<boolean> {
  if (!root || !isTauri()) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("workspace_create_file", { root, path, text });
  return true;
}

/** Renames one file or folder inside the open desktop workspace. */
export async function renameWorkspacePath(
  root: string,
  from: string,
  to: string,
): Promise<boolean> {
  if (!root || !isTauri()) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("workspace_rename", { root, from, to });
  return true;
}

/** Deletes one file or folder inside the open desktop workspace. */
export async function deleteWorkspacePath(root: string, path: string): Promise<boolean> {
  if (!root || !isTauri()) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("workspace_delete", { root, path });
  return true;
}

/**
 * Writes one text file back to the folder the user opened. Desktop uses the fs
 * plugin against the absolute root; a browser tab walks the retained directory
 * handle. Both require the user's original folder permission, and neither
 * leaves the machine.
 */
export async function writeWorkspaceFile(
  root: string,
  path: string,
  text: string,
): Promise<boolean> {
  if (root && isTauri()) {
    const fs = await import("@tauri-apps/plugin-fs");
    const target = path.split("/").filter(Boolean);
    // A model can create a file in folders the folder did not have yet. The fs
    // plugin writes one file and does not build the chain above it, so make the
    // parent folders first; without this a new nested file silently failed.
    if (target.length > 1) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("workspace_create_dir", {
        root,
        path: target.slice(0, -1).join("/"),
      });
    }
    await fs.writeTextFile(`${root}/${target.join("/")}`, text);
    return true;
  }
  if (!rootHandle) return false;
  let dir = rootHandle;
  const parts = path.split("/").filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) return false;
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
  const file = await dir.getFileHandle(fileName, { create: true });
  const writable = await file.createWritable();
  await writable.write(text);
  await writable.close();
  return true;
}

/** Whether the current session can write files back to disk. */
export function canWriteWorkspace(root: string): boolean {
  return Boolean(root) ? isTauri() : Boolean(rootHandle);
}

/**
 * Reads a page from the open tab for the browser tool. The webview bridge
 * returns text only; Chrome returns a full element snapshot separately.
 */
export function workspaceStats(files: WorkspaceFile[]) {
  const text = files.filter((file) => !file.dir && !file.binary);
  return {
    files: files.filter((file) => !file.dir).length,
    text: text.length,
    bytes: files.reduce((total, file) => total + (file.size || file.text.length), 0),
  };
}

/** Read user-dropped or picked files into workspace entries. */
export async function readLocalFiles(list: FileList | File[]): Promise<WorkspaceFile[]> {
  const files: WorkspaceFile[] = [];
  for (const file of Array.from(list)) {
    const kind = fileKind(file.name);
    const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    const path = relative && relative.length ? relative : file.name;
    files.push({
      id: `drop_${path}_${file.lastModified}`,
      name: file.name,
      path,
      size: file.size,
      added: 0,
      binary: kind !== "text",
      text: kind === "text" && file.size <= TEXT_LIMIT ? await file.text() : "",
    });
  }
  return files;
}

export function languageFor(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    css: "css",
    html: "html",
    md: "markdown",
    py: "python",
    rs: "rust",
    go: "go",
    sh: "shell",
    yml: "yaml",
    yaml: "yaml",
    toml: "toml",
    sql: "sql",
  };
  return map[ext] ?? ext.toUpperCase();
}
