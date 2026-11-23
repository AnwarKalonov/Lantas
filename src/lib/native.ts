/** Tauri-only shell integration (window material). No-ops on the web. */
export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export interface ElBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

let lastNativeError = "";

/** The reason the last native call failed, for the diagnostics row. */
export function elLastError(): string {
  return lastNativeError;
}

async function command<T>(name: string, args: Record<string, unknown>): Promise<T | null> {
  if (!inTauri()) {
    lastNativeError = "This is the web preview, not the desktop build.";
    return null;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const value = await invoke<T>(name, args);
    lastNativeError = "";
    return value;
  } catch (error) {
    lastNativeError = error instanceof Error ? error.message : String(error);
    return null;
  }
}

/** Opens or reuses the Lantas Browser webview (a real browser engine). */
export async function elOpen(url: string, box: ElBox): Promise<boolean> {
  return (await command("el_open", { url, ...box })) !== null;
}

export async function elBounds(box: ElBox): Promise<void> {
  await command("el_bounds", { ...box });
}

export async function elNavigate(url: string): Promise<void> {
  await command("el_navigate", { url });
}

export async function elVisible(visible: boolean): Promise<void> {
  await command("el_visible", { visible });
}

export async function elClose(): Promise<void> {
  await command("el_close", {});
}

export async function elEval(script: string): Promise<void> {
  await command("el_eval", { script });
}

export async function elClick(target: string): Promise<boolean> {
  return (await command("el_click", { target })) !== null;
}

export async function elType(selector: string, text: string): Promise<boolean> {
  return (await command("el_type", { selector, text })) !== null;
}

export async function elHistory(direction: "back" | "forward"): Promise<void> {
  await command("el_history", { direction });
}

/** Opens the page in a standalone Lantas Browser window (fallback). */
export async function elWindow(url: string): Promise<boolean> {
  return (await command("el_window", { url })) !== null;
}

export async function elReload(): Promise<void> {
  await command("el_reload", {});
}

/**
 * Opens a URL outside the app. Tauri webviews swallow `target="_blank"`, so the
 * desktop build hands the URL to the OS (Chrome when asked, for OAuth).
 */
export async function openExternal(
  url: string,
  target: "default" | "chrome" = "default",
): Promise<boolean> {
  if (inTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke(target === "chrome" ? "open_in_chrome" : "open_external", { url });
      return true;
    } catch (error) {
      lastNativeError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }
  try {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (opened) return true;
  } catch {
    /* fall through to a link click */
  }
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.click();
  return true;
}
