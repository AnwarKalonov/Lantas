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
let lastNativeOk = false;

/** The reason the last native call failed, for the diagnostics row. */
export function elLastError(): string {
  return lastNativeError;
}

async function command<T>(name: string, args: Record<string, unknown>): Promise<T | null> {
  lastNativeOk = false;
  if (!inTauri()) {
    lastNativeError = "This is the web preview, not the desktop build.";
    return null;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const value = await invoke<T>(name, args);
    lastNativeError = "";
    lastNativeOk = true;
    return value;
  } catch (error) {
    lastNativeError = error instanceof Error ? error.message : String(error);
    return null;
  }
}

/** Opens or reuses the Lantas Browser webview (a real browser engine). */
export async function elOpen(url: string, box: ElBox): Promise<boolean> {
  await command("el_open", { url, ...box });
  return lastNativeOk;
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

/**
 * Runs a small expression inside the child webview and gets its value back.
 * Tauri evaluates JavaScript with a callback, so the browser tool can finally
 * read the page it just acted on instead of assuming the action landed.
 */
export async function runInPage<T>(body: string): Promise<T | null> {
  if (!inTauri()) {
    // The web preview has no child webview to script, and guessing would make
    // every click look like a page problem. Say what is actually missing.
    throw new Error(
      "Live page control needs the desktop app. This browser tab can read a page but cannot click or type in it; connect the Chrome extension to drive your own Chrome instead.",
    );
  }
  const script = `(() => { try { const value = (() => { ${body} })(); return JSON.stringify(value); } catch (error) { return JSON.stringify({ ok: false, error: String(error && error.message ? error.message : error) }); } })()`;
  const raw = await command<string>("el_run", { script });
  if (raw == null) return null;
  const unwrap = (value: unknown): unknown => {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  };
  let parsed = unwrap(raw);
  // Some platforms serialize the returned JSON string once more.
  if (typeof parsed === "string") parsed = unwrap(parsed);
  return (parsed ?? null) as T | null;
}

/** Opens the current workspace in the real VS Code, when it is installed. */
export type PrivacyPane =
  | "screen"
  | "accessibility"
  | "files"
  | "automation"
  | "microphone"
  | "camera";

/**
 * Opens the matching macOS Privacy & Security pane. macOS does not let an app
 * grant itself these permissions, so this is the closest we can get to asking:
 * the user flips the switch, and the app re-checks.
 */
export async function openPrivacySettings(pane: PrivacyPane): Promise<boolean> {
  if (!inTauri()) {
    lastNativeError = "System Settings only opens from the desktop app.";
    return false;
  }
  await command("open_privacy_settings", { pane });
  return lastNativeOk;
}

export async function openInVsCode(path: string): Promise<boolean> {
  await command("open_in_vscode", { path });
  return lastNativeOk;
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
 * A still frame of the Lantas Browser page as base64 JPEG.
 *
 * Null means the capture did not happen; `elLastError()` has the reason (the
 * page is off screen, or macOS withheld Screen Recording).
 */
export async function elScreenshot(): Promise<string | null> {
  return command<string>("el_screenshot", {});
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
      // No Chrome, or a URL handler the app refused: the default browser is
      // still a valid place for the OAuth page to finish.
      if (target === "chrome") return openExternal(url, "default");
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
