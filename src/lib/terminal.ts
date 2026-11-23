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

export async function terminalCli(id: string, cwd: string) {
  await invoke("terminal_cli", { id, cwd });
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

/** ANSI is useful in a real terminal and noise in a text panel. */
export function stripAnsi(value: string) {
  return value.replace(
    // eslint-disable-next-line no-control-regex
    /\u001b\[[0-?]*[ -/]*[@-~]/g,
    "",
  );
}
