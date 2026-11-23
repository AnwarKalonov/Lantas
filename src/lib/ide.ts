import type { WorkspaceFile } from "./types";

export interface TreeNode {
  name: string;
  path: string;
  dir: boolean;
  children: TreeNode[];
}

/** Builds the explorer tree from the flat workspace listing. */
export function buildTree(files: WorkspaceFile[]): TreeNode[] {
  const root: TreeNode[] = [];
  const dirs = new Map<string, TreeNode[]>();
  dirs.set("", root);

  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  for (const file of sorted) {
    const parts = file.path.split("/").filter(Boolean);
    let prefix = "";
    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index];
      const path = prefix ? `${prefix}/${name}` : name;
      const isFile = index === parts.length - 1;
      const parentKey = prefix;
      const siblings = dirs.get(parentKey) ?? root;
      if (!dirs.has(parentKey)) dirs.set(parentKey, siblings);

      if (isFile) {
        siblings.push({ name, path, dir: false, children: [] });
      } else {
        let node = siblings.find((item) => item.dir && item.name === name);
        if (!node) {
          node = { name, path, dir: true, children: [] };
          siblings.push(node);
        }
        dirs.set(path, node.children);
      }
      prefix = path;
    }
  }

  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.dir !== b.dir) return a.dir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((node) => sortNodes(node.children));
  };
  sortNodes(root);
  return root;
}

export function allDirPaths(nodes: TreeNode[], out: string[] = []): string[] {
  nodes.forEach((node) => {
    if (node.dir) {
      out.push(node.path);
      allDirPaths(node.children, out);
    }
  });
  return out;
}

export interface SearchHit {
  path: string;
  line: number;
  text: string;
}

export function searchWorkspace(
  files: WorkspaceFile[],
  query: string,
  limit = 120,
): SearchHit[] {
  const term = query.trim();
  if (term.length < 2) return [];
  let matcher: RegExp;
  try {
    matcher = new RegExp(term, "i");
  } catch {
    matcher = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }
  const hits: SearchHit[] = [];
  for (const file of files) {
    if (file.binary || !file.text) continue;
    const lines = file.text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (!matcher.test(lines[index])) continue;
      hits.push({
        path: file.path,
        line: index + 1,
        text: lines[index].trim().slice(0, 220),
      });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}

/** Ranked quick-open: exact basename first, then prefix, then path substring. */
export function quickOpen(files: WorkspaceFile[], query: string, limit = 30): WorkspaceFile[] {
  const term = query.trim().toLowerCase();
  if (!term) return files.slice(0, limit);
  const scored = files
    .map((file) => {
      const name = file.name.toLowerCase();
      const path = file.path.toLowerCase();
      let score = -1;
      if (name === term) score = 0;
      else if (name.startsWith(term)) score = 1;
      else if (name.includes(term)) score = 2;
      else if (path.includes(term)) score = 3;
      return { file, score };
    })
    .filter((item) => item.score >= 0)
    .sort((a, b) => a.score - b.score || a.file.path.localeCompare(b.file.path));
  return scored.slice(0, limit).map((item) => item.file);
}

const MONACO_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "less",
  html: "html",
  htm: "html",
  md: "markdown",
  mdx: "markdown",
  py: "python",
  rs: "rust",
  go: "go",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  ini: "ini",
  sql: "sql",
  rb: "ruby",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  xml: "xml",
  svg: "xml",
  graphql: "graphql",
  gql: "graphql",
  vue: "html",
  svelte: "html",
  dart: "dart",
  lua: "lua",
  r: "r",
};

export function monacoLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MONACO_LANGUAGE[ext] ?? "plaintext";
}

/** A quiet tint per language family, like an editor's file icon. */
export function fileTone(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx"].includes(ext)) return "var(--ide-blue)";
  if (["js", "jsx", "mjs", "cjs"].includes(ext)) return "var(--ide-yellow)";
  if (["json", "jsonc"].includes(ext)) return "var(--ide-yellow)";
  if (["css", "scss", "less", "sass"].includes(ext)) return "var(--ide-pink)";
  if (["html", "htm", "vue", "svelte"].includes(ext)) return "var(--ide-orange)";
  if (["md", "mdx"].includes(ext)) return "var(--ide-muted)";
  if (["rs"].includes(ext)) return "var(--ide-orange)";
  if (["py"].includes(ext)) return "var(--ide-blue)";
  if (["go"].includes(ext)) return "var(--ide-cyan)";
  if (["sh", "bash", "zsh"].includes(ext)) return "var(--ide-green)";
  if (["yml", "yaml", "toml"].includes(ext)) return "var(--ide-purple)";
  return "var(--ide-muted)";
}

export function fileInitials(path: string): string {
  const name = path.split("/").pop() ?? path;
  const ext = name.includes(".") ? name.split(".").pop() ?? "" : "";
  return (ext || name).slice(0, 2).toUpperCase();
}

export function countLines(text: string): number {
  return text ? text.split("\n").length : 0;
}
