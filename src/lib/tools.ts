import type { AgentId, DiffLine, Skill, WorkspaceFile } from "./types";
import { languageFor } from "./workspace";
import {
  agentClick,
  agentClickRef,
  agentEnter,
  agentHistory,
  agentNavigate,
  agentPress,
  agentReload,
  agentScroll,
  agentSnapshot,
  agentType,
  describeSnapshot,
} from "./browserAgent";
import { aiDriving } from "./el";
import { runTerminalCommand } from "./terminal";
import {
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
 * Modelled on opencode's built-ins (`read`, `glob`, `grep`, `write`, `edit`,
 * `skill`) and its permission model: a tool gets a small typed argument object,
 * returns model-facing text plus an optional UI event, and never reaches
 * outside the workspace the user opened. Browser and integration tools use the
 * same contract so one approval path covers all of them.
 */

export interface ToolContext {
  files: WorkspaceFile[];
  root: string;
  agent: AgentId;
  skills: Skill[];
  /** Writes to disk; resolves false when the workspace is read-only. */
  saveFile: (path: string, text: string) => Promise<boolean>;
  /** Overrides the browser drive switch for one turn (the Chrome panel's Act mode). */
  drive?: boolean;
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
  /** Resource the permission engine should check. */
  resource: string;
}

export const TOOL_NAMES = [
  "read",
  "glob",
  "grep",
  "write",
  "edit",
  "skill",
  "terminal",
  "browser",
  "integrations",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** Shown in the transcript while a tool runs. */
export const TOOL_LABELS: Record<string, string> = {
  read: "Read file",
  glob: "Find files",
  grep: "Search code",
  write: "Write file",
  edit: "Edit file",
  skill: "Load skill",
  terminal: "Terminal",
  browser: "Browser",
  integrations: "Connected apps",
};

export function toolLabel(call: ToolCall): string {
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
  return String(call.args.path ?? call.args.pattern ?? call.args.name ?? "*");
}

function normalizePath(raw: unknown): string {
  const value = String(raw ?? "").replace(/\\/g, "/").trim();
  if (!value) throw new Error("A path is required.");
  if (value.startsWith("/") || /^[A-Za-z]:\//.test(value)) {
    throw new Error("Use a path relative to the open workspace, not an absolute path.");
  }
  const parts = value.split("/").filter((part) => part && part !== ".");
  if (parts.some((part) => part === "..")) {
    throw new Error("That path leaves the workspace.");
  }
  return parts.join("/");
}

function findFile(files: WorkspaceFile[], path: string): WorkspaceFile | undefined {
  const exact = files.find((file) => file.path === path);
  if (exact) return exact;
  const suffix = files.filter((file) => file.path.endsWith(`/${path}`));
  if (suffix.length === 1) return suffix[0];
  return undefined;
}

function truncate(text: string, limit = 24_000): string {
  return text.length > limit ? `${text.slice(0, limit)}\n…[truncated]` : text;
}

/** Minimal line diff for the transcript. Good enough to show what changed. */
function diffLines(before: string, after: string): { lines: DiffLine[]; added: number; removed: number } {
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

  try {
    switch (call.name) {
      case "read": {
        const path = normalizePath(call.args.path);
        const file = findFile(files, path);
        if (!file) {
          return {
            ok: false,
            summary: `No file at ${path}`,
            content: `No file matches ${path}. Use glob to find the right path.`,
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
        const offset = Math.max(0, Number(call.args.offset ?? 0) || 0);
        const limit = Math.min(2000, Math.max(1, Number(call.args.limit ?? 400) || 400));
        const all = file.text.split("\n");
        const slice = all.slice(offset, offset + limit);
        const numbered = slice
          .map((line, index) => `${String(offset + index + 1).padStart(5)} | ${line}`)
          .join("\n");
        return {
          ok: true,
          summary: `${file.path} · ${slice.length} lines`,
          content: truncate(
            `${file.path} (${languageFor(file.path)}, ${all.length} lines)${
              offset || limit < all.length ? `, lines ${offset + 1}–${offset + slice.length}` : ""
            }\n${numbered}`,
          ),
          resource: file.path,
        };
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
          content: hits.length ? hits.join("\n") : `No match for ${pattern} in this workspace.`,
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
        const path = normalizePath(call.args.path);
        const text = String(call.args.content ?? "");
        const existing = findFile(files, path);
        const before = existing?.text ?? "";
        const saved = await context.saveFile(path, text);
        const diff = diffLines(before, text);
        return {
          ok: true,
          summary: `${existing ? "Updated" : "Created"} ${path} (+${diff.added} −${diff.removed})`,
          content: `${existing ? "Updated" : "Created"} ${path} (${text.split("\n").length} lines)${
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
        const path = normalizePath(call.args.path);
        const file = findFile(files, path);
        if (!file) {
          return {
            ok: false,
            summary: `No file at ${path}`,
            content: `No file matches ${path}. Read or glob first.`,
            resource: path,
          };
        }
        const oldString = String(call.args.oldString ?? "");
        const newString = String(call.args.newString ?? "");
        if (!oldString) throw new Error("oldString is required for edit.");
        const occurrences = file.text.split(oldString).length - 1;
        if (occurrences === 0) {
          return {
            ok: false,
            summary: `oldString not found in ${file.path}`,
            content:
              "That exact text is not in the file. Read the current file and copy the text verbatim, including indentation.",
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
        return {
          ok: true,
          summary: `Edited ${file.path} (+${diff.added} −${diff.removed})`,
          content: `Edited ${file.path}.${
            saved ? "" : " The workspace copy is updated but disk could not be written."
          }`,
          diff: { path: file.path, added: diff.added, removed: diff.removed, lines: diff.lines },
          changed: { path: file.path, text: next },
          resource: file.path,
        };
      }

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

      case "browser":
        return await runBrowserTool(call.args, context.drive);

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
    return {
      ok: false,
      summary: error instanceof Error ? error.message : String(error),
      content: `Tool failed: ${error instanceof Error ? error.message : String(error)}`,
      resource: toolResource(call),
    };
  }
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
    const result = await runTerminalCommand(context.root, command, timeoutMs);
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

async function runBrowserTool(
  args: Record<string, unknown>,
  drive?: boolean,
): Promise<ToolOutcome> {
  const action = String(args.action ?? "").toLowerCase();
  const resource = toolResource({ name: "browser", args });

  const fail = (summary: string): ToolOutcome => ({
    ok: false,
    summary,
    content: summary,
    resource,
  });

  const readOnly = action === "snapshot" || action === "extract";
  if (!readOnly && !(drive ?? aiDriving())) {
    return fail(
      "The user has control of the browser. Ask them to switch to Act mode before changing the page.",
    );
  }

  /**
   * A cheap model needs to see the page after an action, not guess. Append the
   * new URL, title and control map to the tool result so the next step has
   * current references without spending a second call on snapshot.
   */
  const afterAction = async (base: string): Promise<string> => {
    try {
      const snapshot = await agentSnapshot();
      if (!snapshot.page) return base;
      const controls = snapshot.elements
        .slice(0, 80)
        .map((el) => `${el.i}. [${el.kind}] ${el.label}`)
        .join("\n");
      const verifiedState = snapshot.page.text
        .split("\n")
        .find((line) => line.startsWith("Graph expressions:"));
      return [
        base,
        `Now at: ${snapshot.page.url}`,
        `Title: ${snapshot.page.title}`,
        verifiedState ? `Page state: ${verifiedState.slice(0, 800)}` : "",
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

    case "click": {
      if (typeof args.ref === "number" || typeof args.ref === "string") {
        const ok = await agentClickRef(Number(args.ref));
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

    case "type": {
      const text = String(args.text ?? "");
      if (!text && !args.clear) return fail("Text is required.");
      const ok = await agentType(
        text,
        typeof args.selector === "string" ? args.selector : undefined,
        Boolean(args.submit),
      );
      return ok
        ? {
            ok: true,
            summary: args.submit ? "Typed and submitted" : "Typed into the page",
            content: await afterAction("Typed into the page."),
            resource,
          }
        : fail("No editable field was found. Click the field or expression row first, then type.");
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

    case "navigate": {
      const url = String(args.url ?? "");
      if (!url) return fail("A URL is required.");
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
        `Unknown browser action ${action || "(none)"}. Use snapshot, extract, click, type, press, scroll, navigate, back, forward or reload.`,
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
        const limit = Math.min(100, Math.max(1, Number(args.limit ?? 25) || 25));
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
        const query = String(args.query ?? "");
        const limit = Math.min(100, Math.max(1, Number(args.limit ?? 25) || 25));
        const items = await searchEmails(query, limit);
        return {
          ok: true,
          summary: `${items.length} message${items.length === 1 ? "" : "s"} for ${query}`,
          content: items.length
            ? items
                .map(
                  (item, index) =>
                    `${index + 1}. ${item.subject}\n   from: ${item.from || "unknown"}\n   date: ${item.date || "unknown"}\n   id: ${item.id}\n   ${item.snippet}`,
                )
                .join("\n\n")
            : `No messages matched “${query}”.`,
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
  '- grep {"pattern","path?","limit?"} — regex search with path:line results.',
  '- write {"path","content"} — create or replace a whole file.',
  '- edit {"path","oldString","newString","replaceAll?"} — exact replacement; oldString must be unique.',
  '- skill {"name"} — load the full instructions of an enabled skill when the task matches it.',
  '- terminal {"command","timeoutMs?"} — run a command in the open workspace and return its real stdout and stderr. Use this for tests, builds, git and shell commands. Never claim a command ran without a terminal result.',
  '- browser {"action",...} — actions: snapshot, extract, click {"target"|"ref"}, type {"text","selector?","submit?"}, press {"key"}, scroll {"dy"}, navigate {"url"}, back, forward, reload.',
  "",
  "Browser workflow: when the user asks you to open, graph, fill, search, click or otherwise use a website, do it with the browser tool. Start with navigate, then snapshot. Click a control by its ref from that snapshot; type with no selector to use the focused field. After every action, read the returned URL, title and controls and verify the result before claiming it worked. For a graphing calculator, open the calculator, snapshot, click the expression row, type the equation, then snapshot again and look for the equation in the controls.",
  '- integrations {"action",...} — apps, tools {"toolkit"}, inbox {"limit","query"}, search_email {"query","limit"}, run {"slug","arguments"}.',
  "",
  "Rules:",
  "- Paths are relative to the workspace root. Never use absolute paths or ..",
  "- Prefer read and grep over inventing file contents. Quote real code when you explain it.",
  "- Keep edits minimal and in the project's existing style.",
  "- When the user asks about their mail, use integrations; ask for a search query rather than assuming the mailbox is only six messages.",
  "- Finish with a short answer that states what you changed and what you verified. If you could not verify something, say so.",
].join("\n");
