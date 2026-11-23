/** Tauri-only shell integration (window material). No-ops on the web. */
export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function setNativeGlass(enabled: boolean): Promise<void> {
  if (!inTauri()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_glass", { enabled });
  } catch {
    /* older shell without the command */
  }
}

export function openExternal(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.click();
}
