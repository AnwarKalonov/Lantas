#!/usr/bin/env node
/**
 * Lantas in the terminal.
 *
 * One binary, no runtime dependencies: the same model, tools and permission
 * posture as the app, in a single folder. Provider keys live in
 * ~/.lantas/config.json with mode 0600 and never leave this machine except to
 * the provider the user chose.
 */

import { readFileSync } from "node:fs";
import { chmod, readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import readline from "node:readline";
import { LOGO_ROWS } from "./logo.mjs";

let VERSION = "1.0.2";
try {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  VERSION = pkg.version || VERSION;
} catch {
  // Installed as two standalone files; the build version is enough.
}
const CONFIG_DIR = path.join(os.homedir(), ".lantas");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const IS_TTY = Boolean(process.stdout.isTTY);
// The desktop app pipes stdin instead of allocating a pty, but its terminal
// panel can still answer approvals. Treat that as an interactive session.
const IN_APP = process.env.LANTAS_IN_APP_TERMINAL === "1";
const COLOR = IS_TTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";
const COLUMNS = process.stdout.columns || Number(process.env.COLUMNS) || 80;

/* ------------------------------------------------------------------ colour */

function detectLight() {
  const value = process.env.COLORFGBG?.split(";").pop();
  if (value === undefined) return false;
  const index = Number(value);
  return Number.isFinite(index) && index >= 7;
}

const FORCED_LIGHT = process.argv.includes("--light")
  ? true
  : process.argv.includes("--dark")
    ? false
    : null;
const LIGHT = FORCED_LIGHT ?? detectLight();
const BG = LIGHT ? [248, 242, 230] : [11, 11, 10];
const PALETTE = {
  ink: LIGHT ? [29, 42, 35] : [242, 240, 233],
  soft: LIGHT ? [78, 91, 83] : [179, 177, 169],
  faint: LIGHT ? [110, 122, 114] : [131, 129, 122],
  green: LIGHT ? [44, 106, 78] : [143, 191, 154],
  red: LIGHT ? [157, 68, 54] : [221, 139, 130],
  yellow: LIGHT ? [138, 95, 33] : [211, 167, 113],
  bg: BG,
};

const sgr = (rgb) => `\x1b[38;2;${rgb.join(";")}m`;
const bgSgr = (rgb) => `\x1b[48;2;${rgb.join(";")}m`;
const C = {
  reset: COLOR ? "\x1b[0m" : "",
  bold: COLOR ? "\x1b[1m" : "",
  dim: COLOR ? "\x1b[2m" : "",
  italic: COLOR ? "\x1b[3m" : "",
  text: COLOR ? sgr(PALETTE.ink) : "",
  soft: COLOR ? sgr(PALETTE.soft) : "",
  faint: COLOR ? sgr(PALETTE.faint) : "",
  green: COLOR ? sgr(PALETTE.green) : "",
  red: COLOR ? sgr(PALETTE.red) : "",
  yellow: COLOR ? sgr(PALETTE.yellow) : "",
};

const paint = (text, ...styles) => `${styles.join("")}${text}${C.reset}`;

/** Terminal text from a model, a file or a command must not be able to move the cursor or recolor the UI. */
function sanitize(text) {
  return String(text)
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

/* ------------------------------------------------------------------- brand */

function blend(level) {
  const amount = level === 1 ? 0.34 : level === 2 ? 0.64 : 1;
  return PALETTE.ink
    .map((channel, index) => Math.round(PALETTE.bg[index] + (channel - PALETTE.bg[index]) * amount))
    .join(";");
}

function logo(columns = 72) {
  if (!COLOR || columns < 76) return null;
  return LOGO_ROWS.map((row) => {
    let line = "  ";
    for (const cell of row) {
      const value = parseInt(cell, 16);
      const top = value >> 2;
      const bottom = value & 3;
      if (!top && !bottom) {
        line += `${C.reset} `;
        continue;
      }
      if (top && bottom) {
        line += `\x1b[38;2;${blend(top)}m\x1b[48;2;${blend(bottom)}m▀`;
      } else if (top) {
        line += `\x1b[38;2;${blend(top)}m\x1b[49m▀`;
      } else {
        line += `\x1b[39m\x1b[48;2;${blend(bottom)}m▄`;
      }
    }
    return `${line}${C.reset}`;
  }).join("\n");
}

const GLYPHS = {
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
};

function wordmark(label = "LANTAS") {
  const rows = Array.from({ length: 7 }, () => "");
  for (const letter of label) {
    const glyph = GLYPHS[letter];
    if (!glyph) continue;
    for (let y = 0; y < 7; y += 1) {
      rows[y] += glyph[y].split("").map((bit) => (bit === "1" ? "██" : "  ")).join("") + "  ";
    }
  }
  return rows.map((row) => `  ${paint(row.trimEnd(), C.text)}`).join("\n");
}

function printBrand({ compact = false } = {}) {
  if (!IS_TTY) {
    console.log("LANTAS — a coding agent in your terminal");
    return;
  }
  const columns = COLUMNS;
  if (compact || columns < 76) {
    console.log();
    console.log(wordmark());
    console.log(`  ${paint("a coding agent for this folder", C.faint)}`);
    console.log();
    return;
  }
  const art = logo(columns);
  if (art) {
    console.log();
    console.log(art);
    console.log();
  } else {
    console.log(`\n${wordmark()}\n`);
  }
  console.log(`  ${paint("a coding agent for this folder", C.soft)}   ${paint(`v${VERSION}`, C.faint)}`);
  console.log();
}

function rule(width = 0) {
  const size = width || Math.min(COLUMNS - 4, 64);
  return paint("─".repeat(Math.max(12, size)), C.faint);
}

/* ------------------------------------------------------------------ config */

const ENV_KEYS = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  groq: ["GROQ_API_KEY"],
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  custom: ["OPENAI_API_KEY"],
};

const PROVIDERS = {
  anthropic: {
    name: "Anthropic",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com",
    needsKey: true,
    models: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"],
    note: "Claude Opus, Sonnet and Haiku",
  },
  openai: {
    name: "OpenAI",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    needsKey: true,
    models: ["gpt-5.1", "gpt-5.1-mini", "gpt-4.1"],
    note: "GPT-5.1 and GPT-4.1",
  },
  openrouter: {
    name: "OpenRouter",
    kind: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    needsKey: true,
    models: ["anthropic/claude-opus-4.5", "openai/gpt-5.1", "google/gemini-3-pro", "qwen/qwen3-coder"],
    note: "One key for most hosted models",
  },
  groq: {
    name: "Groq",
    kind: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    needsKey: true,
    models: ["llama-3.3-70b-versatile", "qwen-3-32b", "moonshotai/kimi-k2-instruct"],
    note: "Fast hosted open models",
  },
  google: {
    name: "Google",
    kind: "google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    needsKey: true,
    models: ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-4-argon", "gemini-2.5-pro"],
    note: "Gemini via AI Studio",
  },
  ollama: {
    name: "Ollama",
    kind: "ollama",
    baseUrl: "http://localhost:11434",
    needsKey: false,
    models: ["qwen3-coder:30b", "llama3.3:latest", "deepseek-r1:14b"],
    note: "Models running on this machine",
  },
  lmstudio: {
    name: "LM Studio",
    kind: "openai",
    baseUrl: "http://localhost:1234/v1",
    needsKey: false,
    models: [],
    note: "Local OpenAI-compatible server",
  },
  custom: {
    name: "Custom endpoint",
    kind: "openai",
    baseUrl: "",
    needsKey: false,
    models: [],
    note: "Any OpenAI-compatible base URL",
  },
};

const PRETTY = {
  "claude-opus-4-5": "Opus 4.5",
  "claude-sonnet-4-5": "Sonnet 4.5",
  "claude-haiku-4-5": "Haiku 4.5",
  "gpt-5.1": "GPT-5.1",
  "gpt-5.1-mini": "GPT-5.1 mini",
  "gpt-4.1": "GPT-4.1",
  "gemini-4-argon": "Gemini 4 Argon",
  "gemini-3.8-flash": "Gemini 3.8 Flash",
  "gemini-3.6-flash": "Gemini 3.6 Flash",
  "gemini-2.5-pro": "Gemini 2.5 Pro",
  "anthropic/claude-opus-4.5": "Claude Opus 4.5",
  "openai/gpt-5.1": "GPT-5.1",
  "google/gemini-3-pro": "Gemini 3 Pro",
  "qwen/qwen3-coder": "Qwen3 Coder",
  "llama-3.3-70b-versatile": "Llama 3.3 70B",
  "qwen-3-32b": "Qwen3 32B",
  "moonshotai/kimi-k2-instruct": "Kimi K2",
  "qwen3-coder:30b": "Qwen3 Coder 30B",
  "llama3.3:latest": "Llama 3.3",
  "deepseek-r1:14b": "DeepSeek R1 14B",
};

const prettyModel = (model) =>
  PRETTY[model] || String(model || "").replace(/^[a-z0-9-]+\//i, "");

function defaultConfig() {
  return { provider: "anthropic", model: "claude-opus-4-5", providers: {}, mode: "build" };
}

async function loadConfig() {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      ...defaultConfig(),
      ...parsed,
      providers: { ...(parsed.providers || {}) },
    };
  } catch {
    return defaultConfig();
  }
}

async function saveConfig(config) {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  // mode only applies to a newly created file; fix an older permissive config.
  await chmod(CONFIG_PATH, 0o600).catch(() => {});
}

function envKey(provider) {
  for (const name of ENV_KEYS[provider] || []) {
    const value = (process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function apiKey(config, provider) {
  return (config.providers?.[provider]?.apiKey || "").trim() || envKey(provider);
}

function baseUrl(config, provider) {
  const meta = PROVIDERS[provider];
  const configured = (config.providers?.[provider]?.baseUrl || "").trim();
  return (configured || meta.baseUrl).replace(/\/+$/, "");
}

function isConfigured(config, provider) {
  const meta = PROVIDERS[provider];
  if (!meta) return false;
  if (meta.needsKey) return Boolean(apiKey(config, provider));
  if (provider === "custom") return Boolean(baseUrl(config, provider));
  return true;
}

function firstConfigured(config) {
  return Object.keys(PROVIDERS).find((id) => isConfigured(config, id)) || null;
}

/* ------------------------------------------------------------------ pieces */

function displayPath(target) {
  const home = os.homedir();
  return target.startsWith(home) ? `~${target.slice(home.length)}` : target;
}

function gitBranch(cwd) {
  const result = spawnSync("git", ["branch", "--show-current"], {
    cwd,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function printHeader(config, cwd, mode) {
  const branch = gitBranch(cwd);
  const meta = PROVIDERS[config.provider];
  const state = mode === "plan" ? paint("Plan · read-only", C.yellow) : paint("Build", C.green);
  console.log(`  ${paint(displayPath(cwd), C.text)}${branch ? `  ${paint(branch, C.faint)}` : ""}`);
  console.log(`  ${state}  ${paint("·", C.faint)}  ${paint(meta?.name || config.provider, C.soft)}  ${paint(prettyModel(config.model), C.soft)}`);
  console.log(`  ${rule()}`);
  console.log();
}

/* --------------------------------------------------------------- input/ui */

let rl = null;
let pendingLine = null;
let closed = false;
let interruptHandler = null;
const lineQueue = [];

function startInput() {
  if (rl) return;
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: Boolean(process.stdin.isTTY),
    historySize: 200,
    removeHistoryDuplicates: true,
  });
  rl.on("line", (line) => {
    if (!pendingLine) {
      lineQueue.push(line);
      return;
    }
    const resolve = pendingLine;
    pendingLine = null;
    resolve(line);
  });
  rl.on("SIGINT", () => {
    if (interruptHandler) {
      interruptHandler();
      return;
    }
    process.stdout.write("\n");
    process.exit(130);
  });
  rl.on("close", () => {
    closed = true;
    if (pendingLine) {
      const resolve = pendingLine;
      pendingLine = null;
      resolve(null);
    }
  });
}

function takeLine() {
  if (lineQueue.length) return Promise.resolve(lineQueue.shift());
  if (closed) return Promise.resolve(null);
  return new Promise((resolve) => {
    pendingLine = resolve;
  });
}

function promptLine(question) {
  if (!rl && !closed) startInput();
  process.stdout.write(question);
  return takeLine();
}

async function readSecret(question) {
  process.stdout.write(question);
  if (!process.stdin.isTTY) {
    const line = await takeLine();
    return line || "";
  }
  if (!rl) startInput();
  if (lineQueue.length) return lineQueue.shift();
  const original = typeof rl._writeToOutput === "function" ? rl._writeToOutput.bind(rl) : null;
  if (original) {
    rl._writeToOutput = (chunk) => {
      const text = String(chunk);
      if (text.includes("\n") || text.includes("\r") || text.includes("\b")) {
        original(text);
        return;
      }
      process.stdout.write("•".repeat(Array.from(text).length));
    };
  }
  const line = await takeLine();
  if (original) rl._writeToOutput = original;
  process.stdout.write("\n");
  return line || "";
}

function spinner(label) {
  if (!IS_TTY) return { stop() {} };
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let index = 0;
  let printed = false;
  const timer = setInterval(() => {
    if (!printed) process.stdout.write("\x1b[?25l");
    printed = true;
    process.stdout.write(`\r${C.faint}${frames[index++ % frames.length]} ${label}${C.reset}\x1b[K`);
  }, 80);
  return {
    stop() {
      clearInterval(timer);
      if (printed) process.stdout.write(`\r\x1b[K${C.reset}\x1b[?25h`);
    },
  };
}

/* --------------------------------------------------------------- streaming */

async function readSSE(response, onData) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, "");
      buffer = buffer.slice(index + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      onData(data);
    }
  }
}

async function readNdjson(response, onData) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) onData(line);
    }
  }
  if (buffer.trim()) onData(buffer.trim());
}

async function streamChat({ config, provider, model, system, messages, signal, onDelta }) {
  const meta = PROVIDERS[provider];
  if (!meta) throw new Error(`Unknown provider: ${provider}`);
  const key = apiKey(config, provider);
  if (meta.needsKey && !key) {
    throw new Error(`No ${meta.name} key. Run \`lantas setup\`.`);
  }
  const base = baseUrl(config, provider);
  if (!base) throw new Error("This provider has no base URL. Run `lantas setup`.");

  let url;
  let headers = { "content-type": "application/json", accept: "text/event-stream" };
  let body;

  if (meta.kind === "anthropic") {
    url = `${base}/v1/messages`;
    headers = {
      ...headers,
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    };
    body = {
      model,
      max_tokens: 4096,
      system,
      stream: true,
      messages: messages.map(({ role, content }) => ({ role, content })),
    };
  } else if (meta.kind === "google") {
    url = `${base}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`;
    body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map(({ role, content }) => ({
        role: role === "assistant" ? "model" : "user",
        parts: [{ text: content }],
      })),
    };
  } else if (meta.kind === "ollama") {
    url = `${base}/api/chat`;
    headers = { "content-type": "application/json", accept: "application/x-ndjson" };
    body = {
      model,
      stream: true,
      messages: [{ role: "system", content: system }, ...messages],
      options: { temperature: 0.2 },
    };
  } else {
    url = `${base}/chat/completions`;
    headers = { ...headers, authorization: `Bearer ${key}` };
    body = {
      model,
      stream: true,
      temperature: 0.2,
      messages: [{ role: "system", content: system }, ...messages],
    };
  }

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new Error(`Could not reach ${meta.name} at ${base}. ${error?.message || ""}`.trim());
  }

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    let detail = raw.slice(0, 320);
    try {
      const parsed = JSON.parse(raw);
      detail = parsed?.error?.message || parsed?.message || detail;
    } catch {
      /* keep raw */
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(`${meta.name} rejected the API key (${response.status}). Run \`lantas setup\`.`);
    }
    if (response.status === 404) {
      throw new Error(`${meta.name} does not know the model “${model}”. Run \`lantas models\` or \`/model\`.`);
    }
    throw new Error(`${meta.name} error ${response.status}: ${detail}`);
  }

  if (meta.kind === "ollama") {
    await readNdjson(response, (line) => {
      try {
        const event = JSON.parse(line);
        const text = event?.message?.content;
        if (text) onDelta(text);
      } catch {
        /* a short final line can be incomplete */
      }
    });
    return;
  }

  await readSSE(response, (data) => {
    try {
      const event = JSON.parse(data);
      if (meta.kind === "anthropic") {
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
          onDelta(event.delta.text || "");
        }
      } else if (meta.kind === "google") {
        const parts = event?.candidates?.[0]?.content?.parts || [];
        for (const part of parts) if (part?.text) onDelta(part.text);
      } else {
        const text = event?.choices?.[0]?.delta?.content;
        if (text) onDelta(text);
      }
    } catch {
      /* ignore keep-alives and provider notices */
    }
  });
}

/* ------------------------------------------------------------------- tools */

const IGNORE = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".turbo",
  ".cache",
  ".venv",
  "__pycache__",
  ".logs",
  "Library",
  "Pods",
  ".DS_Store",
]);

const MAX_FILE = 400_000;

function safePath(cwd, raw) {
  const value = String(raw || "").replace(/\\/g, "/").trim();
  if (!value) throw new Error("A path is required.");
  if (path.isAbsolute(value)) throw new Error("Use a path relative to this folder.");
  const resolved = path.resolve(cwd, value);
  const relative = path.relative(cwd, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("That path leaves this folder.");
  }
  return { absolute: resolved, relative: relative || "." };
}

async function walk(cwd, limit = 6000) {
  const out = [];
  const visit = async (dir, prefix) => {
    if (out.length >= limit) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= limit) return;
      if (IGNORE.has(entry.name) || entry.name.startsWith(".git")) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await visit(path.join(dir, entry.name), relative);
      } else if (entry.isFile()) {
        out.push(relative);
      }
    }
  };
  await visit(cwd, "");
  return out;
}

function globToRegex(pattern) {
  const escaped = String(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const source = escaped
    .replace(/\*\*\//g, "\u0000")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, ".")
    .replace(/\u0000/g, "(?:.*/)?");
  return new RegExp(`^${source}$`, "i");
}

function diff(before, after) {
  const oldLines = before ? before.split("\n") : [];
  const newLines = after ? after.split("\n") : [];
  if (oldLines.length > 1200 || newLines.length > 1200) {
    return {
      lines: [
        ...oldLines.slice(0, 60).map((text) => ({ type: "del", text })),
        ...newLines.slice(0, 60).map((text) => ({ type: "add", text })),
      ],
      added: newLines.length,
      removed: oldLines.length,
      truncated: true,
    };
  }
  const table = Array.from({ length: oldLines.length + 1 }, () =>
    new Array(newLines.length + 1).fill(0),
  );
  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        oldLines[i] === newLines[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const lines = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      lines.push({ type: "ctx", text: oldLines[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      lines.push({ type: "del", text: oldLines[i] });
      removed += 1;
      i += 1;
    } else {
      lines.push({ type: "add", text: newLines[j] });
      added += 1;
      j += 1;
    }
  }
  while (i < oldLines.length) {
    lines.push({ type: "del", text: oldLines[i++] });
    removed += 1;
  }
  while (j < newLines.length) {
    lines.push({ type: "add", text: newLines[j++] });
    added += 1;
  }
  return { lines, added, removed, truncated: false };
}

function printDiff(before, after) {
  const result = diff(before, after);
  const limit = 160;
  let shown = 0;
  for (const line of result.lines) {
    if (shown >= limit) break;
    shown += 1;
    const text = sanitize(line.text);
    if (line.type === "add") console.log(`  ${paint(`+ ${text}`, C.green)}`);
    else if (line.type === "del") console.log(`  ${paint(`- ${text}`, C.red)}`);
    else console.log(`  ${paint(`  ${text}`, C.faint)}`);
  }
  if (result.lines.length > limit || result.truncated) {
    console.log(`  ${paint("… diff shortened", C.faint)}`);
  }
  return result;
}

async function confirm(ctx, action) {
  if (ctx.mode === "plan") return false;
  if (ctx.autoApprove) return true;
  if (!process.stdin.isTTY && !IN_APP) {
    console.log(`  ${paint("non-interactive: rerun with --yes to allow this", C.yellow)}`);
    return false;
  }
  const answer = (await promptLine(
    `  ${paint(action, C.yellow)} ${paint("[y/N/a]", C.faint)} `,
  )) || "";
  const clean = answer.trim().toLowerCase();
  if (clean === "a") {
    ctx.autoApprove = true;
    return true;
  }
  return clean === "y" || clean === "yes";
}

async function executeTool(call, ctx) {
  const name = String(call.name || "").toLowerCase();
  const args = call.args || {};
  const readOnly = ["read", "glob", "grep"].includes(name);

  if (ctx.mode === "plan" && !readOnly) {
    return {
      ok: false,
      summary: "read-only",
      content: "Plan mode is read-only. Answer with a plan; do not retry this tool.",
    };
  }

  try {
    switch (name) {
      case "read": {
        const target = safePath(ctx.cwd, args.path);
        console.log(`  ${paint("· read", C.faint)} ${target.relative}`);
        const info = await stat(target.absolute);
        if (info.size > MAX_FILE) {
          return { ok: false, summary: "too large", content: `${target.relative} is ${formatBytes(info.size)}; read a slice with offset/limit.` };
        }
        const buffer = await readFile(target.absolute);
        if (buffer.includes(0)) {
          return { ok: false, summary: "binary", content: `${target.relative} is binary.` };
        }
        const text = buffer.toString("utf8");
        const all = text.split("\n");
        const offset = Math.max(0, Number(args.offset || 0) || 0);
        const limit = Math.min(2000, Math.max(1, Number(args.limit || 300) || 300));
        const slice = all.slice(offset, offset + limit);
        const body = slice
          .map((line, index) => `${String(offset + index + 1).padStart(5)} | ${line}`)
          .join("\n");
        console.log(`  ${paint(`✓ ${slice.length} lines`, C.faint)}`);
        return {
          ok: true,
          summary: `${slice.length} lines`,
          content: `${target.relative} (${all.length} lines)\n${body}`,
        };
      }

      case "glob": {
        const pattern = String(args.pattern || "**/*");
        console.log(`  ${paint("· glob", C.faint)} ${pattern}`);
        const regex = globToRegex(pattern);
        const files = (await walk(ctx.cwd)).filter((file) => regex.test(file)).slice(0, 300);
        console.log(`  ${paint(`✓ ${files.length} files`, C.faint)}`);
        return {
          ok: true,
          summary: `${files.length} files`,
          content: files.length
            ? files.join("\n")
            : `Nothing matched ${pattern}. Try **/*${pattern.includes(".") ? "" : ".*"}.`,
        };
      }

      case "grep": {
        const pattern = String(args.pattern || "");
        if (!pattern) throw new Error("grep needs a pattern.");
        console.log(`  ${paint("· grep", C.faint)} ${pattern}`);
        let regex;
        try {
          regex = new RegExp(pattern, "i");
        } catch {
          regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        }
        const scope = args.path ? safePath(ctx.cwd, args.path).relative : "";
        const limit = Math.min(200, Math.max(1, Number(args.limit || 60) || 60));
        const files = (await walk(ctx.cwd)).filter(
          (file) => !scope || file === scope || file.startsWith(`${scope.replace(/\/$/, "")}/`),
        );
        const hits = [];
        for (const file of files) {
          if (hits.length >= limit) break;
          let text;
          try {
            const info = await stat(path.join(ctx.cwd, file));
            if (info.size > MAX_FILE) continue;
            text = await readFile(path.join(ctx.cwd, file), "utf8");
          } catch {
            continue;
          }
          if (text.includes("\u0000")) continue;
          const lines = text.split("\n");
          for (let index = 0; index < lines.length; index += 1) {
            if (!regex.test(lines[index])) continue;
            hits.push(`${file}:${index + 1}: ${lines[index].trim().slice(0, 180)}`);
            if (hits.length >= limit) break;
          }
        }
        console.log(`  ${paint(`✓ ${hits.length} matches`, C.faint)}`);
        return {
          ok: true,
          summary: `${hits.length} matches`,
          content: hits.length ? hits.join("\n") : `No match for ${pattern}.`,
        };
      }

      case "write": {
        const target = safePath(ctx.cwd, args.path);
        const content = String(args.content ?? "");
        let before = "";
        let existed = true;
        try {
          before = await readFile(target.absolute, "utf8");
        } catch {
          existed = false;
        }
        console.log(`\n  ${paint(existed ? "update" : "create", C.text)} ${paint(target.relative, C.soft)}`);
        printDiff(before, content);
        const allowed = await confirm(ctx, existed ? `Overwrite ${target.relative}?` : `Create ${target.relative}?`);
        if (!allowed) {
          console.log(`  ${paint("declined", C.faint)}`);
          return { ok: false, summary: "declined", content: "The user declined this write. Do not retry it." };
        }
        await mkdir(path.dirname(target.absolute), { recursive: true });
        await writeFile(target.absolute, content, "utf8");
        console.log(`  ${paint(`✓ ${target.relative}`, C.green)}`);
        return {
          ok: true,
          summary: `${existed ? "updated" : "created"} ${target.relative}`,
          content: `${existed ? "Updated" : "Created"} ${target.relative} (${content.split("\n").length} lines).`,
        };
      }

      case "edit": {
        const target = safePath(ctx.cwd, args.path);
        const oldString = String(args.oldString ?? "");
        const newString = String(args.newString ?? "");
        if (!oldString) throw new Error("edit needs oldString.");
        const before = await readFile(target.absolute, "utf8");
        const occurrences = before.split(oldString).length - 1;
        if (occurrences === 0) {
          return {
            ok: false,
            summary: "not found",
            content: `That exact text is not in ${target.relative}. Read it and copy the text verbatim.`,
          };
        }
        if (occurrences > 1 && !args.replaceAll) {
          return {
            ok: false,
            summary: "ambiguous",
            content: `${oldString.slice(0, 60)} appears ${occurrences} times. Include more context or pass replaceAll.`,
          };
        }
        const next = args.replaceAll
          ? before.split(oldString).join(newString)
          : before.replace(oldString, newString);
        console.log(`\n  ${paint("edit", C.text)} ${paint(target.relative, C.soft)}`);
        printDiff(before, next);
        const allowed = await confirm(ctx, `Apply edit to ${target.relative}?`);
        if (!allowed) {
          console.log(`  ${paint("declined", C.faint)}`);
          return { ok: false, summary: "declined", content: "The user declined this edit. Do not retry it." };
        }
        await writeFile(target.absolute, next, "utf8");
        console.log(`  ${paint(`✓ ${target.relative}`, C.green)}`);
        return {
          ok: true,
          summary: `edited ${target.relative}`,
          content: `Edited ${target.relative}.`,
        };
      }

      case "bash": {
        const command = String(args.command || "").trim();
        if (!command) throw new Error("bash needs a command.");
        console.log(`\n  ${paint("$", C.faint)} ${paint(command, C.soft)}`);
        const allowed = await confirm(ctx, "Run this command?");
        if (!allowed) {
          console.log(`  ${paint("declined", C.faint)}`);
          return { ok: false, summary: "declined", content: "The user declined this command. Do not retry it." };
        }
        const result = await runShell(command, ctx);
        const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
        if (output) {
          const lines = output.split("\n");
          const tail = lines.slice(-24);
          for (const line of tail) console.log(`  ${paint(sanitize(line).slice(0, 220), C.faint)}`);
          if (lines.length > tail.length) console.log(`  ${paint(`… ${lines.length - tail.length} more lines`, C.faint)}`);
        }
        console.log(
          `  ${result.code === 0 ? paint(`✓ exit 0`, C.green) : paint(`✗ exit ${result.code}`, C.red)}`,
        );
        return {
          ok: result.code === 0,
          summary: `exit ${result.code}`,
          content: `command: ${command}\nexit: ${result.code}\n${output.slice(-20000) || "(no output)"}`,
        };
      }

      default:
        return {
          ok: false,
          summary: "unknown tool",
          content: `There is no tool named ${name}. Use read, glob, grep, write, edit or bash.`,
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  ${paint(`✗ ${message}`, C.red)}`);
    return { ok: false, summary: message, content: `Tool failed: ${message}` };
  }
}

function runShell(command, ctx) {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", command], {
      cwd: ctx.cwd,
      env: { ...process.env, LANTAS_CLI: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let done = false;
    let timedOut = false;
    let aborted = false;
    const timer = setTimeout(() => {
      if (!done) {
        timedOut = true;
        child.kill("SIGTERM");
      }
    }, 120_000);
    const onAbort = () => {
      if (!done) {
        aborted = true;
        child.kill("SIGTERM");
      }
    };
    ctx.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 1_000_000) stdout = stdout.slice(-1_000_000);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 1_000_000) stderr = stderr.slice(-1_000_000);
    });
    child.on("error", (error) => {
      done = true;
      clearTimeout(timer);
      ctx.signal?.removeEventListener("abort", onAbort);
      resolve({ code: 1, stdout, stderr: `${stderr}\n${error.message}`.trim() });
    });
    child.on("close", (code) => {
      done = true;
      clearTimeout(timer);
      ctx.signal?.removeEventListener("abort", onAbort);
      if (timedOut) stderr = `${stderr}\nCommand timed out after 120 seconds.`.trim();
      if (aborted) stderr = `${stderr}\nCommand stopped.`.trim();
      resolve({ code: aborted ? 130 : timedOut ? 124 : (code ?? 0), stdout, stderr });
    });
  });
}

/* -------------------------------------------------------------- agent loop */

const OPEN = "<tool_call>";
const CLOSE = "</tool_call>";

class ToolStream {
  constructor(emit) {
    this.emit = emit;
    this.buffer = "";
  }

  push(chunk) {
    this.buffer += chunk;
    this.drain();
  }

  end() {
    this.drain(true);
    if (this.buffer && !this.buffer.includes(OPEN)) this.emit(this.buffer);
    this.buffer = "";
  }

  drain(final = false) {
    while (true) {
      const start = this.buffer.indexOf(OPEN);
      if (start === -1) {
        if (final) return;
        let keep = 0;
        const max = Math.min(OPEN.length - 1, this.buffer.length);
        for (let size = max; size > 0; size -= 1) {
          if (this.buffer.endsWith(OPEN.slice(0, size))) {
            keep = size;
            break;
          }
        }
        const cut = this.buffer.length - keep;
        if (cut > 0) {
          this.emit(this.buffer.slice(0, cut));
          this.buffer = this.buffer.slice(cut);
        }
        return;
      }
      if (start > 0) {
        this.emit(this.buffer.slice(0, start));
        this.buffer = this.buffer.slice(start);
      }
      const end = this.buffer.indexOf(CLOSE);
      if (end === -1) return;
      this.buffer = this.buffer.slice(end + CLOSE.length);
    }
  }
}

function parseToolCalls(raw) {
  const pattern = /<(tool_call|tool|function_call)>\s*([\s\S]*?)\s*<\/\1>/gi;
  const calls = [];
  let match;
  while ((match = pattern.exec(raw))) {
    const body = match[2].trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    try {
      const parsed = JSON.parse(body);
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of entries) {
        const name = String(entry?.name ?? entry?.tool ?? entry?.function?.name ?? "");
        let args = entry?.args ?? entry?.arguments ?? entry?.parameters ?? entry?.function?.arguments ?? {};
        if (typeof args === "string") {
          try {
            args = JSON.parse(args);
          } catch {
            args = {};
          }
        }
        if (name) calls.push({ name, args });
      }
    } catch {
      /* malformed: the model gets told below */
    }
  }
  return { calls, text: raw.replace(pattern, "").trim() };
}

async function fileMap(cwd) {
  const files = await walk(cwd, 4000);
  return files.slice(0, 180).join("\n") + (files.length > 180 ? `\n… ${files.length - 180} more` : "");
}

async function projectRules(cwd) {
  for (const name of ["AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md"]) {
    try {
      const text = await readFile(path.join(cwd, name), "utf8");
      return `\n<project_rules file="${name}">\n${text.slice(0, 8000)}\n</project_rules>`;
    } catch {
      /* none */
    }
  }
  return "";
}

async function systemPrompt(cwd, mode) {
  const rules = await projectRules(cwd);
  return [
    "You are Lantas, a coding agent running in the user's terminal.",
    `Working folder: ${cwd}`,
    `Platform: ${os.platform()} ${os.release()}`,
    `Date: ${new Date().toISOString().slice(0, 10)}`,
    mode === "plan"
      ? "Mode: PLAN. Read and explain only. Never write, edit or run a command that changes anything."
      : "Mode: BUILD. You may change files and run commands, but each one needs the user's approval.",
    "",
    "Use tools to look at the real repository. Never invent file contents or command output.",
    "One tool call at a time, then read its result and decide the next step.",
    "Read a file before editing it. Copy oldString exactly, including indentation.",
    "Prefer the smallest change that fixes the cause. Do not add dependencies or restructure without being asked.",
    "When the task is done, answer directly with no tool call.",
    "",
    "Tool call format, exactly:",
    '<tool_call>{"name":"read","args":{"path":"src/App.tsx","offset":0,"limit":300}}</tool_call>',
    "",
    "Tools:",
    '  read {"path": string, "offset"?: number, "limit"?: number} — numbered lines',
    '  glob {"pattern": string} — find paths, e.g. "src/**/*.ts"',
    '  grep {"pattern": string, "path"?: string, "limit"?: number} — search contents',
    '  write {"path": string, "content": string} — create or replace a file',
    '  edit {"path": string, "oldString": string, "newString": string, "replaceAll"?: boolean}',
    '  bash {"command": string} — run one shell command in the folder',
    "",
    "Answers: plain text, short paragraphs, no headings. Use a fenced code block only when code is the answer.",
    "If a tool fails, say what happened and try one different approach; do not loop.",
    "",
    "<files>",
    await fileMap(cwd),
    "</files>",
    rules,
  ].join("\n");
}

async function runAgent(question, ctx) {
  const messages = [...ctx.history, { role: "user", content: question }];
  const system = await systemPrompt(ctx.cwd, ctx.mode);
  const repeated = new Set();

  for (let step = 0; step < 10; step += 1) {
    if (ctx.signal?.aborted) throw new DOMException("aborted", "AbortError");
    let raw = "";
    let printed = false;
    const spin = spinner(step === 0 ? "Thinking" : "Working");
    const streamer = new ToolStream((chunk) => {
      if (!printed) {
        spin.stop();
        printed = true;
      }
      process.stdout.write(sanitize(chunk));
    });

    await streamChat({
      config: ctx.config,
      provider: ctx.config.provider,
      model: ctx.config.model,
      system,
      messages,
      signal: ctx.signal,
      onDelta: (chunk) => {
        raw += chunk;
        streamer.push(chunk);
      },
    });
    spin.stop();
    streamer.end();

    const parsed = parseToolCalls(raw);
    if (!parsed.calls.length && raw.includes(OPEN)) {
      if (!printed) process.stdout.write("\n");
      messages.push({ role: "assistant", content: raw.slice(0, 16_000) });
      messages.push({
        role: "user",
        content:
          'That tool call did not parse. Send exactly one complete block, with valid JSON: <tool_call>{"name":"read","args":{"path":"src/App.tsx"}}</tool_call>. Do not wrap it in a code fence.',
      });
      continue;
    }
    if (!parsed.calls.length) {
      const answer = parsed.text || raw.trim();
      if (!printed && answer) {
        process.stdout.write(sanitize(answer));
        printed = true;
      }
      if (printed) process.stdout.write("\n");
      ctx.history.push({ role: "user", content: question });
      if (answer) ctx.history.push({ role: "assistant", content: answer });
      ctx.history = ctx.history.slice(-16);
      return;
    }

    if (!printed) process.stdout.write("\n");
    messages.push({ role: "assistant", content: raw.slice(0, 16_000) });

    const results = [];
    for (const call of parsed.calls) {
      const signature = `${call.name}:${JSON.stringify(call.args)}`;
      if (repeated.has(signature)) {
        results.push(
          `<tool_result name="${call.name}" ok="false">\nThis exact call already ran in this turn. Use its earlier result or answer.\n</tool_result>`,
        );
        continue;
      }
      repeated.add(signature);
      const outcome = await executeTool(call, ctx);
      results.push(
        `<tool_result name="${call.name}" ok="${outcome.ok}">\n${outcome.content.slice(0, 24_000)}\n</tool_result>`,
      );
    }

    messages.push({
      role: "user",
      content: `Tool results:\n\n${results.join("\n\n")}\n\nContinue the task. If it is finished, answer with no tool call.`,
    });
  }

  console.log(`\n  ${paint("Stopped after 10 tool rounds. Ask a narrower next step.", C.yellow)}`);
  ctx.history.push({ role: "user", content: question });
  ctx.history = ctx.history.slice(-16);
}

/* --------------------------------------------------------------- commands */

async function setup(config) {
  printBrand({ compact: true });
  console.log(`  ${paint("Connect a provider", C.text)}`);
  console.log(`  ${paint("Keys are stored once in ~/.lantas/config.json (mode 0600).", C.faint)}`);
  console.log();
  const ids = Object.keys(PROVIDERS);
  ids.forEach((id, index) => {
    const meta = PROVIDERS[id];
    const ready = isConfigured(config, id);
    console.log(
      `  ${paint(String(index + 1).padStart(2, " "), C.faint)}  ${paint(meta.name, ready ? C.text : C.soft)}  ${paint(meta.note, C.faint)}`,
    );
  });
  console.log();
  const choice = (await promptLine(`  ${paint("Provider", C.soft)} ${paint("[1-" + ids.length + "]", C.faint)} `)) || "";
  const selected = ids[Number(choice) - 1] || (PROVIDERS[choice.trim()] ? choice.trim() : null);
  if (!selected) {
    console.log(`  ${paint("That is not one of the listed providers.", C.red)}`);
    return;
  }
  const meta = PROVIDERS[selected];
  const entry = { ...(config.providers?.[selected] || {}) };

  if (meta.needsKey) {
    const existing = entry.apiKey || apiKey(config, selected);
    if (existing) {
      const keep = (await promptLine(`  ${paint(`A ${meta.name} key is already saved. Keep it? [Y/n] `, C.soft)}`)) || "y";
      if (!/^n/i.test(keep)) entry.apiKey = existing;
    }
    if (!entry.apiKey) {
      entry.apiKey = (await readSecret(`  ${paint(`${meta.name} API key`, C.soft)} ${paint("(hidden)", C.faint)} `)).trim();
      if (!entry.apiKey) {
        console.log(`  ${paint("No key saved. Nothing was changed.", C.faint)}`);
        return;
      }
    }
  }

  if (meta.kind === "openai" && (selected === "custom" || selected === "lmstudio")) {
    const base = (await promptLine(`  ${paint("Base URL", C.soft)} ${paint(`[${entry.baseUrl || meta.baseUrl}]`, C.faint)} `)) || "";
    if (base.trim()) entry.baseUrl = base.trim();
  }

  config.providers = { ...(config.providers || {}), [selected]: entry };
  config.provider = selected;

  const models = meta.models.length ? meta.models : [];
  console.log();
  if (models.length) {
    console.log(`  ${paint("Model", C.text)}`);
    models.forEach((model, index) => {
      console.log(`  ${paint(String(index + 1).padStart(2, " "), C.faint)}  ${paint(prettyModel(model), C.soft)}  ${paint(model, C.faint)}`);
    });
    const pick = (await promptLine(`  ${paint("Choose", C.soft)} ${paint("[1]", C.faint)} `)) || "1";
    config.model = models[Number(pick) - 1] || models[0];
  } else {
    const custom = (await promptLine(`  ${paint("Model name", C.soft)} `)) || "";
    config.model = custom.trim() || "local-model";
  }

  await saveConfig(config);
  console.log();
  console.log(`  ${paint(`✓ ${PROVIDERS[config.provider].name} · ${prettyModel(config.model)}`, C.green)}`);
  console.log(`  ${paint("Start with", C.faint)} ${paint("lantas", C.text)}`);
  console.log();
}

async function listModels(config) {
  console.log();
  for (const [id, meta] of Object.entries(PROVIDERS)) {
    const ready = isConfigured(config, id);
    const current = config.provider === id;
    console.log(
      `  ${paint(ready ? "●" : "○", ready ? C.green : C.faint)} ${paint(meta.name, current ? C.text : C.soft)}${current ? paint("  current", C.green) : ""}`,
    );
    const models = Array.from(new Set([...(config.providers?.[id]?.models || []), ...meta.models]));
    if (models.length) {
      console.log(`    ${paint(models.map(prettyModel).join(" · "), C.faint)}`);
    } else {
      console.log(`    ${paint(meta.note, C.faint)}`);
    }
  }
  console.log();
  console.log(`  ${paint("Change with", C.faint)} ${paint("/model <name>", C.soft)}${paint(" in a session, or", C.faint)} ${paint("lantas setup", C.soft)}`);
  console.log();
}

function help() {
  printBrand({ compact: true });
  console.log(`  ${paint("Usage", C.text)}`);
  console.log(`    lantas                      start a session in this folder`);
  console.log(`    lantas "fix the failed test"  one task, then exit`);
  console.log(`    lantas setup                connect a provider`);
  console.log(`    lantas models               list providers and models`);
  console.log();
  console.log(`  ${paint("Flags", C.text)}`);
  console.log(`    ${paint("--plan", C.soft)}              read-only; no writes or commands`);
  console.log(`    ${paint("--build", C.soft)}             allow changes (asks first)`);
  console.log(`    ${paint("--yes", C.soft)}               approve file writes and commands without asking`);
  console.log(`    ${paint("--model <name>", C.soft)}      use a model for this run`);
  console.log(`    ${paint("--provider <id>", C.soft)}     use a provider for this run`);
  console.log(`    ${paint("--cwd <folder>", C.soft)}      work in another folder`);
  console.log(`    ${paint("--light / --dark", C.soft)}    override the terminal palette`);
  console.log(`    ${paint("--version", C.soft)}           print the version`);
  console.log();
  console.log(`  ${paint("In a session", C.text)}`);
  console.log(`    ${paint("/model [name]", C.soft)}  ${paint("switch model", C.faint)}`);
  console.log(`    ${paint("/provider <id>", C.soft)} ${paint("switch provider", C.faint)}`);
  console.log(`    ${paint("/plan, /build", C.soft)}  ${paint("change what the agent may do", C.faint)}`);
  console.log(`    ${paint("/auto", C.soft)}          ${paint("toggle approval prompts", C.faint)}`);
  console.log(`    ${paint("/clear, /help, /exit", C.soft)}`);
  console.log();
}

/* -------------------------------------------------------------------- main */

function parseArgs(argv) {
  const options = { cwd: process.cwd(), mode: null, yes: false, light: null };
  const rest = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--plan") options.mode = "plan";
    else if (arg === "--build") options.mode = "build";
    else if (arg === "--yes" || arg === "-y") options.yes = true;
    else if (arg === "--light") options.light = true;
    else if (arg === "--dark") options.light = false;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--version" || arg === "-v") options.version = true;
    else if (arg === "--model") options.model = argv[++index];
    else if (arg === "--provider") options.provider = argv[++index];
    else if (arg === "--cwd") options.cwd = argv[++index];
    else if (arg.startsWith("--")) {
      console.error(`Unknown option ${arg}. Try lantas --help.`);
      process.exit(2);
    } else rest.push(arg);
  }
  options.rest = rest;
  return options;
}

async function changeModel(config, argument) {
  const meta = PROVIDERS[config.provider];
  const available = Array.from(new Set([...(config.providers?.[config.provider]?.models || []), ...meta.models]));
  const clean = argument.trim();
  if (!clean) {
    console.log(
      `  ${paint("Available", C.faint)}  ${available.map(prettyModel).join(" · ") || "no model list"}`,
    );
    return;
  }
  const index = Number(clean) - 1;
  const chosen = available[index] || clean;
  config.model = chosen;
  await saveConfig(config);
  console.log(`  ${paint(`Model → ${prettyModel(chosen)}`, C.green)}`);
}

async function interactive(config, options) {
  const ctx = {
    cwd: options.cwd,
    config,
    mode: options.mode || config.mode || "build",
    autoApprove: options.yes,
    history: [],
    signal: null,
  };

  printBrand();
  printHeader(config, ctx.cwd, ctx.mode);
  console.log(`  ${paint("Type a task. /help for commands, /exit to leave.", C.faint)}`);
  console.log();

  let abortController = null;
  let exiting = false;
  startInput();
  interruptHandler = () => {
    if (abortController) {
      abortController.abort();
      abortController = null;
      process.stdout.write(`\n  ${paint("stopped", C.faint)}\n\n`);
      if (pendingLine) {
        const resolve = pendingLine;
        pendingLine = null;
        resolve("");
      }
      return;
    }
    if (exiting) process.exit(0);
    exiting = true;
    process.stdout.write(`\n  ${paint("bye", C.faint)}\n`);
    setTimeout(() => process.exit(0), 60);
  };

  while (!closed) {
    const line = await promptLine(`  ${paint("›", ctx.mode === "plan" ? C.faint : C.green)} `);
    if (line === null) break;
    const text = line.trim();
    if (!text) continue;

    if (text.startsWith("/")) {
      const [command, ...rest] = text.slice(1).split(/\s+/);
      const argument = rest.join(" ");
      if (command === "exit" || command === "quit") break;
      if (command === "help") {
        help();
        continue;
      }
      if (command === "clear") {
        ctx.history = [];
        console.log(`  ${paint("Thread cleared", C.faint)}`);
        continue;
      }
      if (command === "plan" || command === "build") {
        ctx.mode = command;
        config.mode = command;
        await saveConfig(config);
        console.log(`  ${paint(command === "plan" ? "Plan · read-only" : "Build · asks before changes", command === "plan" ? C.yellow : C.green)}`);
        continue;
      }
      if (command === "auto") {
        ctx.autoApprove = !ctx.autoApprove;
        console.log(`  ${paint(ctx.autoApprove ? "Approvals off for this session" : "Approvals on", ctx.autoApprove ? C.yellow : C.faint)}`);
        continue;
      }
      if (command === "model") {
        await changeModel(config, argument);
        continue;
      }
      if (command === "provider") {
        const id = argument.trim();
        if (!PROVIDERS[id]) {
          console.log(`  ${paint("Providers: " + Object.keys(PROVIDERS).join(", "), C.faint)}`);
          continue;
        }
        if (!isConfigured(config, id)) {
          console.log(`  ${paint(`No credential for ${PROVIDERS[id].name}. Run lantas setup.`, C.yellow)}`);
          continue;
        }
        config.provider = id;
        config.model = PROVIDERS[id].models[0] || config.model;
        await saveConfig(config);
        console.log(`  ${paint(`Provider → ${PROVIDERS[id].name} · ${prettyModel(config.model)}`, C.green)}`);
        continue;
      }
      if (command === "setup") {
        await setup(config);
        continue;
      }
      console.log(`  ${paint(`Unknown command /${command}. /help lists them.`, C.yellow)}`);
      continue;
    }

    abortController = new AbortController();
    ctx.signal = abortController.signal;
    try {
      await runAgent(text, ctx);
      console.log();
    } catch (error) {
      if (error?.name === "AbortError") {
        console.log(`  ${paint("stopped", C.faint)}\n`);
      } else {
        console.log(`  ${paint(error instanceof Error ? error.message : String(error), C.red)}\n`);
      }
    } finally {
      abortController = null;
      ctx.signal = null;
    }
  }

  if (rl) rl.close();
  console.log(`  ${paint("bye", C.faint)}\n`);
}

async function oneShot(config, options, prompt) {
  printBrand({ compact: true });
  printHeader(config, options.cwd, options.mode || config.mode || "build");
  const ctx = {
    cwd: options.cwd,
    config,
    mode: options.mode || config.mode || "build",
    autoApprove: options.yes,
    history: [],
    signal: null,
  };
  const controller = new AbortController();
  ctx.signal = controller.signal;
  process.on("SIGINT", () => controller.abort());
  startInput();
  interruptHandler = () => controller.abort();
  try {
    await runAgent(prompt, ctx);
    console.log();
  } catch (error) {
    if (error?.name === "AbortError") {
      console.log(`\n  ${paint("stopped", C.faint)}`);
    } else {
      console.log(`  ${paint(error instanceof Error ? error.message : String(error), C.red)}`);
      process.exitCode = 1;
    }
  } finally {
    if (rl) rl.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.version) {
    console.log(`lantas ${VERSION}`);
    return;
  }
  if (options.help) {
    help();
    return;
  }

  const cwd = path.resolve(options.cwd);
  try {
    const info = await stat(cwd);
    if (!info.isDirectory()) throw new Error("not a directory");
  } catch {
    console.error(`Not a folder: ${cwd}`);
    process.exitCode = 2;
    return;
  }
  options.cwd = cwd;

  const config = await loadConfig();
  if (options.provider) {
    if (!PROVIDERS[options.provider]) {
      console.error(`Unknown provider ${options.provider}. Try lantas models.`);
      process.exitCode = 2;
      return;
    }
    config.provider = options.provider;
    config.model = PROVIDERS[options.provider].models[0] || config.model;
  }
  if (options.model) config.model = options.model;

  const command = options.rest[0];
  if (command === "setup") {
    await setup(config);
    if (rl) rl.close();
    return;
  }
  if (command === "models") {
    await listModels(config);
    if (rl) rl.close();
    return;
  }

  if (!isConfigured(config, config.provider)) {
    printBrand({ compact: true });
    console.log(`  ${paint(`No ${PROVIDERS[config.provider].name} credential yet.`, C.yellow)}`);
    console.log(`  ${paint("Run", C.faint)} ${paint("lantas setup", C.text)} ${paint("to connect a provider.", C.faint)}`);
    console.log(`  ${paint("Local models work too: Ollama or LM Studio need no key.", C.faint)}`);
    console.log();
    process.exitCode = 1;
    return;
  }

  const prompt = options.rest.join(" ").trim();
  if (prompt) {
    await oneShot(config, options, prompt);
  } else {
    await interactive(config, options);
  }
}

main().catch((error) => {
  console.error(`lantas: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
