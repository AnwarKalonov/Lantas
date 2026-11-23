import { inTauri } from "./native";
import type { EditorSettings } from "./types";

/** A VS Code extension on disk. Themes and snippets can carry over; code cannot. */
export interface VSCodeExtension {
  id: string;
  name: string;
  version: string;
  publisher: string;
  description: string;
  path: string;
  has_theme: boolean;
  has_snippets: boolean;
  has_language: boolean;
}

export interface VSCodeImport {
  found: boolean;
  settings_path: string;
  keybindings_path: string;
  settings: string;
  keybindings: string;
  extensions: VSCodeExtension[];
}

export async function readVSCode(): Promise<VSCodeImport> {
  if (!inTauri()) {
    return {
      found: false,
      settings_path: "",
      keybindings_path: "",
      settings: "",
      keybindings: "",
      extensions: [],
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const raw = await invoke<string>("vscode_import");
  return JSON.parse(raw) as VSCodeImport;
}

/**
 * VS Code's settings files are JSONC. Strip comments and trailing commas
 * without touching string contents, then parse.
 */
export function parseJsonc<T = unknown>(text: string): T | null {
  if (!text.trim()) return null;
  let out = "";
  let inString = false;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (lineComment) {
      if (char === "\n") {
        lineComment = false;
        out += char;
      }
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) inString = false;
      continue;
    }
    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      out += char;
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    out += char;
  }

  out = out.replace(/,\s*([}\]])/g, "$1");
  try {
    return JSON.parse(out) as T;
  } catch {
    return null;
  }
}

export interface AppliedSettings {
  editor: Partial<EditorSettings>;
  theme?: "dark" | "light";
  applied: string[];
  ignored: string[];
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Maps the supported subset of `settings.json` onto the Monaco options. */
export function editorFromVSCode(text: string): AppliedSettings {
  const parsed = parseJsonc<Record<string, unknown>>(text) ?? {};
  const editor: Partial<EditorSettings> = {};
  const applied: string[] = [];
  const ignored: string[] = [];

  const font = parsed["editor.fontFamily"];
  if (typeof font === "string" && font.trim()) {
    editor.fontFamily = font;
    applied.push("font family");
  }

  const size = number(parsed["editor.fontSize"]);
  if (size && size >= 8 && size <= 40) {
    editor.fontSize = Math.round(size);
    applied.push("font size");
  }

  const lineHeight = number(parsed["editor.lineHeight"]);
  const base = editor.fontSize ?? 13;
  if (lineHeight !== null) {
    editor.lineHeight = lineHeight > 0 ? Math.round(lineHeight) : Math.round(base * 1.6);
    applied.push("line height");
  }

  const tab = number(parsed["editor.tabSize"]);
  if (tab && tab >= 1 && tab <= 8) {
    editor.tabSize = Math.round(tab);
    applied.push("tab size");
  }

  const wrap = parsed["editor.wordWrap"];
  if (wrap === "on" || wrap === "bounded" || wrap === "off") {
    editor.wordWrap = wrap === "off" ? "off" : "on";
    applied.push("word wrap");
  }

  const minimap = parsed["editor.minimap.enabled"];
  if (typeof minimap === "boolean") {
    editor.minimap = minimap;
    applied.push("minimap");
  }

  let theme: "dark" | "light" | undefined;
  const colorTheme = parsed["workbench.colorTheme"];
  if (typeof colorTheme === "string") {
    if (/light|solarized light|github light/i.test(colorTheme)) theme = "light";
    else if (/dark|night|midnight|black/i.test(colorTheme)) theme = "dark";
    if (theme) applied.push("colour theme");
  }

  if (parsed["editor.fontLigatures"] !== undefined) ignored.push("font ligatures");
  if (parsed["workbench.iconTheme"] !== undefined) ignored.push("file icon theme");

  return { editor, theme, applied, ignored };
}

export function keybindingCount(text: string): number {
  const parsed = parseJsonc<unknown[]>(text);
  return Array.isArray(parsed) ? parsed.length : 0;
}

export function extensionTags(extension: VSCodeExtension): string[] {
  const tags: string[] = [];
  if (extension.has_theme) tags.push("Theme");
  if (extension.has_snippets) tags.push("Snippets");
  if (extension.has_language) tags.push("Language");
  return tags;
}
