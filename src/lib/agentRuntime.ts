import { recordAudit } from "./audit";
import { decide, type PermissionEffect, type PermissionRule } from "./permissions";
import { streamChat, type ChatTurn, type StreamUsage } from "./providers";
import {
  runTool,
  toolLabel,
  toolResource,
  type ToolCall,
  type ToolContext,
  type ToolOutcome,
} from "./tools";
import type { ProviderConfig, ProviderId } from "./types";
import { uid } from "./util";

/**
 * The agent loop.
 *
 * opencode runs its tools through a typed registry and a permission check
 * before every call. Lantas does the same, with one difference forced by the
 * providers we support: the tool call travels in a small text protocol instead
 * of a native `tool_calls` field, because Ollama, LM Studio and most
 * OpenAI-compatible gateways do not implement the same schema. The loop,
 * permissions and results are identical; only the wire format differs.
 */

const OPEN = "<tool_call>";
const CLOSE = "</tool_call>";

export interface ToolLoopOptions {
  provider: ProviderId;
  config: ProviderConfig;
  model: string;
  system: string;
  messages: ChatTurn[];
  ctx: ToolContext;
  rules: PermissionRule[];
  signal: AbortSignal;
  approve: (call: ToolCall, resource: string, effect: PermissionEffect) => Promise<boolean>;
  onText: (delta: string) => void;
  onToolStart: (id: string, call: ToolCall, label: string) => void;
  onToolDone: (
    id: string,
    outcome: ToolOutcome,
    state: "done" | "error",
  ) => void;
  onNote?: (text: string) => void;
  onUsage?: (usage: StreamUsage) => void;
  /** Ask whether to add more rounds when the tool budget runs out. */
  onLimit?: () => Promise<boolean>;
  maxSteps?: number;
  /** When set, only these tools may run. Used by the browser-only side panel. */
  only?: string[];
}

export interface ToolLoopResult {
  steps: number;
  toolCalls: number;
  stopped: "answer" | "limit" | "aborted";
}

/* ------------------------------------------------------------ call parsing */

export function parseToolCalls(
  raw: string,
  options: { defaultTool?: string } = {},
): { calls: ToolCall[]; text: string } {
  const calls: ToolCall[] = [];

  /**
   * Reads the first JSON value at or after `from` and reports where it ended.
   * Scanning the braces ourselves is what makes an unclosed block work: models
   * routinely stop after the final `}` and never write `</tool_call>`.
   */
  const readJson = (
    source: string,
    from: number,
  ): { value: unknown; end: number } | null => {
    let start = -1;
    for (let index = from; index < source.length; index += 1) {
      const ch = source[index];
      if (ch === "{" || ch === "[") {
        start = index;
        break;
      }
    }
    if (start < 0) return null;

    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const ch = source[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") stack.push("}");
      else if (ch === "[") stack.push("]");
      else if (ch === "}" || ch === "]") {
        if (!stack.length) break;
        stack.pop();
        if (!stack.length) {
          const value = safeParse(source.slice(start, index + 1));
          return value === undefined ? null : { value, end: index + 1 };
        }
      }
    }

    // Cut off mid-value, usually by the token limit: close what was opened and
    // keep the call instead of throwing the whole step away.
    if (stack.length) {
      const value = safeParse(source.slice(start) + stack.reverse().join(""));
      if (value !== undefined) return { value, end: source.length };
    }
    return null;
  };

  const blocks: Array<[number, number]> = [];
  const opener = /<(tool_call|tool|function_call)\b[^>]*>/gi;
  let tag: RegExpExecArray | null;

  const accept = (entry: unknown) => {
    if (!entry || typeof entry !== "object") return;
    const record = entry as Record<string, unknown>;
    const fn = record.function as Record<string, unknown> | undefined;
    let name = String(record.name ?? record.tool ?? fn?.name ?? "");
    let args =
      record.arguments ?? record.args ?? record.parameters ?? fn?.arguments ?? {};
    // Small models often drop the wrapper and send only the action object.
    // In a browser-only panel that shape is unambiguous.
    if (!name && options.defaultTool && (record.action || record.type)) {
      name = options.defaultTool;
      args = record;
    }
    // A bare action object is unambiguous in a full agent too: no other tool
    // takes an `action` key, so it can only mean the browser.
    if (!name && BROWSER_ACTIONS.has(String(record.action ?? ""))) {
      name = "browser";
      args = record;
    }
    if (!name) return;
    calls.push({
      name,
      args: typeof args === "string" ? safeJson(args) : (args as Record<string, unknown>),
    });
  };

  while ((tag = opener.exec(raw))) {
    const read = readJson(raw, tag.index + tag[0].length);
    if (!read) continue;
    const entries = Array.isArray(read.value) ? read.value : [read.value];
    const before = calls.length;
    for (const entry of entries) accept(entry);
    if (calls.length === before) continue;

    // Take the closing tag only when it sits right after the JSON; prose that
    // follows the call belongs to the visible answer.
    let end = read.end;
    const rest = raw.slice(end);
    const closing = new RegExp(`</${tag[1]}>`, "i").exec(rest);
    if (closing && closing.index < 200) end += closing.index + closing[0].length;
    blocks.push([tag.index, end]);
    opener.lastIndex = end;
  }

  // Some providers strip the tags or the model forgets them. A bare object is
  // still a call when it names its tool, or when this panel has only one.
  if (!calls.length) {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    const source = fenced && fenced.includes("{") ? fenced : raw;
    const read = readJson(source, 0);
    if (read) {
      const entries = Array.isArray(read.value) ? read.value : [read.value];
      const before = calls.length;
      for (const entry of entries) accept(entry);
      if (calls.length > before) {
        const at = raw.indexOf(source);
        if (at >= 0) blocks.push([at, at + source.length]);
      }
    }
  }

  // Remove every accepted block, tag and all, so raw JSON never reaches the
  // transcript even when the model wrote prose around it.
  let text = raw;
  if (blocks.length) {
    const parts: string[] = [];
    let cursor = 0;
    for (const [start, end] of blocks.sort((a, b) => a[0] - b[0])) {
      if (start > cursor) parts.push(raw.slice(cursor, start));
      cursor = Math.max(cursor, end);
    }
    if (cursor < raw.length) parts.push(raw.slice(cursor));
    text = parts.join("");
  }

  return {
    calls,
    text: text.replace(/<\/\s*(tool_call|tool|function_call)\s*>/gi, "").trim(),
  };
}

/** The actions the browser tool understands, used to recognise a bare call. */
const BROWSER_ACTIONS = new Set([
  "navigate",
  "snapshot",
  "extract",
  "find",
  "wait",
  "click",
  "click_at",
  "hover",
  "type",
  "fill",
  "select",
  "check",
  "press",
  "enter",
  "scroll",
  "tabs",
  "switch_tab",
  "new_tab",
  "close_tab",
  "back",
  "forward",
  "reload",
  "evaluate",
  "open_in_chrome",
]);

/** JSON with one common model slip repaired: a trailing comma. */
function safeParse(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  try {
    return JSON.parse(trimmed.replace(/,\s*([}\]])/g, "$1"));
  } catch {
    return undefined;
  }
}

function safeJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Streams text to the user while withholding just enough of the tail that a
 * half-written ` <tool_call>` never flashes on screen. Complete blocks are
 * removed from the visible stream and collected for execution.
 */
class ToolStream {
  private buffer = "";

  constructor(private readonly emit: (text: string) => void) {}

  push(chunk: string) {
    this.buffer += chunk;
    this.drain();
  }

  end() {
    // A block whose closing tag never arrived still has to run, not appear.
    // Flushing this buffer is what printed raw JSON in the transcript.
    const start = this.buffer.indexOf(OPEN);
    if (start >= 0) {
      if (start > 0) this.emit(this.buffer.slice(0, start));
      this.buffer = "";
      return;
    }
    this.drain(true);
    if (this.buffer) {
      this.emit(this.buffer);
      this.buffer = "";
    }
  }

  private drain(final = false) {
    while (true) {
      const start = this.buffer.indexOf(OPEN);
      if (start === -1) {
        if (final) return;
        // Hold back a suffix that could still become the opening tag.
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

/* -------------------------------------------------------------------- loop */

/**
 * Runs one assistant turn. Returns after the model answers without a tool call,
 * or after `maxSteps` rounds. Every tool is permission-checked first; `ask`
 * blocks on the caller's approval sheet.
 */
export async function runToolLoop(options: ToolLoopOptions): Promise<ToolLoopResult> {
  const maxSteps = Math.max(1, options.maxSteps ?? 6);
  let budget = maxSteps;
  const turns: ChatTurn[] = [...options.messages];
  // Signature -> the step it ran in and what it returned. Reading the same
  // file again after an edit is legitimate; repeating an identical call inside
  // one model response, or retrying one that failed, is not.
  const seen = new Map<string, { outcome: ToolOutcome; step: number }>();
  let toolCalls = 0;
  let parseRetries = 0;

  for (let step = 0; step < budget; step += 1) {
    if (options.signal.aborted) throw new DOMException("aborted", "AbortError");

    let raw = "";
    const stream = new ToolStream(options.onText);
    await streamChat({
      provider: options.provider,
      config: options.config,
      model: options.model,
      system: options.system,
      messages: turns,
      signal: options.signal,
      onDelta: (chunk) => {
        raw += chunk;
        stream.push(chunk);
      },
      onUsage: options.onUsage,
    });
    stream.end();

    if (options.signal.aborted) throw new DOMException("aborted", "AbortError");

    const parsed = parseToolCalls(raw, {
      defaultTool: options.only?.length === 1 ? options.only[0] : undefined,
    });
    if (parsed.calls.length === 0) {
      // A reply that clearly tried to call a tool must not end the turn as if
      // it were an answer; that is how "open mathway" produced nothing but a
      // raw JSON line. Ask once for a clean block, then let it answer.
      const tried =
        /<\s*(tool_call|tool|function_call)\b/i.test(raw) ||
        (Boolean(options.only?.length === 1) && /"name"\s*:/i.test(raw));
      if (tried && parseRetries < 1) {
        parseRetries += 1;
        turns.push({ role: "assistant", content: raw.slice(0, 16_000) });
        turns.push({
          role: "user",
          content: [
            "That reply contained a tool call the app could not read, so nothing ran.",
            'Send exactly one complete block, valid JSON, no prose around it:',
            '<tool_call>{"name":"browser","arguments":{"action":"navigate","url":"https://www.mathway.com"}}</tool_call>',
          ].join("\n\n"),
        });
        options.onNote?.("The tool call did not read cleanly; asking the model again.");
        continue;
      }
      return { steps: step + 1, toolCalls, stopped: "answer" };
    }

    turns.push({ role: "assistant", content: raw.slice(0, 16_000) });

    const results: string[] = [];
    for (const call of parsed.calls) {
      const resource = toolResource(call);
      const decision = decide(options.rules, call.name, resource);
      const id = uid("tool");
      toolCalls += 1;

      if (options.only && !options.only.includes(call.name)) {
        const outcome: ToolOutcome = {
          ok: false,
          summary: `${call.name} is not available here`,
          content: `Only these tools are available in this panel: ${options.only.join(", ")}. Use one of them or answer the user.`,
          resource,
        };
        options.onToolStart(id, call, `${toolLabel(call)} · unavailable`);
        options.onToolDone(id, outcome, "error");
        results.push(encodeResult(call, outcome));
        continue;
      }

      if (decision.effect === "deny") {
        recordAudit({ tool: call.name, resource, decision: "denied" });
        const outcome: ToolOutcome = {
          ok: false,
          summary: `${call.name} is blocked by a permission rule`,
          content: `Permission denied for ${call.name} on ${resource}. The current agent or settings do not allow it. Explain this to the user instead of retrying.`,
          resource,
        };
        options.onToolStart(id, call, `${toolLabel(call)} · blocked`);
        options.onToolDone(id, outcome, "error");
        results.push(encodeResult(call, outcome));
        continue;
      }

      if (decision.effect === "ask") {
        const allowed = await options.approve(call, resource, decision.effect);
        recordAudit({ tool: call.name, resource, decision: allowed ? "allowed" : "denied" });
        if (!allowed) {
          const outcome: ToolOutcome = {
            ok: false,
            summary: `${call.name} was not approved`,
            content: `The user declined ${call.name} on ${resource}. Do not retry it; continue without it or ask what they prefer.`,
            resource,
          };
          options.onToolStart(id, call, `${toolLabel(call)} · declined`);
          options.onToolDone(id, outcome, "error");
          results.push(encodeResult(call, outcome));
          continue;
        }
      }

      if (
        decision.effect === "allow" &&
        !["read", "glob", "grep", "semantic_search", "skill", "todo"].includes(call.name)
      ) {
        recordAudit({ tool: call.name, resource, decision: "allowed" });
      }

      // Repeat guard: identical arguments almost always mean the model is
      // stuck, and a destructive tool should never run twice by accident.
      const signature = `${call.name}:${JSON.stringify(call.args)}`;
      const previous = seen.get(signature);
      const repeat = previous && (previous.step === step || !previous.outcome.ok);
      if (previous && repeat) {
        options.onToolStart(id, call, `${toolLabel(call)} · repeated`);
        options.onToolDone(
          id,
          {
            ...previous.outcome,
            ok: false,
            summary: `${previous.outcome.summary} (already ran)`,
            content: `This exact call already ran in this turn. Its result is above; do not repeat it. Change the arguments or answer with what you have.`,
          },
          "error",
        );
        results.push(
          encodeResult(call, {
            ok: false,
            summary: "Already ran",
            content:
              "You already ran this exact call in this turn. Use the earlier result, change the arguments, or answer.",
            resource,
          }),
        );
        continue;
      }

      options.onToolStart(id, call, toolLabel(call));
      let outcome: ToolOutcome;
      try {
        outcome = await runTool(call, options.ctx);
      } catch (error) {
        outcome = {
          ok: false,
          summary: error instanceof Error ? error.message : String(error),
          content: `Tool threw: ${error instanceof Error ? error.message : String(error)}`,
          resource,
        };
      }
      seen.set(signature, { outcome, step });
      options.onToolDone(id, outcome, outcome.ok ? "done" : "error");
      results.push(encodeResult(call, outcome));
    }

    turns.push({
      role: "user",
      content: [
        "Tool results:",
        ...results,
        "Continue the task. If it is finished, answer the user directly with no tool call.",
      ].join("\n\n"),
    });

    if (step === budget - 1 && options.onLimit && (await options.onLimit())) {
      budget += 6;
    }
  }

  options.onNote?.(
    `Stopped after ${budget} tool rounds. The work above is real; ask for a narrower next step if something is still missing.`,
  );

  return { steps: budget, toolCalls, stopped: "limit" };
}

function encodeResult(call: ToolCall, outcome: ToolOutcome): string {
  return `<tool_result name="${call.name}" ok="${outcome.ok}">\n${outcome.content.slice(0, 24_000)}\n</tool_result>`;
}
