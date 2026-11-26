import { recordAudit } from "./audit";
import { decide, type PermissionEffect, type PermissionRule } from "./permissions";
import {
  canSeeImages,
  streamChat,
  type ChatImage,
  type ChatTurn,
  type StreamUsage,
} from "./providers";
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
/** A browser call written without tags: `browsertype {`, `browsesteps {`. */
const CALL = /(?<![A-Za-z0-9_.])brows(?:er|e)?[a-z0-9_.]{0,20}[ \t]*\{/i;
/** The same name at the end of the text, still waiting for its `{`. */
const PARTIAL = /(?<![A-Za-z0-9_.])brows(?:er|e)?[a-z0-9_.]{0,20}[ \t]*$/i;

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
  /** Separate thinking stream; never mixed into the visible answer. */
  onReasoning?: (delta: string) => void;
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
    if (typeof args === "string") args = safeJson(args);

    // A model that writes `browsertype {…}` or `browser.type {…}` means the
    // browser tool with the action glued to its name. The old parser dropped
    // that call, so "type 2x+4 into the box" typed nothing and the turn ended.
    const glued = name ? asBrowserCall(name) : null;
    if (glued) {
      name = "browser";
      args = { ...(args as Record<string, unknown>), action: glued };
    }

    // A browser call with no action still names itself by its arguments.
    if (name.toLowerCase() === "browser" && !String((args as Record<string, unknown>).action ?? "")) {
      const keys = Object.keys(args as Record<string, unknown>);
      if (keys.includes("steps")) (args as Record<string, unknown>).action = "steps";
      else if (keys.includes("task")) (args as Record<string, unknown>).action = "task";
      else if (keys.some((key) => key === "text" || key === "value")) {
        (args as Record<string, unknown>).action = "type";
      }
    }
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
    calls.push({ name, args: args as Record<string, unknown> });
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

  // A model can also put the tool name straight against its JSON with no tags
  // at all: `browsertype {"text":"2x+4"}`. That reads as prose to every rule
  // above, which is what made a browser command vanish.
  //
  // This runs even when tagged calls were found, and it does not require a
  // line break before the name: models write two calls back to back on one
  // line (`browsernavigate {…}browsesteps {…}`), and the old line-anchored scan
  // saw only the first one, so the batch never ran.
  {
    const glued = /(brows[a-z0-9_.]{0,26})[ \t]*(\{)/gi;
    let hit: RegExpExecArray | null;
    while ((hit = glued.exec(raw))) {
      const nameStart = hit.index;
      // Not the tail of a longer word or identifier.
      const before = raw[nameStart - 1] ?? "";
      if (before && /[A-Za-z0-9_.]/.test(before)) continue;
      const taken = blocks.some(([start, end]) => nameStart >= start && nameStart < end);
      if (taken) continue;
      const action = asBrowserCall(hit[1]);
      if (!action) continue;
      const braceAt = hit.index + hit[0].length - 1;
      const read = readJson(raw, braceAt);
      if (!read || !read.value || typeof read.value !== "object" || Array.isArray(read.value)) {
        continue;
      }
      calls.push({
        name: "browser",
        args: { ...(read.value as Record<string, unknown>), action },
      });
      blocks.push([nameStart, read.end]);
      // Continue after this JSON so a second call on the same line is found.
      glued.lastIndex = Math.max(hit.index + hit[0].length, read.end);
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

/**
 * `browsertype`, `browser_type`, `browser.type`, `browserclick`: the action
 * suffix of a tool name a model glued together. Returns the action, or null
 * when the name is not the browser tool.
 */
function asBrowserCall(name: string): string | null {
  const squash = name.toLowerCase().replace(/[^a-z]/g, "");
  // Models shorten the tool as well as glue the action on: `browsesteps` is
  // "browse" + "steps", `browsernavigate` is "browser" + "navigate".
  const head = /^brows(?:er|e)?(.*)$/.exec(squash);
  if (!head) return null;
  const tail = head[1];
  if (!tail) return null;
  if (BROWSER_ACTIONS.has(tail)) return tail;
  // Models build the name out of parts: `browsertypesteps`, `browserclickat`,
  // `browser_steps`. An exact match above was the only thing recognised, so a
  // batch written that way was not a call at all and the task did nothing.
  if (tail.includes("steps")) return "steps";
  let best = "";
  for (const action of BROWSER_ACTIONS) {
    const flat = action.replace(/[^a-z]/g, "");
    if (flat.length > best.length && tail.includes(flat)) best = action;
  }
  return best || null;
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
  "execute",
  "js",
  "screenshot",
  "open_in_chrome",
  "steps",
  "run",
  "task",
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
/**
 * Streams the model's prose into the transcript while hiding tool calls.
 *
 * Tagged blocks were already hidden; a call written without tags was not, so
 * `browsernavigate {…}` and the batch behind it showed up in the reply as JSON
 * even when the first one had run. Anything shaped like a browser call is held
 * back until its JSON closes, then dropped.
 */
export class ToolStream {
  private buffer = "";
  /** Inside a call's JSON. */
  private inside = false;
  private depth = 0;
  private inString = false;
  private escaped = false;
  private seen = 0;

  constructor(private readonly emit: (text: string) => void) {}

  push(chunk: string) {
    this.buffer += chunk;
    this.drain(false);
  }

  end() {
    this.drain(true);
  }

  /** Index of the `}`/`]` that closes the JSON we are inside, or -1. */
  private closeAt(): number {
    for (let index = this.seen; index < this.buffer.length; index += 1) {
      const ch = this.buffer[index];
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (ch === "\\") this.escaped = true;
        else if (ch === '"') this.inString = false;
        continue;
      }
      if (ch === '"') {
        this.inString = true;
        continue;
      }
      if (ch === "{" || ch === "[") this.depth += 1;
      else if (ch === "}" || ch === "]") {
        this.depth -= 1;
        if (this.depth === 0) return index;
      }
    }
    this.seen = this.buffer.length;
    return -1;
  }

  private drain(final: boolean) {
    while (this.buffer) {
      if (this.inside) {
        const close = this.closeAt();
        if (close < 0) {
          // Wait for the rest of the JSON. An unterminated call at the end of a
          // reply is still a call, so the final pass drops it either way.
          if (!final) return;
          this.buffer = "";
          this.inside = false;
          return;
        }
        this.buffer = this.buffer.slice(close + 1);
        this.seen = 0;
        this.depth = 0;
        this.inString = false;
        this.escaped = false;
        this.inside = false;
        continue;
      }

      const call = CALL.exec(this.buffer);
      const tag = this.buffer.indexOf(OPEN);

      if (call && (tag < 0 || call.index < tag)) {
        if (call.index > 0) this.emit(this.buffer.slice(0, call.index));
        this.buffer = this.buffer.slice(call.index + call[0].length - 1);
        this.inside = true;
        this.seen = 0;
        this.depth = 0;
        this.inString = false;
        this.escaped = false;
        continue;
      }

      if (tag >= 0) {
        if (tag > 0) this.emit(this.buffer.slice(0, tag));
        const close = this.buffer.indexOf(CLOSE, tag);
        if (close < 0) {
          this.buffer = this.buffer.slice(tag);
          return;
        }
        this.buffer = this.buffer.slice(close + CLOSE.length);
        continue;
      }

      if (final) {
        this.emit(this.buffer);
        this.buffer = "";
        return;
      }

      // Hold back a suffix that could still turn into a tag or a call name.
      let keep = 0;
      const partial = PARTIAL.exec(this.buffer);
      if (partial) keep = this.buffer.length - partial.index;
      const max = Math.min(OPEN.length - 1, this.buffer.length);
      for (let size = max; size > 0; size -= 1) {
        if (this.buffer.endsWith(OPEN.slice(0, size))) {
          keep = Math.max(keep, size);
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
  const seesImages = canSeeImages(options.provider, options.model);

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
      onReasoning: options.onReasoning,
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
    const images: ChatImage[] = [];
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
        if (error instanceof DOMException && error.name === "AbortError") {
          // The stop button can land while a tool is waiting on the user or
          // the browser. Close its row, then let the turn end as interrupted.
          options.onToolDone(
            id,
            { ok: true, summary: "Stopped", content: "Stopped by the user.", resource },
            "done",
          );
          throw error;
        }
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
      if (outcome.images?.length && seesImages) images.push(...outcome.images.slice(0, 2));
      if (outcome.images?.length && !seesImages) {
        results.push(
          "An image was produced, but this model cannot see images. Use the text result, or browser snapshot/extract/execute instead.",
        );
      }
    }

    turns.push({
      role: "user",
      content: [
        "Tool results:",
        ...results,
        "Continue the task. If it is finished, answer the user directly with no tool call.",
      ].join("\n\n"),
      ...(images.length ? { images: images.slice(-2) } : {}),
    });

    // Screenshots are the most expensive part of the context. Keep the two the
    // model just received and drop older frames, exactly like chat history does.
    if (images.length) {
      let kept = 0;
      for (let index = turns.length - 1; index >= 0; index -= 1) {
        if (!turns[index].images?.length) continue;
        kept += 1;
        if (kept > 2) delete turns[index].images;
      }
    }

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
