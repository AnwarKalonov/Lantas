import { buildArtifact, stashArtifact } from "./artifacts";
import type { AgentId, DiffLine, ProviderId, Skill, WorkspaceFile } from "./types";
import { languageFor } from "./workspace";
import { semanticSearch } from "./semantic";
import {
  BROWSER_GUIDE,
  agentClick,
  agentClickAt,
  agentClickRef,
  agentEnter,
  agentCheck,
  agentEvaluate,
  agentExecute,
  agentScreenshot,
  agentCloseTab,
  agentHistory,
  agentHover,
  agentNavigate,
  agentNewTab,
  agentPage,
  agentSwitchTab,
  agentTabs,
  agentPress,
  agentReload,
  agentScroll,
  agentSelect,
  agentSnapshot,
  agentTypeResult,
  agentWaitForText,
  describeSnapshot,
  parseBrowserAddress,
  resetDomObservation,
  waitForDomChange,
  waitForNavigation,
} from "./browserAgent";
import { engineHealth, engineTask } from "./browserSidecar";
import { runScreenAction } from "./screenControl";
import type { ChatImage } from "./providers";
import { openInChrome } from "./chrome";
import { aiDriving, getElContext } from "./el";
import { runTerminalCommand } from "./terminal";
import {
  gmailQuery,
  activeToolkits,
  executeTool,
  fetchInbox,
  keyPresent,
  listToolkitTools,
  searchEmails,
} from "./composio";

/**
 * Lantas' tool registry.
 *
 * Every tool gets a small typed argument object, returns model-facing text
 * plus an optional UI event, and never reaches outside the workspace the user
 * opened. Browser and integration tools use the same contract so one approval
 * path covers all of them.
 */

export interface ToolContext {
  files: WorkspaceFile[];
  root: string;
  agent: AgentId;
  skills: Skill[];
  /** Writes to disk; resolves false when the workspace is read-only. */
  saveFile: (path: string, text: string) => Promise<boolean>;
  /** Reads the file back from disk. Null means verification is unavailable. */
  readFile?: (path: string) => Promise<string | null>;
  /** Reads any file the app can reach, by absolute path. */
  readAbsoluteFile?: (path: string) => Promise<string | null>;
  /** Reads an image by absolute path as pixels, for vision models. */
  readAbsoluteImage?: (path: string) => Promise<ChatImage | null>;
  /** Creates or replaces any file the app can reach, by absolute path. */
  writeAbsoluteFile?: (path: string, text: string) => Promise<boolean>;
  /** Opens a local address in Lantas' own browser panel. */
  openPreview?: (url: string) => void;
  /** A live stdout/stderr line from the terminal tool. */
  onShellLine?: (line: string) => void;
  /** Overrides the browser drive switch for one turn (the Chrome panel's Act mode). */
  drive?: boolean;
  /** Whether the active model can take an image; text-only models read the DOM. */
  vision?: boolean;
  /** The user's request for this turn, used to resolve ambiguous browser targets. */
  task?: string;
  /** The app's own settings, for the settings tool. */
  settings?: {
    theme: string;
    reduceMotion: boolean;
    notifications: boolean;
    sendOnEnter: boolean;
    defaultAgent: AgentId;
    provider: ProviderId;
    model: string;
  };
  /** Applies a settings change the assistant asked for. */
  updateSettings?: (patch: Record<string, unknown>) => void;
  /** Opens a settings panel by name. */
  openSettings?: (tab: string) => void;
  /** What the user explicitly allowed in the permission sheet. */
  grants?: {
    files: boolean;
    terminal: boolean;
    control: boolean;
  };
  /**
   * The floating screen card. `control` lets the model use the pointer and
   * keyboard; `read` only reads the accessibility tree. Undefined means the
   * screen tool is unavailable on this surface.
   */
  screen?: "control" | "read";
  /**
   * Pauses the browser turn for a detail only the user knows, such as a login
   * email or a one-time code. Resolves with the answer, or throws AbortError.
   */
  askUser?: (
    question: string,
    kind?: "text" | "email" | "password" | "credentials",
    extra?: {
      fields?: import("./userAsk").UserAskField[];
      options?: string[];
      multiple?: boolean;
    },
  ) => Promise<string>;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolOutcome {
  ok: boolean;
  /** One line for the transcript. */
  summary: string;
  /** Everything the model needs to continue. */
  content: string;
  diff?: { path: string; added: number; removed: number; lines: DiffLine[] };
  /** New file text after a successful write/edit, for the live workspace. */
  changed?: { path: string; text: string };
  /** A command the assistant ran, with the output the user should see. */
  shell?: { command: string; output: string[]; state: "done" | "error" };
  /** A finished file the transcript offers as a download. */
  artifact?: { id: string; name: string; format: string; bytes: number };
  /**
   * Pixels the model should see with this result, such as a page screenshot.
   * The loop attaches them to the tool-result turn; only the newest frames are
   * kept so a long browser task does not spend its context on old images.
   */
  images?: ChatImage[];
  /** Resource the permission engine should check. */
  resource: string;
}

export const TOOL_NAMES = [
  "read",
  "glob",
  "grep",
  "semantic_search",
  "write",
  "edit",
  "skill",
  "settings",
  "terminal",
  "git",
  "preview",
  "browser",
  "ask_user",
  "integrations",
  "deliver",
  "screen",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** Shown in the transcript while a tool runs. */
export const TOOL_LABELS: Record<string, string> = {
  read: "Read file",
  glob: "Find files",
  grep: "Search code",
  semantic_search: "Find by meaning",
  write: "Write file",
  edit: "Edit file",
  skill: "Load skill",
  settings: "Settings",
  terminal: "Terminal",
  git: "Run git",
  preview: "Preview",
  browser: "Browser",
  ask_user: "Ask you",
  integrations: "Connected apps",
  deliver: "Deliver file",
  screen: "Screen",
};

/** Display names for the apps a step can touch, used by the timeline. */
const APP_NAMES: Record<string, string> = {
  gmail: "Gmail",
  googlemail: "Gmail",
  googledrive: "Google Drive",
  gdrive: "Google Drive",
  drive: "Google Drive",
  slack: "Slack",
  linear: "Linear",
  notion: "Notion",
  github: "GitHub",
  figma: "Figma",
  vercel: "Vercel",
};

function appName(raw: string): string | undefined {
  const flat = raw.toLowerCase().replace(/[^a-z]/g, "");
  for (const [key, name] of Object.entries(APP_NAMES)) {
    if (flat.includes(key)) return name;
  }
  return undefined;
}

/** What a connected-app call did, in the past-tense voice the timeline uses. */
function integrationVerb(slug: string): string {
  const flat = slug.toLowerCase();
  if (/search|find|query|lookup/.test(flat)) return "Searched";
  if (/create|add|insert|post|send|upload|write/.test(flat)) return "Created";
  if (/update|edit|patch|move|rename/.test(flat)) return "Updated";
  if (/delete|remove|archive/.test(flat)) return "Deleted";
  if (/list|fetch|get|read|download|retrieve/.test(flat)) return "Read";
  return "Used";
}

/** A chat-like label for a connected-app step, e.g. “Searched issues · Linear”. */
function integrationStepLabel(args: Record<string, unknown>): string {
  const action = String(args.action ?? "").toLowerCase();
  const toolkit = String(args.toolkit ?? "");
  const slug = String(args.slug ?? "");
  const app = appName(toolkit) ?? appName(slug);
  switch (action) {
    case "apps":
      return "Connected apps";
    case "inbox":
      return app ? `Read inbox · ${app}` : "Read inbox";
    case "search_email": {
      const query = String(args.query ?? "").trim();
      return `Searched email · Gmail${query ? ` — “${query.slice(0, 40)}”` : ""}`;
    }
    case "tools":
      return app ? `Looked up tools · ${app}` : "Looked up tools";
    case "run": {
      const verb = integrationVerb(slug || toolkit);
      const subject = app ? stepSubject(verb, app) : slug.replace(/[_-]+/g, " ").toLowerCase();
      const inner = args.arguments;
      const query =
        inner && typeof inner === "object"
          ? String(
              (inner as Record<string, unknown>).query ??
                (inner as Record<string, unknown>).q ??
                "",
            ).trim()
          : "";
      return [
        subject ? `${verb} ${subject}` : verb,
        query ? `— “${query.slice(0, 40)}”` : "",
      ]
        .filter(Boolean)
        .join(" ");
    }
    default:
      return action ? `Used apps · ${action}` : "Connected apps";
  }
}

/** “Searched issues · Linear” reads better than “Searched Linear · Linear”. */
function stepSubject(verb: string, app: string): string {
  const plural: Record<string, string> = {
    Linear: "issues",
    Notion: "pages",
    Slack: "messages",
    "Google Drive": "files",
    Gmail: "email",
    GitHub: "code",
    Figma: "files",
  };
  const singular: Record<string, string> = {
    Linear: "issue",
    Notion: "page",
    Slack: "message",
    "Google Drive": "file",
    Gmail: "email",
    GitHub: "code",
    Figma: "file",
  };
  if (verb === "Searched" && plural[app]) return `${plural[app]} · ${app}`;
  if (verb === "Read" && singular[app]) return `${singular[app]} · ${app}`;
  return app;
}

export function toolLabel(call: ToolCall): string {
  if (call.name === "integrations") return integrationStepLabel(call.args);
  if (call.name === "git") {
    const action = String(call.args.action ?? "status").toLowerCase();
    return `Ran git · ${action}`;
  }
  if (call.name === "preview") {
    const action = String(call.args.action ?? "open").toLowerCase();
    const url = String(call.args.url ?? "");
    return url ? `Opened preview · ${url}` : `Preview · ${action}`;
  }
  const base = TOOL_LABELS[call.name] ?? call.name;
  const target =
    call.name === "browser"
      ? typeof call.args.action === "string"
        ? call.args.action
        : ""
      : call.name === "integrations"
        ? typeof call.args.action === "string"
          ? call.args.action
          : ""
        : String(
            call.args.path ??
              call.args.pattern ??
              call.args.name ??
              call.args.url ??
              call.args.query ??
              call.args.command ??
              "",
          );
  return target ? `${base} · ${String(target).slice(0, 90)}` : base;
}

/** The resource a permission rule sees: a path, an action, or a tool slug. */
export function toolResource(call: ToolCall): string {
  if (call.name === "browser") {
    const action = String(call.args.action ?? "");
    const extra = call.args.url ?? call.args.target ?? call.args.key ?? "";
    return extra ? `${action} ${String(extra)}` : action;
  }
  if (call.name === "terminal") {
    return String(call.args.command ?? "command").slice(0, 180);
  }
  if (call.name === "integrations") {
    const action = String(call.args.action ?? "");
    const slug = call.args.slug ?? call.args.toolkit ?? "";
    return slug ? `${action} ${String(slug)}` : action;
  }
  if (call.name === "git") return `git ${String(call.args.action ?? "status")}`;
  if (call.name === "preview") {
    const action = String(call.args.action ?? "open");
    return `${action} ${String(call.args.url ?? "")}`.trim();
  }
  return String(
    call.args.path ?? call.args.pattern ?? call.args.query ?? call.args.name ?? "*",
  );
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:\//.test(value) || value.startsWith("~/");
}

/**
 * Paths inside the workspace stay relative and cannot climb out with `..`.
 * An absolute path is allowed on purpose: the user asked Lantas to read and
 * create any file, and every write still passes the permission sheet first.
 */
function normalizePath(raw: unknown): string {
  const value = String(raw ?? "").replace(/\\/g, "/").trim();
  if (!value) throw new Error("A path is required.");
  if (isAbsolutePath(value)) return value;
  const parts = value.split("/").filter((part) => part && part !== ".");
  if (parts.some((part) => part === "..")) {
    throw new Error("Use an absolute path to work outside the open workspace.");
  }
  return parts.join("/");
}

/** One file read, from the workspace or anywhere on disk. */
function readOutcome(
  path: string,
  text: string,
  offset: number,
  limit: number,
): ToolOutcome {
  const all = text.split("\n");
  const slice = all.slice(offset, offset + limit);
  const numbered = slice
    .map((line, index) => `${String(offset + index + 1).padStart(5)} | ${line}`)
    .join("\n");
  return {
    ok: true,
    summary: `${path} · ${slice.length} lines`,
    content: truncate(
      `${path} (${languageFor(path)}, ${all.length} lines)${
        offset || limit < all.length ? `, lines ${offset + 1}–${offset + slice.length}` : ""
      }\n${numbered}`,
    ),
    resource: path,
  };
}

/**
 * A model that copies a block with different indentation would otherwise get a
 * hard failure on every retry. Compare trimmed lines and accept the match only
 * when it is unique. The file's own spacing is replaced by the new text, so the
 * result is exactly what the model asked for.
 */
function relaxedMatch(text: string, wanted: string): { start: number; end: number } | null {
  const wantedLines = wanted
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim());
  while (wantedLines.length && !wantedLines[0]) wantedLines.shift();
  while (wantedLines.length && !wantedLines[wantedLines.length - 1]) wantedLines.pop();
  if (!wantedLines.length) return null;

  const textLines = text.replace(/\r\n/g, "\n").split("\n");
  const offsets: number[] = [];
  let offset = 0;
  for (const line of textLines) {
    offsets.push(offset);
    offset += line.length + 1;
  }

  const hits: number[] = [];
  for (let start = 0; start + wantedLines.length <= textLines.length; start += 1) {
    let same = true;
    for (let index = 0; index < wantedLines.length; index += 1) {
      if (textLines[start + index].trim() !== wantedLines[index]) {
        same = false;
        break;
      }
    }
    if (same) hits.push(start);
  }
  if (hits.length !== 1) return null;
  const first = hits[0];
  const last = first + wantedLines.length - 1;
  return { start: offsets[first], end: offsets[last] + textLines[last].length };
}

function findFile(files: WorkspaceFile[], path: string): WorkspaceFile | undefined {
  const exact = files.find((file) => file.path === path);
  if (exact) return exact;
  const suffix = files.filter((file) => file.path.endsWith(`/${path}`));
  if (suffix.length === 1) return suffix[0];
  return undefined;
}

async function verifyWrite(
  context: ToolContext,
  path: string,
  text: string,
): Promise<string | null> {
  if (!context.readFile) return null;
  let actual = await context.readFile(path);
  if (actual === null || actual === text) return null;
  // One retry: a sync client, formatter or watcher can race the first write.
  await context.saveFile(path, text);
  actual = await context.readFile(path);
  if (actual === null || actual === text) return null;
  return `Write verification failed for ${path}: the disk copy does not match the requested content.`;
}

function truncate(text: string, limit = 24_000): string {
  return text.length > limit ? `${text.slice(0, limit)}\n…[truncated]` : text;
}

/** Minimal line diff for the transcript. Good enough to show what changed. */
export function diffLines(before: string, after: string): { lines: DiffLine[]; added: number; removed: number } {
  const oldLines = before ? before.split("\n") : [];
  const newLines = after ? after.split("\n") : [];

  // Cap the LCS table; beyond this, report a whole-file replacement.
  if (oldLines.length > 800 || newLines.length > 800) {
    const lines: DiffLine[] = [
      ...oldLines.map((text, index) => ({ type: "del" as const, no: index + 1, text })),
      ...newLines.map((text, index) => ({ type: "add" as const, no: index + 1, text })),
    ];
    return { lines: lines.slice(0, 400), added: newLines.length, removed: oldLines.length };
  }

  const table: number[][] = Array.from({ length: oldLines.length + 1 }, () =>
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

  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      lines.push({ type: "ctx", no: i + 1, text: oldLines[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      lines.push({ type: "del", no: i + 1, text: oldLines[i] });
      removed += 1;
      i += 1;
    } else {
      lines.push({ type: "add", no: j + 1, text: newLines[j] });
      added += 1;
      j += 1;
    }
  }
  while (i < oldLines.length) {
    lines.push({ type: "del", no: i + 1, text: oldLines[i] });
    removed += 1;
    i += 1;
  }
  while (j < newLines.length) {
    lines.push({ type: "add", no: j + 1, text: newLines[j] });
    added += 1;
    j += 1;
  }
  return { lines: lines.slice(0, 400), added, removed };
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const source = escaped
    .replace(/\*\*\//g, "\u0000")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, ".")
    .replace(/\u0000/g, "(?:.*/)?");
  return new RegExp(`^${source}$`, "i");
}

export async function runTool(
  call: ToolCall,
  context: ToolContext,
): Promise<ToolOutcome> {
  const { files } = context;
  const grants = context.grants;

  // Permission is enforced here, before a tool runs, not only in the UI. A
  // model that ignores the rule still cannot read, run or click without the
  // grant the user gave on the permission sheet.
  if (grants) {
    const action = String(call.args.action ?? "").toLowerCase();
    const denied = (summary: string, content: string): ToolOutcome => ({
      ok: false,
      summary,
      content,
      resource: toolResource(call),
    });
    if (
      ["read", "glob", "grep", "write", "edit", "semantic_search"].includes(call.name) &&
      !grants.files
    ) {
      return denied(
        "File access is off",
        "The user has not allowed file access, so this file was not read. Ask them to allow it in Settings → Permissions, or to open a folder first. Do not try another way to reach the files.",
      );
    }
    if (call.name === "terminal" && !grants.terminal) {
      return denied(
        "Running commands is off",
        "The user has not allowed commands to run. Ask them to allow Run commands in Settings → Permissions, then continue. Do not retry the same command.",
      );
    }
    if (
      call.name === "browser" &&
      !["snapshot", "extract", "find", "screenshot", "wait", "tabs"].includes(action) &&
      !grants.control
    ) {
      return denied(
        "Computer control is off",
        "The user has not allowed Lantas to click or type. Ask them to allow Computer control in Settings → Permissions, then continue. Reading the page is still fine.",
      );
    }
  }

  try {
    switch (call.name) {
      case "deliver": {
        const files = Array.isArray(call.args.files)
          ? (call.args.files as Array<{ name?: unknown; content?: unknown }>)
              .filter((file) => file && typeof file.name === "string")
              .map((file) => ({ name: String(file.name), content: String(file.content ?? "") }))
          : undefined;
        const built = buildArtifact({
          name: typeof call.args.name === "string" ? call.args.name : "",
          format: typeof call.args.format === "string" ? call.args.format : undefined,
          content: typeof call.args.content === "string" ? call.args.content : undefined,
          files,
        });
        const id = stashArtifact(built);
        return {
          ok: true,
          summary: `Delivered ${built.filename}`,
          content: [
            `Built ${built.filename} — ${built.format}, ${built.bytes.length} bytes.`,
            "It is attached to the conversation as a download card, so the user can save it with one click.",
            "Do not paste the file contents into your answer and do not ask for a path.",
            "Say what the file contains in one or two sentences, then stop.",
          ].join("\n"),
          resource: built.filename,
          artifact: {
            id,
            name: built.filename,
            format: built.format,
            bytes: built.bytes.length,
          },
        };
      }

      case "read": {
        const requested = String(call.args.path ?? "");
        const path = normalizePath(requested);
        const offset = Math.max(0, Number(call.args.offset ?? 0) || 0);
        const limit = Math.min(2000, Math.max(1, Number(call.args.limit ?? 400) || 400));

        if (isAbsolutePath(requested) && /\.(png|jpe?g|webp|gif)$/i.test(path)) {
          const image = context.readAbsoluteImage
            ? await context.readAbsoluteImage(path)
            : null;
          if (!image) {
            return {
              ok: false,
              summary: `Could not read image ${path}`,
              content: `The image at ${path} could not be read. Check that the file exists and that macOS has given Lantas access to that folder.`,
              resource: path,
            };
          }
          return {
            ok: true,
            summary: `Read image ${path}`,
            content: `The image at ${path} is attached. Look at it before deciding what to change.`,
            images: [image],
            resource: path,
          };
        }

        if (isAbsolutePath(requested)) {
          const text = context.readAbsoluteFile
            ? await context.readAbsoluteFile(path)
            : null;
          if (text === null) {
            return {
              ok: false,
              summary: `No file at ${path}`,
              content: `Could not read ${path}. Check that the path exists and that macOS has given Lantas access to that folder.`,
              resource: path,
            };
          }
          return readOutcome(path, text, offset, limit);
        }

        const file = findFile(files, path);
        if (!file) {
          return {
            ok: false,
            summary: `No file at ${path}`,
            content: `No file matches ${path}. Use glob to find the right path, or pass an absolute path to read outside the workspace.`,
            resource: path,
          };
        }
        if (file.binary || !file.text) {
          return {
            ok: false,
            summary: `${file.path} is binary`,
            content: `${file.path} is binary or too large to read as text.`,
            resource: file.path,
          };
        }
        return readOutcome(file.path, file.text, offset, limit);
      }

      case "glob": {
        const pattern = String(call.args.pattern ?? "**/*");
        const regex = globToRegExp(pattern);
        const matches = files
          .filter((file) => regex.test(file.path))
          .map((file) => file.path)
          .slice(0, 200);
        return {
          ok: true,
          summary: `${matches.length} file${matches.length === 1 ? "" : "s"} match ${pattern}`,
          content: matches.length
            ? matches.join("\n")
            : `Nothing matches ${pattern}. Try **/*${pattern.includes(".") ? "" : ".*"}.`,
          resource: pattern,
        };
      }

      case "semantic_search": {
        const query = String(call.args.query ?? "").trim();
        if (!query) throw new Error("A query is required.");
        const limit = Math.min(20, Math.max(1, Number(call.args.limit ?? 8) || 8));
        const hits = semanticSearch(files, query, limit);
        return {
          ok: true,
          summary: `${hits.length} relevant file${hits.length === 1 ? "" : "s"}`,
          content: hits.length
            ? hits
                .map(
                  (hit) =>
                    `${hit.path}:${hit.line} (score ${hit.score.toFixed(2)})\n${hit.snippet}`,
                )
                .join("\n\n")
            : `Nothing relevant to “${query}” in this workspace. Try a broader description or grep for an exact name.`,
          resource: query,
        };
      }

      case "grep": {
        const pattern = String(call.args.pattern ?? "");
        if (!pattern) throw new Error("A search pattern is required.");
        const scope = call.args.path ? normalizePath(call.args.path) : "";
        let regex: RegExp;
        try {
          regex = new RegExp(pattern, "i");
        } catch {
          regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        }
        const limit = Math.min(200, Math.max(1, Number(call.args.limit ?? 60) || 60));
        const hits: string[] = [];
        for (const file of files) {
          if (file.binary || !file.text) continue;
          if (scope && !file.path.startsWith(scope)) continue;
          const lines = file.text.split("\n");
          for (let index = 0; index < lines.length; index += 1) {
            if (!regex.test(lines[index])) continue;
            hits.push(`${file.path}:${index + 1}: ${lines[index].trim().slice(0, 200)}`);
            if (hits.length >= limit) break;
          }
          if (hits.length >= limit) break;
        }
        return {
          ok: true,
          summary: `${hits.length} match${hits.length === 1 ? "" : "es"} for ${pattern}`,
          content: hits.length
            ? hits.join("\n")
            : (() => {
                const likely = semanticSearch(files, pattern, 5);
                return [
                  `No exact match for ${pattern} in this workspace.`,
                  likely.length
                    ? `Likely files:\n${likely
                        .map((hit) => `${hit.path}:${hit.line} — ${hit.snippet.split("\n")[0]}`)
                        .join("\n")}`
                    : "Try semantic_search with a description of what the code does.",
                ].join("\n\n");
              })(),
          resource: scope || pattern,
        };
      }

      case "write": {
        if (context.agent !== "build") {
          return {
            ok: false,
            summary: "Read-only agent",
            content: "This agent is read-only. Switch to Build to change files.",
            resource: "write",
          };
        }
        const requested = String(call.args.path ?? "");
        const path = normalizePath(requested);
        const text = String(call.args.content ?? "");

        if (isAbsolutePath(requested)) {
          if (!context.writeAbsoluteFile) {
            return {
              ok: false,
              summary: "Cannot write outside the workspace here",
              content: "This surface can only write inside the open folder. Open the desktop app to create files elsewhere.",
              resource: path,
            };
          }
          const before = context.readAbsoluteFile
            ? (await context.readAbsoluteFile(path)) ?? ""
            : "";
          const written = await context.writeAbsoluteFile(path, text);
          if (!written) {
            return {
              ok: false,
              summary: `Could not write ${path}`,
              content: `macOS or the app refused the write to ${path}. Ask the user to grant access to that folder, then retry.`,
              resource: path,
            };
          }
          const after = context.readAbsoluteFile
            ? await context.readAbsoluteFile(path)
            : null;
          if (after !== null && after !== text) {
            return {
              ok: false,
              summary: `Write verification failed for ${path}`,
              content: `The disk copy of ${path} does not match what was written.`,
              resource: path,
            };
          }
          const diff = diffLines(before, text);
          return {
            ok: true,
            summary: `${before ? "Updated" : "Created"} ${path} (+${diff.added} −${diff.removed})`,
            content: `${before ? "Updated" : "Created"} ${path} (${text.split("\n").length} lines) outside the workspace.`,
            diff: { path, added: diff.added, removed: diff.removed, lines: diff.lines },
            resource: path,
          };
        }

        const existing = findFile(files, path);
        const before = existing?.text ?? "";
        const saved = await context.saveFile(path, text);
        const verification = await verifyWrite(context, path, text);
        const diff = diffLines(before, text);
        return {
          ok: !verification,
          summary: verification
            ? `Write verification failed for ${path}`
            : `${existing ? "Updated" : "Created"} ${path} (+${diff.added} −${diff.removed})`,
          content:
            verification ??
            `${existing ? "Updated" : "Created"} ${path} (${text.split("\n").length} lines)${
              saved ? "" : ". The file is updated in the workspace but could not be written to disk, so the user can save it."
            }`,
          diff: { path, added: diff.added, removed: diff.removed, lines: diff.lines },
          changed: { path, text },
          resource: path,
        };
      }

      case "edit": {
        if (context.agent !== "build") {
          return {
            ok: false,
            summary: "Read-only agent",
            content: "This agent is read-only. Switch to Build to change files.",
            resource: "edit",
          };
        }
        const requested = String(call.args.path ?? "");
        const path = normalizePath(requested);
        const oldString = String(call.args.oldString ?? "");
        const newString = String(call.args.newString ?? "");
        if (!oldString) throw new Error("oldString is required for edit.");

        if (isAbsolutePath(requested)) {
          const before = context.readAbsoluteFile
            ? await context.readAbsoluteFile(path)
            : null;
          if (before === null) {
            return {
              ok: false,
              summary: `No file at ${path}`,
              content: `Could not read ${path} to edit it. Check the path and folder access.`,
              resource: path,
            };
          }
          const occurrences = before.split(oldString).length - 1;
          if (!occurrences) {
            return {
              ok: false,
              summary: `oldString not found in ${path}`,
              content:
                "That exact text is not in the file. Read the current file and copy the text verbatim, including indentation.",
              resource: path,
            };
          }
          if (occurrences > 1 && !call.args.replaceAll) {
            return {
              ok: false,
              summary: `${occurrences} matches in ${path}`,
              content:
                "oldString appears more than once. Include more surrounding lines to make it unique, or pass replaceAll: true.",
              resource: path,
            };
          }
          const next = call.args.replaceAll
            ? before.split(oldString).join(newString)
            : before.replace(oldString, newString);
          const written = context.writeAbsoluteFile
            ? await context.writeAbsoluteFile(path, next)
            : false;
          if (!written) {
            return {
              ok: false,
              summary: `Could not write ${path}`,
              content: `macOS or the app refused the write to ${path}.`,
              resource: path,
            };
          }
          const diff = diffLines(before, next);
          return {
            ok: true,
            summary: `Edited ${path} (+${diff.added} −${diff.removed})`,
            content: `Edited ${path} outside the workspace.`,
            diff: { path, added: diff.added, removed: diff.removed, lines: diff.lines },
            resource: path,
          };
        }

        const file = findFile(files, path);
        if (!file) {
          return {
            ok: false,
            summary: `No file at ${path}`,
            content: `No file matches ${path}. Read or glob first.`,
            resource: path,
          };
        }
        const occurrences = file.text.split(oldString).length - 1;
        if (occurrences === 0) {
          const relaxed = call.args.replaceAll === false ? null : relaxedMatch(file.text, oldString);
          if (!relaxed) {
            return {
              ok: false,
              summary: `oldString not found in ${file.path}`,
              content:
                "That exact text is not in the file. Read the current file and copy the text verbatim, including indentation.",
              resource: file.path,
            };
          }
          const before = file.text;
          const next = before.slice(0, relaxed.start) + newString + before.slice(relaxed.end);
          const diff = diffLines(before, next);
          const saved = await context.saveFile(file.path, next);
          const verification = await verifyWrite(context, file.path, next);
          return {
            ok: !verification,
            summary: verification
              ? `Write verification failed for ${file.path}`
              : `Edited ${file.path} (+${diff.added} −${diff.removed})`,
            content:
              verification ??
              `Edited ${file.path}. The block matched line by line with different indentation, so the indented copy was replaced.`,
            diff: { path: file.path, added: diff.added, removed: diff.removed, lines: diff.lines },
            changed: { path: file.path, text: next },
            resource: file.path,
          };
        }
        if (occurrences > 1 && !call.args.replaceAll) {
          return {
            ok: false,
            summary: `${occurrences} matches in ${file.path}`,
            content:
              "oldString appears more than once. Include more surrounding lines to make it unique, or pass replaceAll: true.",
            resource: file.path,
          };
        }
        const before = file.text;
        const next = call.args.replaceAll
          ? before.split(oldString).join(newString)
          : before.replace(oldString, newString);
        // Diff before saving: saveFile may replace the workspace entry in place.
        const diff = diffLines(before, next);
        const saved = await context.saveFile(file.path, next);
        const verification = await verifyWrite(context, file.path, next);
        return {
          ok: !verification,
          summary: verification
            ? `Write verification failed for ${file.path}`
            : `Edited ${file.path} (+${diff.added} −${diff.removed})`,
          content:
            verification ??
            `Edited ${file.path}.${
              saved ? "" : " The workspace copy is updated but disk could not be written."
            }`,
          diff: { path: file.path, added: diff.added, removed: diff.removed, lines: diff.lines },
          changed: { path: file.path, text: next },
          resource: file.path,
        };
      }

      case "settings":
        return runSettingsTool(call.args, context);

      case "skill": {
        const wanted = String(call.args.name ?? "").replace(/^\//, "").toLowerCase();
        const skill = context.skills.find(
          (item) => item.enabled && item.name.toLowerCase() === wanted,
        );
        if (!skill) {
          const available = context.skills
            .filter((item) => item.enabled)
            .map((item) => item.name)
            .join(", ");
          return {
            ok: false,
            summary: `No skill named ${wanted}`,
            content: `No enabled skill is named ${wanted}. Available: ${available || "none"}.`,
            resource: wanted,
          };
        }
        return {
          ok: true,
          summary: `Loaded /${skill.name}`,
          content: `Skill /${skill.name}: ${skill.description}\n\n${skill.instructions}`,
          resource: skill.name,
        };
      }

      case "terminal":
        return await runTerminalTool(call.args, context);

      case "git":
        if (grants && !grants.terminal) {
          return {
            ok: false,
            summary: "Running commands is off",
            content:
              "Git needs the Run commands permission. Ask the user to allow it in Settings → Permissions, then retry.",
            resource: toolResource(call),
          };
        }
        return await runGitTool(call.args, context);

      case "preview":
        return await runPreviewTool(call.args, context);

      case "browser":
        return await runBrowserTool(
          call.args,
          context.drive,
          context.task,
          false,
          context.vision,
        );

      case "screen": {
        if (!context.screen) {
          return {
            ok: false,
            summary: "Screen control is not available here",
            content:
              "Screen control only works in the Lantas Screen card. Open it from the Screen button first.",
            resource: "screen",
          };
        }
        const result = await runScreenAction(call.args, {
          vision: Boolean(context.vision),
          mode: context.screen,
          task: context.task,
        });
        return result;
      }

      case "ask_user": {
        const question = String(call.args.question ?? "").trim();
        if (!question) throw new Error("A question is required.");
        if (!context.askUser) {
          return {
            ok: false,
            summary: "Cannot ask in this panel",
            content:
              "This panel has no reply box. Ask the user in your answer instead; do not guess a missing detail.",
            resource: question,
          };
        }
        const requestedKind = String(call.args.kind ?? "text").toLowerCase();
        const kind = ["text", "email", "password", "credentials"].includes(requestedKind)
          ? (requestedKind as "text" | "email" | "password" | "credentials")
          : "text";
        // A question with several details becomes one titled box each, and a
        // question with known answers becomes a multiple-choice card. Asking
        // for a name and an age in prose is what left the user with no fields.
        const fields: import("./userAsk").UserAskField[] | undefined = Array.isArray(
          call.args.fields,
        )
          ? (call.args.fields as Array<Record<string, unknown>>)
              .map((field) => ({
                label: String(field?.label ?? "").trim(),
                type: String(field?.type ?? "text").toLowerCase() as import("./userAsk").UserAskFieldType,
                placeholder: field?.placeholder ? String(field.placeholder) : undefined,
                options: Array.isArray(field?.options)
                  ? (field.options as unknown[]).map((option) => String(option))
                  : undefined,
                optional: Boolean(field?.optional),
              }))
              .filter((field) => field.label)
          : undefined;
        const rawOptions = call.args.options ?? call.args.choices;
        const options = Array.isArray(rawOptions)
          ? (rawOptions as unknown[]).map((option) => String(option)).filter(Boolean)
          : typeof rawOptions === "string"
            ? rawOptions.split(/[,|]\s*/).filter(Boolean)
            : undefined;
        const extra =
          (fields && fields.length) || (options && options.length)
            ? { fields, options, multiple: Boolean(call.args.multiple) }
            : undefined;
        const answer = await context.askUser(question, kind, extra);
        return {
          ok: true,
          summary: "Answered your question",
          content: `The user answered your question. Use this answer for the step you were on and do not repeat it back to them.\n\n${answer.slice(0, 4_000)}`,
          resource: question,
        };
      }

      case "integrations":
        return await runIntegrationTool(call.args);

      default:
        return {
          ok: false,
          summary: `Unknown tool ${call.name}`,
          content: `There is no tool named ${call.name}. Available tools: ${TOOL_NAMES.join(", ")}.`,
          resource: call.name,
        };
    }
  } catch (error) {
    // Stopping is not a failed tool. Let the abort reach the agent loop so it
    // can end the turn quietly instead of feeding "aborted" back to the model.
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return {
      ok: false,
      summary: error instanceof Error ? error.message : String(error),
      content: `Tool failed: ${error instanceof Error ? error.message : String(error)}`,
      resource: toolResource(call),
    };
  }
}

/**
 * The app's own switches, so "change to light mode" works in conversation
 * instead of the assistant telling the user to open Settings. Only settings
 * may be automated this way: a web destination is still the model's decision
 * and runs through the browser tool.
 */
function runSettingsTool(args: Record<string, unknown>, context: ToolContext): ToolOutcome {
  const action = String(args.action ?? "get").toLowerCase();
  const resource = `settings ${action}`;
  const current = context.settings;

  if (action === "get") {
    if (!current) {
      return {
        ok: false,
        summary: "Settings unavailable",
        content: "App settings can only be read from the desktop chat.",
        resource,
      };
    }
    return {
      ok: true,
      summary: "Read app settings",
      content: [
        `theme=${current.theme}`,
        `reduceMotion=${current.reduceMotion}`,
        `notifications=${current.notifications}`,
        `sendOnEnter=${current.sendOnEnter}`,
        `defaultAgent=${current.defaultAgent}`,
        `model=${current.provider}/${current.model}`,
      ].join("\n"),
      resource,
    };
  }

  if (action === "open") {
    const panel = String(args.panel ?? args.value ?? "general").toLowerCase();
    const allowed = ["general", "providers", "models", "agents", "permissions", "appearance"];
    if (!allowed.includes(panel)) {
      return {
        ok: false,
        summary: "Unknown settings panel",
        content: `panel must be one of ${allowed.join(", ")}.`,
        resource,
      };
    }
    context.openSettings?.(panel);
    return {
      ok: true,
      summary: `Opened ${panel} settings`,
      content: `The ${panel} settings panel is open. Do not describe settings as changed.`,
      resource,
    };
  }

  if (!context.updateSettings) {
    return {
      ok: false,
      summary: "Settings unavailable",
      content: "This surface cannot change app settings.",
      resource,
    };
  }

  if (action === "theme") {
    const value = String(args.value ?? "").toLowerCase();
    if (!["dark", "light", "system"].includes(value)) {
      return {
        ok: false,
        summary: "Unknown theme",
        content: 'theme value must be "dark", "light" or "system".',
        resource,
      };
    }
    context.updateSettings({ theme: value });
    return {
      ok: true,
      summary: `Theme · ${value}`,
      content: `The app theme is now ${value}. It applied immediately; confirm it in one short line and do not send the user to Settings.`,
      resource,
    };
  }

  if (action === "flag") {
    const wanted = String(args.flag ?? "").toLowerCase();
    const flags: Record<string, string> = {
      reducemotion: "reduceMotion",
      motion: "reduceMotion",
      notifications: "notifications",
      sendonenter: "sendOnEnter",
    };
    const key = flags[wanted];
    if (!key) {
      return {
        ok: false,
        summary: "Unknown setting",
        content: "flag must be reduceMotion, notifications or sendOnEnter.",
        resource,
      };
    }
    const value = args.value === undefined ? true : Boolean(args.value);
    context.updateSettings({ [key]: value });
    return {
      ok: true,
      summary: `${key} · ${value ? "on" : "off"}`,
      content: `${key} is now ${value ? "on" : "off"}. It applied immediately.`,
      resource,
    };
  }

  return {
    ok: false,
    summary: `Unknown settings action ${action}`,
    content: "Use settings actions get, theme, flag or open.",
    resource,
  };
}

async function runTerminalTool(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolOutcome> {
  const command = String(args.command ?? "").trim();
  const resource = command.slice(0, 180);
  if (!command) {
    return { ok: false, summary: "A command is required", content: "Pass command, for example {\"command\":\"npm test\"}.", resource };
  }
  if (context.agent !== "build") {
    return {
      ok: false,
      summary: "Read-only agent",
      content: "This agent is read-only. Switch to Build to run commands.",
      resource,
    };
  }

  const timeoutMs = Math.min(
    180_000,
    Math.max(5_000, Number(args.timeoutMs ?? 120_000) || 120_000),
  );
  try {
    const result = await runTerminalCommand(
      context.root,
      command,
      timeoutMs,
      context.onShellLine,
    );
    const output = result.output.slice(-240);
    const body = [
      `$ ${command}`,
      ...output,
      result.timedOut
        ? `Stopped after ${Math.round(timeoutMs / 1000)}s; the command may still be running.`
        : `Exit code: ${result.code === null ? "unknown" : result.code}`,
    ].join("\n");
    return {
      ok: !result.timedOut && result.code === 0,
      summary: result.timedOut
        ? "Command timed out"
        : `Ran \`${command}\` · exit ${result.code === null ? "?" : result.code}`,
      content: truncate(body, 20_000),
      shell: { command, output, state: !result.timedOut && result.code === 0 ? "done" : "error" },
      resource,
    };
  } catch (error) {
    return {
      ok: false,
      summary: "Terminal is unavailable",
      content: error instanceof Error ? error.message : String(error),
      resource,
    };
  }
}

/** One argument, quoted for the login shell the terminal tool runs. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Git as a real tool, not a shell syntax the model has to remember.
 *
 * Commit, pull and push run in the open workspace and return git's own output.
 * Nothing here forces, resets or discards: a failed fast-forward is reported
 * back to the model so it can ask the user instead of rewriting history.
 */
async function runGitTool(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolOutcome> {
  const action = String(args.action ?? "status").toLowerCase();
  const resource = `git ${action}`;
  const root = context.root;
  const fail = (summary: string, content = summary): ToolOutcome => ({
    ok: false,
    summary,
    content,
    resource,
  });

  if (context.agent !== "build") {
    return fail(
      "Read-only agent",
      "This agent cannot change the repository. Switch to Build to commit, pull or push.",
    );
  }
  if (!root) {
    return fail("No workspace is open", "Open a project folder before using git.");
  }

  const path = typeof args.path === "string" ? args.path : "";
  const branch = typeof args.branch === "string" ? args.branch : "";
  const remote = typeof args.remote === "string" ? args.remote : "";
  const limit = Math.min(50, Math.max(1, Number(args.limit ?? 12) || 12));
  let command = "";

  switch (action) {
    case "status":
      command = "git status --short --branch";
      break;
    case "diff":
      command = `git diff${args.staged ? " --staged" : ""}${path ? ` -- ${shellQuote(path)}` : ""}`;
      break;
    case "log":
      command = `git log --oneline -n ${limit}`;
      break;
    case "show":
      command = `git show --stat --oneline -n ${limit}`;
      break;
    case "branch":
      command = "git branch --show-current";
      break;
    case "add":
      command = path ? `git add -- ${shellQuote(path)}` : "git add -A";
      break;
    case "commit": {
      const message = String(args.message ?? "").trim();
      if (!message) return fail("A commit message is required", 'Pass {"action":"commit","message":"…"}.');
      const stage = args.all === false ? "" : "git add -A && ";
      command = `${stage}git commit -m ${shellQuote(message)}`;
      break;
    }
    case "pull":
      // Fast-forward only: a pull that would create a merge commit or rewrite
      // local work stops and reports, so the user decides.
      command = `git pull --ff-only${remote ? ` ${shellQuote(remote)}` : ""}${branch ? ` ${shellQuote(branch)}` : ""}`;
      break;
    case "push":
      command = `git push${remote ? ` ${shellQuote(remote)}` : ""}${branch ? ` ${shellQuote(branch)}` : ""}`;
      break;
    case "checkout": {
      const name = String(args.name ?? branch ?? "").trim();
      if (!name) return fail("A branch name is required");
      command = `git checkout ${shellQuote(name)}`;
      break;
    }
    default:
      return fail(
        `Unknown git action ${action}`,
        "Use status, diff, log, show, add, commit, pull, push, checkout or branch.",
      );
  }

  try {
    const result = await runTerminalCommand(root, command, 120_000);
    const output = result.output.slice(-160);
    const body = [
      `$ ${command}`,
      ...output,
      result.timedOut
        ? "The command timed out; it may still be running."
        : `Exit code: ${result.code === null ? "unknown" : result.code}`,
    ].join("\n");
    return {
      ok: !result.timedOut && result.code === 0,
      summary:
        result.code === 0
          ? `git ${action} finished`
          : `git ${action} failed · exit ${result.code ?? "?"}`,
      content: truncate(body, 16_000),
      shell: {
        command,
        output,
        state: !result.timedOut && result.code === 0 ? "done" : "error",
      },
      resource,
    };
  } catch (error) {
    return fail(
      "Git is unavailable",
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Starts a project's dev server and opens it in Lantas' browser panel.
 *
 * This is the desktop-app equivalent of a preview pane: the model can run the
 * app it just changed, watch the port come up, then keep working with the
 * page in front of the user. The server is detached with nohup so the turn
 * does not hold it open.
 */
async function runPreviewTool(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolOutcome> {
  const action = String(args.action ?? "open").toLowerCase();
  const raw = String(args.url ?? args.address ?? "").trim();
  const port = Number(args.port ?? 5173) || 5173;
  const target = raw
    ? /^(localhost|127\.|0\.0\.0\.0)/i.test(raw) && !/^https?:/i.test(raw)
      ? `http://${raw}`
      : raw
    : `http://localhost:${port}`;
  const resource = `preview ${target}`;
  const fail = (summary: string, content = summary): ToolOutcome => ({
    ok: false,
    summary,
    content,
    resource,
  });

  if (action === "open") {
    if (!context.openPreview) {
      return fail(
        "The browser panel is unavailable here",
        "Preview opens in the desktop app. Open the address in a browser instead.",
      );
    }
    context.openPreview(target);
    return {
      ok: true,
      summary: `Opened ${target} in Lantas`,
      content: `Opened ${target} in Lantas' browser panel. It is visible to the user now.`,
      resource,
    };
  }

  if (action !== "start") {
    return fail("Unknown preview action", 'Use {"action":"start"} or {"action":"open"}.');
  }

  if (context.agent !== "build") {
    return fail("Read-only agent", "Switch to Build to start a dev server.");
  }
  if (!context.grants?.terminal) {
    return fail(
      "Running commands is off",
      "Ask the user to allow Run commands in Settings → Permissions, then start the preview again.",
    );
  }

  const command = String(args.command ?? "").trim() || "npm run dev";
  const log = ".lantas-preview.log";
  try {
    const started = await runTerminalCommand(
      context.root,
      `nohup ${command} > ${log} 2>&1 & echo $!`,
      8_000,
    );
    if (started.code !== 0) {
      return fail(
        "The preview command did not start",
        [
          `$ ${command}`,
          ...started.output.slice(-30),
          "Check the command, then try again with an explicit command.",
        ].join("\n"),
      );
    }

    // Wait for the address to answer instead of showing a blank frame. A dev
    // server usually needs a few seconds to compile the first page.
    let ready = false;
    let lastCode = "";
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await sleep(900);
      const probe = await runTerminalCommand(
        context.root,
        `curl -s -o /dev/null -w '%{http_code}' ${shellQuote(target)}`,
        4_000,
      ).catch(() => null);
      if (!probe) continue;
      lastCode = probe.output.join("").trim().split(/\s+/).pop() ?? "";
      if (/^[23]\d\d$/.test(lastCode)) {
        ready = true;
        break;
      }
    }

    context.openPreview?.(target);
    const tail = await runTerminalCommand(
      context.root,
      `tail -n 20 ${log}`,
      4_000,
    ).catch(() => null);
    return {
      ok: true,
      summary: ready
        ? `Preview is live at ${target}`
        : `Preview started at ${target}`,
      content: [
        `$ ${command}`,
        ready
          ? `The server answered ${lastCode} and ${target} is open in Lantas' browser panel.`
          : `The server was launched but ${target} has not answered yet${lastCode ? ` (last status ${lastCode})` : ""}. It may still be compiling; check the panel before assuming it failed.`,
        "The process is detached; it keeps running after this turn.",
        tail ? `Log (${log}):\n${tail.output.slice(-30).join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      shell: {
        command,
        output: tail?.output.slice(-30) ?? [],
        state: "done",
      },
      resource,
    };
  } catch (error) {
    return fail(
      "Preview could not start",
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * A search-results address is what the app used to produce on its own: “open
 * something” became a query for the word "something". Navigating there is only
 * right when the user actually asked to search, so the tool refuses it
 * otherwise and sends the model back to choose the real page.
 */
function isSearchResults(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)(google|bing|duckduckgo|yahoo|ecosia|brave|startpage|baidu|yandex)\.[a-z.]{2,}$/i.test(parsed.hostname)) {
      return false;
    }
    return parsed.searchParams.has("q") || /\/(search|s|web|results|html)\b/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

async function runBrowserTool(
  args: Record<string, unknown>,
  drive?: boolean,
  task = "",
  /** Part of a batched call: no state read before, no snapshot after. */
  quiet = false,
  /** False for a text-only model: screenshots are refused, text tools remain. */
  vision = true,
): Promise<ToolOutcome> {
  const action = String(args.action ?? "").toLowerCase();
  const resource = toolResource({ name: "browser", args });

  const fail = (summary: string): ToolOutcome => ({
    ok: false,
    summary,
    content: summary,
    resource,
  });

  const readOnly = ["snapshot", "extract", "find", "screenshot", "wait", "tabs"].includes(action);
  if (!readOnly && !(drive ?? aiDriving())) {
    return fail(
      "The user has control of the browser. Ask them to switch to Act mode before changing the page.",
    );
  }

  const compare = [
    "click",
    "click_at",
    "hover",
    "type",
    "fill",
    "select",
    "check",
    "navigate",
    "switch_tab",
    "new_tab",
    "close_tab",
    "back",
    "forward",
  ].includes(action);
  const beforeSnapshot = compare && !quiet
    ? await agentSnapshot().catch(() => null)
    : null;
  const beforePage = beforeSnapshot?.page ?? getElContext();
  if (!readOnly && !quiet) await resetDomObservation().catch(() => undefined);

  /**
   * A cheap model needs to see the page after an action, not guess. Append the
   * new URL, title and control map to the tool result so the next step has
   * current references without spending a second call on snapshot.
   */
  const afterAction = async (base: string): Promise<string> => {
    if (quiet) return base;
    try {
      const domChanged = await waitForDomChange(1_800);
      const snapshot = await agentSnapshot();
      if (!snapshot.page) return base;
      const controls = snapshot.elements
        .slice(0, 80)
        .map((el) => `${el.i}. [${el.kind}] ${el.label}`)
        .join("\n");

      const changes = [];
      if (beforePage && beforePage.url !== snapshot.page.url) {
        changes.push(`URL ${beforePage.url} -> ${snapshot.page.url}`);
      }
      if (beforePage && beforePage.title !== snapshot.page.title) {
        changes.push(`title “${beforePage.title}” -> “${snapshot.page.title}”`);
      }
      if (beforeSnapshot) {
        const beforeLabels = new Set(beforeSnapshot.elements.map((el) => el.label));
        const afterLabels = new Set(snapshot.elements.map((el) => el.label));
        const appeared = snapshot.elements
          .filter((el) => !beforeLabels.has(el.label))
          .slice(0, 5)
          .map((el) => el.label);
        const disappeared = beforeSnapshot.elements
          .filter((el) => !afterLabels.has(el.label))
          .slice(0, 5)
          .map((el) => el.label);
        if (beforeSnapshot.elements.length !== snapshot.elements.length) {
          changes.push(
            `controls ${beforeSnapshot.elements.length} -> ${snapshot.elements.length}`,
          );
        }
        if (appeared.length) changes.push(`appeared: ${appeared.join(", ")}`);
        if (disappeared.length) changes.push(`disappeared: ${disappeared.join(", ")}`);
      }
      // The readable text is the page's real output: a model that only sees
      // "DOM changed" has to ask for the page again. A short line delta is the
      // same evidence as a screenshot, as text.
      if (beforePage?.text && snapshot.page.text) {
        const beforeLines = new Set(
          beforePage.text
            .split(/\n+/)
            .map((line) => line.trim())
            .filter(Boolean),
        );
        const fresh = snapshot.page.text
          .split(/\n+/)
          .map((line) => line.trim())
          .filter((line) => line.length > 1 && !beforeLines.has(line))
          .slice(0, 4);
        if (fresh.length) {
          changes.push(
            `new text: ${fresh
              .map((line) => (line.length > 110 ? `${line.slice(0, 110)}…` : line))
              .join(" | ")}`,
          );
        }
      }
      return [
        base,
        changes.length
          ? `State changed: ${changes.join("; ")}.`
          : domChanged
            ? "The page DOM changed; URL and title stayed the same."
            : "No URL, title, control or DOM change detected.",
        `Now at: ${snapshot.page.url}`,
        `Title: ${snapshot.page.title}`,
        controls ? `Controls:\n${controls}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
    } catch {
      return base;
    }
  };

  switch (action) {
    case "snapshot": {
      const snapshot = await agentSnapshot();
      return {
        ok: Boolean(snapshot.page),
        summary: snapshot.page ? `Read ${snapshot.page.title}` : "No page is open",
        content: describeSnapshot(snapshot),
        resource,
      };
    }

    case "extract": {
      const snapshot = await agentSnapshot();
      if (!snapshot.page) return fail("No page is open in the browser.");
      return {
        ok: true,
        summary: `Extracted ${snapshot.page.words} words`,
        content: truncate(snapshot.page.text, 20_000),
        resource,
      };
    }

    case "find": {
      const query = String(args.query ?? args.text ?? "").trim();
      if (!query) return fail("A query is required to find text.");
      const snapshot = await agentSnapshot();
      if (!snapshot.page) return fail("No page is open in the browser.");
      const needle = query.toLowerCase();
      const lines = snapshot.page.text
        .split(/\n+/)
        .map((line) => line.trim())
        .filter((line) => line.toLowerCase().includes(needle))
        .slice(0, 12);
      return {
        ok: true,
        summary: lines.length
          ? `${lines.length} match${lines.length === 1 ? "" : "es"} for “${query}”`
          : `No match for “${query}”`,
        content: lines.length
          ? `Matches for “${query}” on ${snapshot.page.url}:\n${lines.join("\n")}`
          : `“${query}” does not appear in the readable text of ${snapshot.page.url}. Use snapshot to see the controls, or extract for the full text.`,
        resource,
      };
    }

    case "wait": {
      const text = String(args.text ?? "").trim();
      const gone = Boolean(args.gone) || args.state === "hidden" || args.state === "detached";
      const timeoutMs = Math.min(30_000, Math.max(250, Number(args.timeoutMs ?? args.timeout ?? 8000) || 8000));
      if (!text) {
        const delay = Math.min(30_000, Math.max(0, Number(args.ms ?? args.delayMs ?? 500) || 0));
        await new Promise((resolve) => setTimeout(resolve, delay));
        return {
          ok: true,
          summary: `Waited ${delay}ms`,
          content: await afterAction(`Waited ${delay}ms.`),
          resource,
        };
      }
      const met = await agentWaitForText(text, timeoutMs, gone);
      return met
        ? {
            ok: true,
            summary: gone ? `“${text}” is gone` : `Found “${text}”`,
            content: await afterAction(
              gone ? `“${text}” left the page.` : `“${text}” appeared on the page.`,
            ),
            resource,
          }
        : fail(
            gone
              ? `“${text}” was still on the page after ${timeoutMs}ms.`
              : `“${text}” did not appear within ${timeoutMs}ms.`,
          );
    }

    case "click": {
      if (typeof args.ref === "number" || typeof args.ref === "string") {
        const ok = await agentClickRef(String(args.ref));
        return ok
          ? {
              ok: true,
              summary: `Clicked element ${args.ref}`,
              content: await afterAction(`Clicked element ${args.ref}.`),
              resource,
            }
          : fail("That element ref is stale. Take a fresh snapshot and use its new ref.");
      }
      const target = String(args.target ?? args.selector ?? "");
      if (!target) return fail("A target or ref is required to click.");
      const ok = await agentClick(target);
      return ok
        ? {
            ok: true,
            summary: `Clicked “${target}”`,
            content: await afterAction(`Clicked ${target}.`),
            resource,
          }
        : fail(`Could not click “${target}”. Take a fresh snapshot and try a different label.`);
    }

    case "click_at": {
      const x = Number(args.x ?? NaN);
      const y = Number(args.y ?? NaN);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return fail("click_at needs numeric x and y viewport coordinates.");
      }
      const ok = await agentClickAt(x, y);
      return ok
        ? {
            ok: true,
            summary: `Clicked at ${Math.round(x)}, ${Math.round(y)}`,
            content: await afterAction(`Clicked at ${Math.round(x)}, ${Math.round(y)}.`),
            resource,
          }
        : fail("Nothing was at those coordinates. Take a fresh snapshot and aim at a control.");
    }

    case "hover": {
      const target = String(args.target ?? args.selector ?? "");
      if (!target) return fail("A target or selector is required to hover.");
      const ok = await agentHover(target);
      return ok
        ? {
            ok: true,
            summary: `Hovered “${target}”`,
            content: await afterAction(`Hovered ${target}.`),
            resource,
          }
        : fail(`Could not find “${target}” to hover. Take a fresh snapshot.`);
    }

    case "select": {
      const target = String(args.target ?? args.selector ?? "");
      const value = String(args.value ?? args.text ?? "");
      if (!target || !value) return fail("A select target and value are required.");
      const ok = await agentSelect(target, value);
      return ok
        ? {
            ok: true,
            summary: `Selected “${value}”`,
            content: await afterAction(`Selected ${value} in ${target}.`),
            resource,
          }
        : fail(`Could not select “${value}” in “${target}”. Take a fresh snapshot.`);
    }

    case "check": {
      const target = String(args.target ?? args.selector ?? "");
      if (!target) return fail("A target or selector is required.");
      const checked = args.checked !== false;
      const ok = await agentCheck(target, checked);
      return ok
        ? {
            ok: true,
            summary: checked ? `Checked “${target}”` : `Unchecked “${target}”`,
            content: await afterAction(`${checked ? "Checked" : "Unchecked"} ${target}.`),
            resource,
          }
        : fail(`Could not change “${target}”. It may need a click by ref instead.`);
    }

    case "screenshot": {
      if (!vision) {
        return fail(
          "This model cannot see images. Use browser snapshot, extract, find or execute: they return the page as text with numbered controls.",
        );
      }
      const shot = await agentScreenshot();
      if (!shot.ok || !shot.image) {
        return fail(
          shot.error ||
            "Could not capture the page. In the desktop app the Browser tab must be on screen and Screen Recording allowed.",
        );
      }
      const page = await agentPage().catch(() => null);
      return {
        ok: true,
        summary: page?.title ? `Saw ${page.title}` : "Captured the page",
        content: [
          "Screenshot of the live page is attached to this result.",
          page?.url ? `URL: ${page.url}` : "",
          "Use it to check what the page actually shows; the DOM text alone cannot show overlays, canvases or layout.",
        ]
          .filter(Boolean)
          .join("\n"),
        images: [shot.image],
        resource,
      };
    }

    case "execute":
    case "run":
    case "js": {
      const code = String(args.code ?? args.script ?? args.js ?? "").trim();
      if (!code) return fail("execute needs code to run in the live page.");
      const timeoutMs = Math.min(60_000, Math.max(1_000, Number(args.timeoutMs ?? 12_000) || 12_000));
      const result = await agentExecute(code, timeoutMs);
      const images: ChatImage[] = [];
      if (args.screenshot && vision) {
        const shot = await agentScreenshot();
        if (shot.ok && shot.image) images.push(shot.image);
      }
      const value = result.value === undefined ? "undefined" : JSON.stringify(result.value, null, 2);
      return {
        ok: result.ok,
        summary: result.ok ? "Ran page code" : "Page code failed",
        content: truncate(
          [
            result.ok
              ? "Page code finished. The session stays open for the next call."
              : `Page code failed: ${result.error ?? "unknown error"}`,
            `Value:\n${value}`,
            result.logs.length ? `Console:\n${result.logs.join("\n")}` : "",
            images.length ? "A screenshot of the page is attached." : "",
          ]
            .filter(Boolean)
            .join("\n\n"),
          16_000,
        ),
        images: images.length ? images : undefined,
        resource,
      };
    }

    case "evaluate": {
      const code = String(args.code ?? "").trim();
      if (!code) return fail("evaluate needs code to run in the page.");
      const result = await agentEvaluate(code);
      if (!result.ok) return fail(result.error || "The page could not run that script.");
      const value = JSON.stringify(result.value ?? null);
      return {
        ok: true,
        summary: "Ran page script",
        content: truncate(`Page returned:\n${value ?? "null"}`, 12_000),
        resource,
      };
    }

    case "type":
    case "fill": {
      const text = String(args.text ?? args.value ?? "");
      if (!text && !args.clear) return fail("Text is required.");
      const typed = await agentTypeResult(
        text,
        typeof args.selector === "string" ? args.selector : undefined,
        Boolean(args.submit),
      );
      if (typed.ok && args.submit) {
        await waitForNavigation("", 6_000, beforePage?.url ?? "");
      }
      return typed.ok
        ? {
            ok: true,
            summary: args.submit ? "Typed and submitted" : "Typed into the page",
            content: await afterAction(
              typed.value ? `Typed into the page. The field now reads: ${typed.value}` : "Typed into the page.",
            ),
            resource,
          }
        : fail(
            typed.error ||
              "No editable field was found. Click the field or expression row first, then type.",
          );
    }

    case "press": {
      const key = String(args.key ?? "Enter");
      const ok = await agentPress(key);
      return ok
        ? {
            ok: true,
            summary: `Pressed ${key}`,
            content: await afterAction(`Pressed ${key}.`),
            resource,
          }
        : fail(`Could not press ${key}.`);
    }

    case "enter": {
      const ok = await agentEnter();
      return ok
        ? { ok: true, summary: "Pressed Enter", content: await afterAction("Pressed Enter."), resource }
        : fail("Could not press Enter.");
    }

    case "scroll": {
      const dy = Number(args.dy ?? 700);
      const ok = await agentScroll(dy);
      return ok
        ? {
            ok: true,
            summary: dy >= 0 ? "Scrolled down" : "Scrolled up",
            content: await afterAction(`Scrolled ${Math.abs(dy)}px.`),
            resource,
          }
        : fail("Could not scroll the page.");
    }

    case "open_in_chrome": {
      const address = parseBrowserAddress(String(args.url ?? ""));
      if (!address.ok) return fail(address.error);
      const opened = await openInChrome(address.url);
      return opened
        ? {
            ok: true,
            summary: "Opened in Chrome for sign-in",
            content:
              "Opened the page in the user's real Chrome profile. Ask the user to finish signing in there, then use the Chrome engine to read the authenticated page.",
            resource,
          }
        : fail("Could not open Chrome. The desktop app is required.");
    }

    case "tabs": {
      const tabs = await agentTabs();
      return {
        ok: tabs.length > 0,
        summary: tabs.length ? `${tabs.length} open tab${tabs.length === 1 ? "" : "s"}` : "No tabs are available",
        content: tabs.length
          ? tabs
              .map(
                (tab, index) =>
                  `${index}. ${tab.active ? "● " : "  "}${tab.title}\n   id: ${tab.id}\n   ${tab.url}`,
              )
              .join("\n")
          : "No browser tab could be read. Open Lantas Browser or connect Chrome.",
        resource,
      };
    }

    case "switch_tab": {
      const target = args.id ?? args.tab ?? args.index;
      const ok = await agentSwitchTab(target as string | number | undefined);
      return ok
        ? {
            ok: true,
            summary: `Switched to tab ${String(target ?? "active")}`,
            content: await afterAction(`Switched to tab ${String(target ?? "active")}.`),
            resource,
          }
        : fail("That tab does not exist, or the browser is not open.");
    }

    case "new_tab": {
      const address = parseBrowserAddress(String(args.url ?? ""));
      if (!address.ok) return fail(address.error);
      if (isSearchResults(address.url) && !/\bsearch/i.test(task)) {
        return fail(
          "That is a search-results address. Decide the real page and open it; only search when the user actually said search.",
        );
      }
      const ok = await agentNewTab(address.url);
      return ok
        ? {
            ok: true,
            summary: `Opened a new tab at ${address.url}`,
            content: await afterAction(`Opened a new tab at ${address.url}.`),
            resource,
          }
        : fail("Could not open a new browser tab.");
    }

    case "close_tab": {
      const target = args.id ?? args.tab ?? args.index;
      const ok = await agentCloseTab(target as string | number | undefined);
      return ok
        ? {
            ok: true,
            summary: `Closed tab ${String(target ?? "active")}`,
            content: await afterAction(`Closed tab ${String(target ?? "active")}.`),
            resource,
          }
        : fail("That tab does not exist, the browser is not open, or it is the last tab.");
    }

    /**
     * A whole browsing job, handed to the local browser-use engine in its own
     * process. Step-by-step actions above stay the default; this is for tasks
     * that need a real browser (trusted input, downloads, sign-in, multi-page
     * work) rather than one synthesised click.
     */
    case "steps": {
      const raw = Array.isArray(args.steps)
        ? args.steps
        : Array.isArray(args.actions)
          ? args.actions
          : [];
      if (!raw.length) {
        return fail(
          'steps needs a non-empty array, for example {"action":"steps","steps":[{"action":"click","ref":12},{"action":"type","text":"2x + 4"},{"action":"press","key":"Enter"}]}',
        );
      }
      if (raw.length > 12) return fail("A batch is limited to 12 steps. Send the rest as the next call.");
      const log: string[] = [];
      let stopped = "";
      for (let index = 0; index < raw.length; index += 1) {
        const step =
          raw[index] && typeof raw[index] === "object"
            ? ({ ...(raw[index] as Record<string, unknown>) } as Record<string, unknown>)
            : {};
        const stepAction = String(step.action ?? "").toLowerCase();
        if (!stepAction || stepAction === "steps" || stepAction === "run" || stepAction === "task") {
          log.push(`${index + 1}. skipped (${stepAction || "no action"})`);
          continue;
        }
        const outcome = await runBrowserTool(step, drive, task, true, vision);
        log.push(`${index + 1}. ${stepAction}: ${outcome.summary}`);
        if (!outcome.ok) {
          stopped = `${stepAction} failed — ${outcome.content}`;
          break;
        }
        // A tick between steps lets React and canvas editors commit before the
        // next action looks for what the step was supposed to produce.
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      const body = await afterAction(
        [`Ran ${raw.length} step${raw.length === 1 ? "" : "s"}.`, ...log, stopped]
          .filter(Boolean)
          .join("\n"),
      );
      return {
        ok: !stopped,
        summary: stopped
          ? `Batch stopped at ${stopped.split(" — ")[0]}`
          : `Ran ${raw.length} browser step${raw.length === 1 ? "" : "s"}`,
        content: body,
        resource,
      };
    }

    case "task": {
      const goal = String(args.task ?? args.goal ?? args.prompt ?? "").trim();
      if (!goal) {
        return fail("A task is required, for example: open Mathway and solve 2x + 4 = 10.");
      }
      const engine = await engineHealth();
      if (!engine.ok) {
        return fail(`${engine.detail} Then call task again, or keep using navigate and click here.`);
      }
      const run = await engineTask(goal, Number(args.maxSteps ?? 25) || 25);
      if (!run.ok) return fail(run.error || "The browser engine did not finish that task.");
      return {
        ok: true,
        summary: "Browser task finished",
        content: [
          run.result || "The engine finished but wrote no final answer.",
          run.steps.length
            ? `Steps it took:\n${run.steps.slice(0, 12).join("\n")}`
            : "",
          "It ran in its own Chromium window with the local profile, not in the embedded tab.",
        ]
          .filter(Boolean)
          .join("\n\n"),
        resource,
      };
    }

    case "navigate": {
      const address = parseBrowserAddress(String(args.url ?? ""));
      if (!address.ok) return fail(address.error);
      const url = address.url;
      if (isSearchResults(url) && !/\bsearch/i.test(task)) {
        return fail(
          "That is a search-results address. The user asked you to open something, so decide the real page and navigate straight to it; only search when they actually said search.",
        );
      }
      const ok = await agentNavigate(url);
      return ok
        ? { ok: true, summary: `Opened ${url}`, content: await afterAction(`Navigated to ${url}.`), resource }
        : fail(`Could not open ${url}. Start Lantas Browser or Chrome first.`);
    }

    case "back":
    case "forward": {
      const ok = await agentHistory(action);
      return ok
        ? { ok: true, summary: `Went ${action}`, content: await afterAction(`History: ${action}.`), resource }
        : fail(`Could not go ${action}.`);
    }

    case "reload": {
      const ok = await agentReload();
      return ok
        ? { ok: true, summary: "Reloaded the page", content: await afterAction("Reloaded."), resource }
        : fail("Could not reload.");
    }

    default:
      return fail(
        `Unknown browser action ${action || "(none)"}. Use snapshot, extract, find, wait, click, click_at, hover, type, fill, select, check, evaluate, press, scroll, steps, tabs, switch_tab, new_tab, close_tab, navigate, task, open_in_chrome, back, forward or reload.`,
      );
  }
}

async function runIntegrationTool(args: Record<string, unknown>): Promise<ToolOutcome> {
  const action = String(args.action ?? "").toLowerCase();
  const resource = toolResource({ name: "integrations", args });

  if (!keyPresent()) {
    return {
      ok: false,
      summary: "Composio key missing",
      content:
        "No Composio key is saved. Ask the user to add theirs in Integrations → Marketplace, then retry.",
      resource,
    };
  }

  try {
    switch (action) {
      case "apps": {
        const toolkits = await activeToolkits();
        return {
          ok: true,
          summary: `${toolkits.length} connected app${toolkits.length === 1 ? "" : "s"}`,
          content: toolkits.length
            ? `Connected apps: ${toolkits.join(", ")}.`
            : "No apps are connected yet. The user can connect one in Integrations.",
          resource,
        };
      }

      case "inbox": {
        const limit = Math.min(300, Math.max(1, Number(args.limit ?? 40) || 40));
        const items = await fetchInbox(limit, String(args.query ?? "is:unread"));
        return {
          ok: true,
          summary: `Read ${items.length} message${items.length === 1 ? "" : "s"}`,
          content: items.length
            ? items
                .map(
                  (item, index) =>
                    `${index + 1}. ${item.subject}\n   from: ${item.from || "unknown"}\n   date: ${item.date || "unknown"}\n   id: ${item.id}\n   ${item.snippet}`,
                )
                .join("\n\n")
            : "No messages matched. The mailbox may be empty for that query.",
          resource,
        };
      }

      case "search_email": {
        const raw = String(args.query ?? "").trim();
        const query = gmailQuery(raw);
        const limit = Math.min(300, Math.max(1, Number(args.limit ?? 100) || 100));
        let items = await searchEmails(query, limit);
        let widened = false;
        // A name search can be narrower than the mail actually is (display name
        // vs. address). Looking once more with the words alone finds the rest
        // instead of reporting an empty mailbox.
        if (!items.length && query !== raw) {
          items = await searchEmails(raw, limit);
          widened = true;
        }
        return {
          ok: true,
          summary: `${items.length} message${items.length === 1 ? "" : "s"} for ${raw || query}`,
          content: items.length
            ? `Query: ${query}${widened ? ` (widened to ${raw})` : ""}\n\n` +
              items
                .map(
                  (item, index) =>
                    `${index + 1}. ${item.subject}\n   from: ${item.from || "unknown"}\n   date: ${item.date || "unknown"}\n   id: ${item.id}\n   ${item.snippet}`,
                )
                .join("\n\n")
            : `No messages matched “${raw}” (Gmail query: ${query}). Try inbox with {"query":"in:anywhere ${raw}"} before telling the user there is nothing there.`,
          resource,
        };
      }

      case "tools": {
        const toolkit = String(args.toolkit ?? "");
        if (!toolkit) {
          return {
            ok: false,
            summary: "A toolkit is required",
            content: "Pass the toolkit slug, for example gmail or slack.",
            resource,
          };
        }
        const tools = await listToolkitTools(toolkit);
        return {
          ok: true,
          summary: `${tools.length} ${toolkit} tools`,
          content: tools.length
            ? tools.map((tool) => `${tool.slug} — ${tool.description}`).join("\n")
            : `${toolkit} exposes no tools, or the app is not available on this Composio project.`,
          resource,
        };
      }

      case "run": {
        const slug = String(args.slug ?? "");
        if (!slug) {
          return {
            ok: false,
            summary: "A tool slug is required",
            content: "Pass the exact Composio tool slug from the tools action.",
            resource,
          };
        }
        const payload =
          args.arguments && typeof args.arguments === "object"
            ? (args.arguments as Record<string, unknown>)
            : {};
        const data = await executeTool(slug, payload);
        return {
          ok: true,
          summary: `Ran ${slug}`,
          content: truncate(JSON.stringify(data, null, 2), 20_000),
          resource: slug,
        };
      }

      default:
        return {
          ok: false,
          summary: `Unknown integration action ${action || "(none)"}`,
          content:
            "Use apps, tools, inbox, search_email or run. Never guess a tool slug; list tools for the app first.",
          resource,
        };
    }
  } catch (error) {
    return {
      ok: false,
      summary: error instanceof Error ? error.message.slice(0, 160) : String(error),
      content: `Integration call failed: ${error instanceof Error ? error.message : String(error)}`,
      resource,
    };
  }
}

/** The part of the tool contract the model reads, before any call. */
export const TOOL_MANUAL = [
  "You have tools. Use them instead of guessing about files, the browser or connected apps.",
  "",
  "Call a tool by writing exactly this on its own lines:",
  '<tool_call>{"name":"read","arguments":{"path":"src/App.tsx"}}</tool_call>',
  "You may write one short sentence before a call. After the result arrives, continue the task. Do not describe the call as done before you see the result.",
  "If a tool fails, read the error and change the arguments. Do not repeat the same failing call.",
  "",
  "Tools:",
  '- read {"path","offset?","limit?"} — a text file with line numbers. Read before editing.',
  '- glob {"pattern"} — find paths, e.g. {"pattern":"src/**/*.tsx"}.',
  '- grep {"pattern","path?","limit?"} — regex search with path:line results.\n  - semantic_search {"query","limit?"} — find the files that implement a concept when you do not know the identifier, e.g. {"query":"authentication handler"}.',
  '- write {"path","content"} — create or replace a whole file.',
  '- edit {"path","oldString","newString","replaceAll?"} — exact replacement; oldString must be unique.',
  '- skill {"name"} — load the full instructions of an enabled skill when the task matches it.',
  '- settings {"action","value"?,"flag"?,"panel"?} — the app itself: get, theme {"value":"light|dark|system"}, flag {"flag":"reduceMotion|notifications|sendOnEnter","value":true|false}, open {"panel":"appearance|providers|models|agents|permissions|general"}. Use it when the user asks for a change in how Lantas looks or behaves; it applies at once, so confirm in one line instead of telling them to open Settings.',
  '- terminal {"command","timeoutMs?"} — run a command in the open workspace and return its real stdout and stderr. Use this for tests, builds and shell commands. Never claim a command ran without a terminal result.',
  '- git {"action","message?","path?","branch?","remote?","staged?"} — real git in the open repository. status, diff, log, show, add, commit {"message"}, pull (fast-forward only), push, checkout {"name"}. Every call returns git output. Commit, pull and push change the repository, so they ask first unless the user is on Auto. Never force push, never reset, and never claim a push landed without a successful result.',
  '- preview {"action":"start|open","command?","url?","port?"} — run the project (default `npm run dev`), wait for the port, and open it in Lantas\' own browser panel so the user sees the app inside the app. Use this after building a web app: start it, then check the page with the browser tool at the same URL.',
  '- browser {"action",...} — actions: snapshot, extract, screenshot, find {"query"}, wait {"text","timeoutMs?","gone?"}, click {"target"|"ref"}, click_at {"x","y"}, hover {"target"}, type/fill {"text","selector?","submit?"}, select {"target","value"}, check {"target","checked?"}, execute {"code","timeoutMs?","screenshot?"}, evaluate {"code"}, press {"key"}, scroll {"dy"}, steps {"steps":[...]}, tabs, switch_tab {"id"|"index"}, new_tab {"url"}, close_tab {"id"|"index"}, navigate {"url"}, task {"task","maxSteps?"}, open_in_chrome {"url"}, back, forward, reload.',
  "- browser execute is the unbounded browser step: write async JavaScript for the live page (`await`, loops, `fetch`, `return` a compact value) and get the value plus console logs back. The page session stays alive, so a later execute sees the same tab, cookies and DOM. Use it instead of many single actions when the work is mechanical, and add \"screenshot\":true when you also need to see the result.",
  "- browser screenshot returns the page as an image you can see. Take one for layout, canvas or overlay questions, or when the DOM says something happened but the page looks wrong.",
  '- browser steps batches up to 12 actions into one call and returns one fresh snapshot at the end: {"action":"steps","steps":[{"action":"click","ref":12},{"action":"type","text":"2x + 4"},{"action":"press","key":"Enter"}]}. Use it when you already know the sequence, so a task does not lose the thread between round trips. Element refs come from a fresh snapshot and stay tied to their element; a ref that is gone fails instead of clicking whatever took its place.',
  "- browser task hands the whole job to the local browser-use engine in its own Chromium (trusted input, real downloads, saved logins). Prefer it for \"open X and do Y\" requests that span pages; use the single actions when you need to stay in the embedded tab. If it reports that no engine is running, tell the user to run bash engine/run.sh once and keep going with single actions.",
  "",
  BROWSER_GUIDE,
  '- integrations {"action",...} — apps, tools {"toolkit"}, inbox {"limit","query"}, search_email {"query","limit"}, run {"slug","arguments"}.',
  "- inbox reads up to 300 messages by paging Composio's cursor, and search_email the same. When the user asks what is in their mail, ask for enough: limit 50 to 100 covers a normal day, 200 when they say everything or a whole week. Never summarize from a single page of 10 if the question is about what needs attention; read broadly, then group the results.",
  '- Finding mail from one person: call search_email with just their name or address, limit 100. The app builds from:/to: itself. If that returns nothing, call inbox with {"query":"in:anywhere <their name>","limit":200} before saying there is no mail; search only the inbox and you will miss archived threads, which is the most common false negative.',
  '- deliver {"name","format?","content?","files?"} — build a file the user can download: txt, md, csv, json, html, svg, pdf, or zip (pass files: [{"name","content"}] for a zip). The format is inferred from the name when omitted. Use it for any "make me a …", "export", "write a report" or "bundle these files" request instead of pasting the whole thing into chat.',
  "",
  "Rules:",
  "- Paths are relative to the workspace root. An absolute path reads or creates a file anywhere else on the machine, which the user has allowed; writes still require approval unless auto mode is on.",
  "- An absolute image path (png, jpg, webp, gif) is returned as pixels to a vision model. Look at it; do not describe it from the filename.",
  "- Prefer read and grep over inventing file contents. Quote real code when you explain it.",
  "- Keep edits minimal and in the project's existing style.",
  "- When you change a web app, start its preview and check the page it opens before saying it works. The preview stays in front of the user.",
  "- When the user asks about their mail, use integrations; ask for a search query rather than assuming the mailbox is only six messages.",
  "- You can create files: when the user asks for a document, spreadsheet, export or bundle, call deliver. Never reply that you cannot make files or downloads.",
  "- Never paste a page's whole contents into the chat as a code block. Code the user asked for belongs on disk: call write to create it, then edit to change it, and tell them which file you wrote. A wall of code in the reply is not a saved change.",
  "- If there is no workspace folder open, you can still read or create an absolute path the user names. Otherwise say in one line that a folder is needed; do not dump a file into the chat as a substitute.",
  "- Finish with a short answer that states what you changed and what you verified. If you could not verify something, say so.",
].join("\n");
