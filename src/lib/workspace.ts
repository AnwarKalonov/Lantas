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
    await fs.writeTextFile(`${root}/${target.join("/")}`, text);
    return true;
  }
  if (!rootHandle) return false;
  let dir = rootHandle;
  const parts = path.split("/").filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) return false;
  for (const part of parts) dir = await dir.getDirectoryHandle(part);
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
  const text = files.filter((file) => !file.binary);
  return {
    files: files.length,
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
