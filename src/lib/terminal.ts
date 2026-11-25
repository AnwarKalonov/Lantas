import { inTauri } from "./native";

export interface TerminalLineEvent {
  id: string;
  stream: "stdout" | "stderr";
  line: string;
}

export interface TerminalExitEvent {
  id: string;
  code: number | null;
}

async function invoke<T>(name: string, args: Record<string, unknown>): Promise<T> {
  if (!inTauri()) throw new Error("The terminal runs in the desktop app.");
  const { invoke: call } = await import("@tauri-apps/api/core");
  return call<T>(name, args);
}

export async function terminalStart(id: string, cwd: string, command: string) {
  await invoke("terminal_start", { id, cwd, command });
}

export async function terminalShell(id: string, cwd: string) {
  await invoke("terminal_shell", { id, cwd });
}

export async function terminalCli(id: string, cwd: string) {
  await invoke("terminal_cli", { id, cwd });
}

/** Opens the user's own Terminal.app in this folder. */
export async function openExternalTerminal(cwd: string) {
  await invoke("open_external_terminal", { cwd });
}

export async function terminalWrite(id: string, data: string) {
  await invoke("terminal_write", { id, data });
}

export async function terminalStop(id: string) {
  await invoke("terminal_stop", { id });
}

export async function onTerminalOutput(
  handler: (event: TerminalLineEvent) => void,
): Promise<() => void> {
  if (!inTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<TerminalLineEvent>("terminal-output", (event) =>
    handler(event.payload),
  );
  return unlisten;
}

export async function onTerminalExit(
  handler: (event: TerminalExitEvent) => void,
): Promise<() => void> {
  if (!inTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<TerminalExitEvent>("terminal-exit", (event) =>
    handler(event.payload),
  );
  return unlisten;
}

export interface TerminalRunResult {
  code: number | null;
  output: string[];
  timedOut: boolean;
}

/**
 * Runs one command to completion for the assistant, collecting both streams.
 * The listener is installed before the process starts, so even a command that
 * exits immediately cannot race its own output.
 */
export async function runTerminalCommand(
  cwd: string,
  command: string,
  timeoutMs = 120_000,
  onLine?: (line: string) => void,
): Promise<TerminalRunResult> {
  if (!inTauri()) throw new Error("The terminal runs in the desktop app.");
  const id = `exec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const output: string[] = [];
  let finish: (code: number | null) => void = () => {};
  const exited = new Promise<number | null>((resolve) => {
    finish = resolve;
  });

  const offOutput = await onTerminalOutput((event) => {
    if (event.id !== id) return;
    const line = `${event.stream === "stderr" ? "[stderr] " : ""}${stripAnsi(event.line)}`;
    output.push(line);
    onLine?.(line);
  });
  const offExit = await onTerminalExit((event) => {
    if (event.id === id) finish(event.code);
  });

  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    finish(null);
    void terminalStop(id).catch(() => {});
  }, timeoutMs);

  try {
    await terminalStart(id, cwd, command);
    const code = await exited;
    return { code: timedOut ? null : code, output, timedOut };
  } finally {
    window.clearTimeout(timer);
    offOutput();
    offExit();
  }
}

/** ANSI is useful in a real terminal and noise in a text panel. */
export function stripAnsi(value: string) {
  return value.replace(
    // eslint-disable-next-line no-control-regex
    /\u001b\[[0-?]*[ -/]*[@-~]/g,
    "",
  );
}
