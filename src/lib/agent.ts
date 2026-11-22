// A local, offline stand-in for the agent runtime. It streams text, tool
// calls, diffs and shell output through the same event surface a real
// provider would use, so wiring backends later is a drop-in change.

import type { DiffLine, FileChange, Part, Todo, ToolKind } from "./types";
import { sleep, uid } from "./util";

export interface Emit {
  part: (part: Part) => void;
  patchPart: (id: string, patch: { state?: "run" | "done" | "error" }) => void;
  appendText: (id: string, chunk: string) => void;
  appendOutput: (id: string, line: string) => void;
  todos: (todos: Todo[]) => void;
  file: (file: FileChange) => void;
  done: (info: { durationMs: number; tokens: number; cost: number }) => void;
}

type Step =
  | { kind: "tool"; tool: ToolKind; label: string; detail?: string; ms?: number }
  | { kind: "diff"; path: string; added: number; removed: number; lines: DiffLine[] }
  | { kind: "shell"; command: string; output: string[]; fail?: boolean }
  | { kind: "note"; text: string }
  | { kind: "text"; text: string };

interface Flow {
  intro: string;
  steps: Step[];
  outro: string;
  todos: Todo[];
}

const typecheckOk: Step = {
  kind: "shell",
  command: "npm run typecheck",
  output: ["> tsc --noEmit", "✓ no errors in 52 files (2.8s)"],
};

const featureFlow: Flow = {
  intro:
    "I'll read the files this touches, make the change, then verify it. Nothing outside the composer's send path needs to move.",
  todos: [
    { id: "t1", text: "Trace the current send path", done: true },
    { id: "t2", text: "Keep the draft until the store accepts it", done: true },
    { id: "t3", text: "Verify with typecheck and a manual send", done: false, active: true },
  ],
  steps: [
    { kind: "tool", tool: "read", label: "src/components/Composer.tsx", detail: "212 lines" },
    { kind: "tool", tool: "grep", label: 'matcher: "sendMessage|startRun"', detail: "9 matches" },
    {
      kind: "text",
      text: "The composer clears its draft before the run is registered, so a rejected send loses the prompt. I'll move the clear behind the store and keep the text on failure.",
    },
    {
      kind: "diff",
      path: "src/components/Composer.tsx",
      added: 7,
      removed: 4,
      lines: [
        { type: "ctx", no: 118, text: "  const submit = async () => {" },
        { type: "ctx", no: 119, text: "    const text = draft.trim();" },
        { type: "del", no: 120, text: "    setDraft(\"\");" },
        { type: "del", no: 121, text: "    await sendMessage(text);" },
        { type: "add", no: 120, text: "    if (!text) return;" },
        { type: "add", no: 121, text: "    const accepted = await sendMessage(text);" },
        { type: "add", no: 122, text: "    // Only drop the draft once the store owns the message." },
        { type: "add", no: 123, text: "    if (accepted) setDraft(\"\");" },
        { type: "ctx", no: 124, text: "  };" },
      ],
    },
    typecheckOk,
    {
      kind: "text",
      text: "Drafts now survive a failed send, and the composer clears only after the message is in the store.",
    },
  ],
  outro:
    "Kept the change to the composer: no store changes, no new dependencies. If you want the failure path covered, I can add a test that simulates a rejected send.",
};

const fixFlow: Flow = {
  intro: "Reproducing first so the fix targets the real failure rather than the symptom.",
  todos: [
    { id: "f1", text: "Reproduce the failing check", done: true },
    { id: "f2", text: "Fix the narrowing bug in the runtime", done: true },
    { id: "f3", text: "Re-run the full check", done: true },
  ],
  steps: [
    {
      kind: "shell",
      command: "npm run typecheck",
      output: [
        "> tsc --noEmit",
        "src/lib/agent.ts:174:9 - error TS2345:",
        "  Argument of type 'Partial<Part>' is not assignable to parameter of type 'Part'.",
        "",
        "Found 1 error in 1 file.",
      ],
      fail: true,
    },
    { kind: "tool", tool: "read", label: "src/lib/agent.ts", detail: "188 lines" },
    {
      kind: "text",
      text: "The tool patcher narrows on `kind` but the union member it writes back to is rebuilt from a partial, so TypeScript widens it to the whole union. Narrowing at the call site fixes it without a cast.",
    },
    {
      kind: "diff",
      path: "src/lib/agent.ts",
      added: 5,
      removed: 3,
      lines: [
        { type: "ctx", no: 170, text: "export function patchTool(part: Part, patch: ToolPatch) {" },
        { type: "del", no: 171, text: "  return { ...part, ...patch } as Part;" },
        { type: "add", no: 171, text: "  if (part.kind !== \"tool\" && part.kind !== \"shell\") return part;" },
        { type: "add", no: 172, text: "  return { ...part, ...patch };" },
        { type: "ctx", no: 173, text: "}" },
      ],
    },
    typecheckOk,
    {
      kind: "note",
      text: "Only src/lib/agent.ts changed. No config or dependency edits.",
    },
  ],
  outro:
    "The check passes and the narrowing is now explicit, so a future union member can't silently absorb the patch. Nothing else in the run pipeline changed.",
};

const reviewFlow: Flow = {
  intro:
    "Reading the working tree first. This is a read-only pass — I won't edit files unless you ask.",
  todos: [],
  steps: [
    { kind: "tool", tool: "grep", label: 'matcher: "TODO|FIXME|@ts-ignore"', detail: "6 matches" },
    { kind: "tool", tool: "read", label: "src/lib/agent.ts", detail: "188 lines" },
    {
      kind: "text",
      text: "Two things worth acting on: the abort listener in `sleep` is never removed when the timer resolves, so a long session accumulates listeners on the run signal; and the shell emitter appends output after a run is cancelled, which can resurrect a stopped message. The rest of the surface fails closed, and I found no unbounded reads.",
    },
    {
      kind: "note",
      text: "Plan mode is read-only. Ask me to switch to Build and I'll apply both fixes.",
    },
  ],
  outro:
    "Highest-value fix is the listener cleanup — it is two lines and removes a real leak on long sessions. The cancelled-output guard is worth doing next.",
};

function pickFlow(prompt: string): Flow {
  if (/\b(fix|bug|error|fail|failing|broken|typecheck|test)\b/i.test(prompt)) return fixFlow;
  if (/\b(review|explain|understand|audit|read|tour|why|how)\b/i.test(prompt)) return reviewFlow;
  return featureFlow;
}

async function streamText(
  id: string,
  text: string,
  emit: Emit,
  signal: AbortSignal,
): Promise<void> {
  const chunks = text.match(/\S+\s*/g) ?? [text];
  for (const chunk of chunks) {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    emit.appendText(id, chunk);
    await sleep(18 + Math.random() * 22, signal);
  }
}

function textPart(emit: Emit, text = ""): string {
  const id = uid("part");
  emit.part({ id, kind: "text", text });
  return id;
}

export async function runAgent(
  prompt: string,
  emit: Emit,
  signal: AbortSignal,
): Promise<void> {
  const flow = pickFlow(prompt);
  const started = Date.now();
  const tokens = Math.round(820 + prompt.length * 2.4 + Math.random() * 380);

  const introId = textPart(emit);
  await streamText(introId, flow.intro, emit, signal);

  if (flow.todos.length > 0) emit.todos(flow.todos);

  for (const step of flow.steps) {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");

    if (step.kind === "tool") {
      const id = uid("part");
      emit.part({
        id,
        kind: "tool",
        tool: step.tool,
        label: step.label,
        detail: step.detail,
        state: "run",
      });
      await sleep(step.ms ?? 560 + Math.random() * 420, signal);
      emit.patchPart(id, { state: "done" });
      continue;
    }

    if (step.kind === "diff") {
      emit.part({
        id: uid("part"),
        kind: "diff",
        path: step.path,
        added: step.added,
        removed: step.removed,
        lines: step.lines,
      });
      emit.file({
        path: step.path,
        added: step.added,
        removed: step.removed,
        status: "M",
      });
      await sleep(420, signal);
      continue;
    }

    if (step.kind === "shell") {
      const id = uid("part");
      emit.part({ id, kind: "shell", command: step.command, output: [], state: "run" });
      await sleep(500, signal);
      for (const line of step.output) {
        if (signal.aborted) throw new DOMException("aborted", "AbortError");
        emit.appendOutput(id, line);
        await sleep(90, signal);
      }
      emit.patchPart(id, { state: step.fail ? "error" : "done" });
      await sleep(260, signal);
      continue;
    }

    if (step.kind === "note") {
      emit.part({ id: uid("part"), kind: "note", text: step.text });
      await sleep(280, signal);
      continue;
    }

    if (step.kind === "text") {
      const id = textPart(emit);
      await streamText(id, step.text, emit, signal);
    }
  }

  const outroId = textPart(emit);
  await streamText(outroId, flow.outro, emit, signal);

  if (flow.todos.length > 0) {
    emit.todos(flow.todos.map((todo) => ({ ...todo, active: false, done: true })));
  }

  emit.done({
    durationMs: Date.now() - started,
    tokens,
    cost: tokens * 0.000012,
  });
}
