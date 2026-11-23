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
  maxSteps?: number;
}

export interface ToolLoopResult {
  steps: number;
  toolCalls: number;
  stopped: "answer" | "limit" | "aborted";
}

/* ------------------------------------------------------------ call parsing */

export function parseToolCalls(raw: string): { calls: ToolCall[]; text: string } {
  const pattern = /<(tool_call|tool|function_call)>\s*([\s\S]*?)\s*<\/\1>/gi;
  const calls: ToolCall[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(raw))) {
    const body = match[2]
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim();
    try {
      const parsed = JSON.parse(body);
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of entries) {
        const name = String(entry?.name ?? entry?.tool ?? entry?.function?.name ?? "");
        const args =
          entry?.arguments ??
          entry?.args ??
          entry?.parameters ??
          entry?.function?.arguments ??
          {};
        if (!name) continue;
        calls.push({
          name,
          args: typeof args === "string" ? safeJson(args) : (args as Record<string, unknown>),
        });
      }
    } catch {
      /* A malformed call is reported back to the model as text below. */
    }
  }

  return { calls, text: raw.replace(pattern, "").trim() };
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
  const turns: ChatTurn[] = [...options.messages];
  // Signature -> the step it ran in and what it returned. Reading the same
  // file again after an edit is legitimate; repeating an identical call inside
  // one model response, or retrying one that failed, is not.
  const seen = new Map<string, { outcome: ToolOutcome; step: number }>();
  let toolCalls = 0;

  for (let step = 0; step < maxSteps; step += 1) {
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

    const parsed = parseToolCalls(raw);
    if (parsed.calls.length === 0) {
      let visible = "";
      // The text was already streamed; nothing more to emit.
      void visible;
      return { steps: step + 1, toolCalls, stopped: "answer" };
    }

    turns.push({ role: "assistant", content: raw.slice(0, 16_000) });

    const results: string[] = [];
    for (const call of parsed.calls) {
      const resource = toolResource(call);
      const decision = decide(options.rules, call.name, resource);
      const id = uid("tool");
      toolCalls += 1;

      if (decision.effect === "deny") {
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
  }

  options.onNote?.(
    `Stopped after ${maxSteps} tool rounds. The work above is real; ask for a narrower next step if something is still missing.`,
  );

  return { steps: maxSteps, toolCalls, stopped: "limit" };
}

function encodeResult(call: ToolCall, outcome: ToolOutcome): string {
  return `<tool_result name="${call.name}" ok="${outcome.ok}">\n${outcome.content.slice(0, 24_000)}\n</tool_result>`;
}
