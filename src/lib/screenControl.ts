/**
 * Screen awareness and control for the floating screen card.
 *
 * A text-only model cannot read a JPEG, so the native side exposes the
 * frontmost window as an accessibility tree: every control comes back with a
 * role, a label, its value and a screen rectangle. The model can click by ref,
 * read a field, type, scroll, press keys, drag and switch apps/windows. The
 * same actions move the real pointer through Core Graphics; a blue cursor is
 * drawn over the display so the user can watch the step.
 */

import type { ChatImage } from "./providers";

export interface ScreenElement {
  ref: string;
  role: string;
  subrole?: string;
  title: string;
  value: string;
  x: number;
  y: number;
  w: number;
  h: number;
  enabled?: boolean;
  focused?: boolean;
}

export interface ScreenTree {
  app: string;
  window: string;
  elements: ScreenElement[];
  truncated?: boolean;
  error?: string;
}

export interface ScreenWindowInfo {
  app: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  focused?: boolean;
  minimized?: boolean;
}

export interface ScreenInfo {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenResult {
  ok: boolean;
  summary: string;
  content: string;
  resource: string;
  images?: ChatImage[];
}

let latestElements: ScreenElement[] = [];
let latestPoint: { x: number; y: number } | null = null;
let hideTimer: number | undefined;

async function invoke<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    throw new Error("Screen control needs the Lantas desktop app.");
  }
  const { invoke: call } = await import("@tauri-apps/api/core");
  return await call<T>(name, args);
}

export async function screenInfo(): Promise<ScreenInfo> {
  return await invoke<ScreenInfo>("screen_info");
}

export async function screenControlAllowed(): Promise<boolean> {
  try {
    return await invoke<boolean>("screen_control_permission");
  } catch {
    return false;
  }
}

/** Adds Lantas to the Accessibility list and asks macOS for the switch. */
export async function requestScreenControl(): Promise<boolean> {
  try {
    return await invoke<boolean>("screen_control_request");
  } catch {
    return false;
  }
}

export async function readScreenTree(): Promise<ScreenTree> {
  const raw = await invoke<string>("screen_ax_tree");
  const parsed = JSON.parse(raw) as ScreenTree;
  latestElements = Array.isArray(parsed.elements) ? parsed.elements : [];
  return parsed;
}

export async function readScreenWindows(): Promise<{
  app: string;
  windows: ScreenWindowInfo[];
}> {
  const raw = await invoke<string>("screen_windows");
  return JSON.parse(raw) as { app: string; windows: ScreenWindowInfo[] };
}

export async function focusScreenApp(app: string, window?: string): Promise<string> {
  return await invoke<string>("screen_focus", { app, window });
}

export async function moveScreenPointer(x: number, y: number): Promise<void> {
  await invoke("screen_move", { x, y });
}

export async function clickScreen(
  x: number,
  y: number,
  button = "left",
  count = 1,
): Promise<void> {
  await invoke("screen_click", { x, y, button, count });
}

export async function scrollScreen(dx: number, dy: number): Promise<void> {
  await invoke("screen_scroll", { dx, dy });
}

export async function typeScreenText(text: string): Promise<void> {
  await invoke("screen_type", { text });
}

export async function pressScreenKey(key: string, modifiers: string[] = []): Promise<void> {
  await invoke("screen_key", { key, modifiers });
}

export async function dragScreen(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): Promise<void> {
  await invoke("screen_drag", { fromX, fromY, toX, toY });
}

/** Shows the blue Lantas pointer at a global screen point. */
export async function showScreenCursor(
  point: { x: number; y: number },
  options: { label?: string; down?: boolean; key?: string } = {},
): Promise<void> {
  latestPoint = point;
  if (hideTimer) window.clearTimeout(hideTimer);
  try {
    const info = await screenInfo();
    if (!info.width || !info.height) return;
    const { overlayShow } = await import("./native");
    await overlayShow();
    const { emitTo } = await import("@tauri-apps/api/event");
    await emitTo("screen-overlay", "lantas:screen-cursor", {
      x: (point.x - info.x) / info.width,
      y: (point.y - info.y) / info.height,
      label: options.label,
      down: Boolean(options.down),
      key: options.key,
      at: Date.now(),
    });
  } catch {
    /* the card still works; the pointer is a visual aid */
  }
}

export async function hideScreenCursor(): Promise<void> {
  try {
    const { emitTo } = await import("@tauri-apps/api/event");
    await emitTo("screen-overlay", "lantas:screen-cursor", { hide: true });
  } catch {
    /* not in the desktop app */
  }
  // Leave the pointer visible for the point mark that may follow, then take
  // the transparent layer down so it is not a permanent window over every app.
  if (hideTimer) window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(async () => {
    try {
      const { overlayHide } = await import("./native");
      await overlayHide();
    } catch {
      /* not in the desktop app */
    }
  }, 5200);
}

function round(value: number): number {
  return Math.round(value);
}

function elementLine(element: ScreenElement): string {
  const name = element.title || element.value || element.subrole || element.role;
  const value =
    element.value && element.value !== name ? `, value “${element.value.slice(0, 90)}”` : "";
  const state = element.enabled === false ? ", disabled" : element.focused ? ", focused" : "";
  return `${element.ref} ${element.role.replace(/^AX/, "")} “${name.slice(0, 120)}”${value}${state} — centre ${round(
    element.x + element.w / 2,
  )},${round(element.y + element.h / 2)} (${round(element.w)}×${round(element.h)})`;
}

function describeTree(tree: ScreenTree): string {
  const head = `App: ${tree.app || "unknown"}${tree.window ? ` — window: ${tree.window}` : ""}`;
  if (!tree.elements?.length) {
    return `${head}\nNo labelled controls were exposed by this window. ${
      tree.truncated ? "The tree was truncated." : "Try a screenshot or switch windows."
    }`;
  }
  const lines = tree.elements.slice(0, 120).map(elementLine);
  return [
    head,
    `${tree.elements.length} controls${tree.truncated ? " (truncated)" : ""}:`,
    ...lines,
  ].join("\n");
}

function toImage(dataUrl: string | null): ChatImage | undefined {
  if (!dataUrl) return undefined;
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return undefined;
  const meta = dataUrl.slice(0, comma);
  const mime = /data:([^;]+)/.exec(meta)?.[1] ?? "image/jpeg";
  return { mime, data: dataUrl.slice(comma + 1) };
}

async function screenshot(vision: boolean): Promise<ChatImage | undefined> {
  if (!vision) return undefined;
  try {
    const { captureNativeScreen } = await import("./screen");
    return toImage(await captureNativeScreen());
  } catch {
    return undefined;
  }
}

async function observe(vision: boolean, note?: string): Promise<{
  tree: ScreenTree | null;
  content: string;
  images?: ChatImage[];
}> {
  let tree: ScreenTree | null = null;
  try {
    tree = await readScreenTree();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      tree: null,
      content: `${note ? `${note}\n\n` : ""}Could not read the accessibility tree: ${message}`,
    };
  }
  const image = await screenshot(vision);
  return {
    tree,
    content: `${note ? `${note}\n\n` : ""}${describeTree(tree)}`,
    images: image ? [image] : undefined,
  };
}

function num(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function resolvePoint(args: Record<string, unknown>): Promise<{
  x: number;
  y: number;
  label?: string;
}> {
  const info = await screenInfo();
  const screenX = num(args.screenX ?? args.screen_x);
  const screenY = num(args.screenY ?? args.screen_y);
  if (screenX !== null && screenY !== null) {
    return { x: screenX, y: screenY, label: typeof args.label === "string" ? args.label : undefined };
  }
  const normalizedX = num(args.x);
  const normalizedY = num(args.y);
  if (normalizedX !== null && normalizedY !== null) {
    return {
      x: info.x + Math.min(1, Math.max(0, normalizedX)) * info.width,
      y: info.y + Math.min(1, Math.max(0, normalizedY)) * info.height,
      label: typeof args.label === "string" ? args.label : undefined,
    };
  }
  const ref = String(args.ref ?? "").trim();
  const target = String(args.target ?? "").trim().toLowerCase();
  let element: ScreenElement | undefined;
  if (ref) element = latestElements.find((item) => item.ref === ref || item.ref === `s${ref}`);
  else if (target) {
    element = latestElements.find((item) =>
      `${item.title} ${item.value} ${item.role}`.toLowerCase().includes(target),
    );
  }
  if (!element) {
    throw new Error(
      "No target found. Call snapshot first, then use an element ref, or pass x and y as fractions of the screen.",
    );
  }
  return {
    x: element.x + element.w / 2,
    y: element.y + element.h / 2,
    label: element.title || element.value || element.role,
  };
}

/**
 * The model-facing implementation of the `screen` tool. `mode` is `control`
 * while the card's Control switch is on and `read` when the user only wants
 * questions answered.
 */
export async function runScreenAction(
  args: Record<string, unknown>,
  options: { vision: boolean; mode: "control" | "read"; task?: string },
): Promise<ScreenResult> {
  const action = String(args.action ?? "snapshot").trim().toLowerCase();
  const resource = `screen ${action}`;
  const readOnly = ["snapshot", "windows", "wait", "info"].includes(action);
  if (options.mode === "read" && !readOnly) {
    return {
      ok: false,
      summary: "Screen control is off",
      content:
        "The Control switch in the screen card is off. You can still read the screen with snapshot; ask the user to turn Control on before clicking, typing, scrolling or switching windows.",
      resource,
    };
  }

  try {
    if (action === "info") {
      const info = await screenInfo();
      return {
        ok: true,
        summary: "Read the display",
        content: `Main display: ${info.width}×${info.height} points at ${info.x},${info.y}.`,
        resource,
      };
    }

    if (action === "windows" || action === "switch_window" || action === "list_windows") {
      const result = await readScreenWindows();
      const lines = result.windows.length
        ? result.windows.map(
            (window) =>
              `${window.focused ? "• " : ""}${window.app} — “${window.title}” at ${window.x},${window.y} ${window.w}×${window.h}${window.minimized ? " (minimized)" : ""}`,
          )
        : ["No windows were exposed by the frontmost app."];
      return {
        ok: true,
        summary: `${result.windows.length} window${result.windows.length === 1 ? "" : "s"}`,
        content: [`Frontmost app: ${result.app}`, ...lines].join("\n"),
        resource,
      };
    }

    if (action === "focus" || action === "activate" || action === "switch_app") {
      const app = String(args.app ?? args.application ?? "").trim();
      if (!app) throw new Error("An app name is required.");
      const window = args.window ? String(args.window) : undefined;
      await focusScreenApp(app, window);
      await new Promise((resolve) => setTimeout(resolve, 320));
      const seen = await observe(options.vision, `Focused ${app}${window ? ` — ${window}` : ""}.`);
      return {
        ok: true,
        summary: `Focused ${app}`,
        content: seen.content,
        resource,
        ...(seen.images ? { images: seen.images } : {}),
      };
    }

    if (action === "wait" || action === "sleep") {
      const ms = Math.min(8_000, Math.max(80, num(args.ms ?? args.timeoutMs) ?? 600));
      await new Promise((resolve) => setTimeout(resolve, ms));
      const seen = await observe(options.vision, `Waited ${ms} ms.`);
      return {
        ok: true,
        summary: `Waited ${ms} ms`,
        content: seen.content,
        resource,
        ...(seen.images ? { images: seen.images } : {}),
      };
    }

    if (action === "snapshot" || action === "read" || action === "see") {
      const seen = await observe(options.vision);
      return {
        ok: true,
        summary: seen.tree
          ? `${seen.tree.elements.length} controls in ${seen.tree.app || "the front app"}`
          : "Screen read failed",
        content: seen.content,
        resource,
        ...(seen.images ? { images: seen.images } : {}),
      };
    }

    if (action === "move") {
      const point = await resolvePoint(args);
      await moveScreenPointer(point.x, point.y);
      await showScreenCursor(point, { label: point.label });
      await new Promise((resolve) => setTimeout(resolve, 120));
      return {
        ok: true,
        summary: `Moved to ${round(point.x)},${round(point.y)}`,
        content: `Moved the pointer to ${round(point.x)},${round(point.y)}.`,
        resource,
      };
    }

    if (action === "click" || action === "double_click" || action === "right_click") {
      const point = await resolvePoint(args);
      const button = action === "right_click" ? "right" : String(args.button ?? "left");
      const count = action === "double_click" ? 2 : Math.min(3, Math.max(1, num(args.count) ?? 1));
      await showScreenCursor(point, { label: point.label, down: true });
      await clickScreen(point.x, point.y, button, count);
      await new Promise((resolve) => setTimeout(resolve, 320));
      const seen = await observe(
        options.vision,
        `Clicked ${point.label ? `“${point.label}”` : "the screen"} at ${round(point.x)},${round(point.y)}${count > 1 ? ` (${count}×)` : ""}.`,
      );
      return {
        ok: true,
        summary: `Clicked ${point.label || "the screen"}`,
        content: seen.content,
        resource,
        ...(seen.images ? { images: seen.images } : {}),
      };
    }

    if (action === "type" || action === "write") {
      const text = String(args.text ?? args.value ?? "");
      if (!text) throw new Error("Text to type is required.");
      if (latestPoint) await showScreenCursor(latestPoint, { label: "Typing", key: "⌨" });
      await typeScreenText(text);
      if (args.submit || args.enter) {
        await pressScreenKey("Return");
      }
      await new Promise((resolve) => setTimeout(resolve, 260));
      const seen = await observe(
        options.vision,
        `Typed ${text.length} character${text.length === 1 ? "" : "s"}${args.submit || args.enter ? " and pressed Return" : ""}.`,
      );
      return {
        ok: true,
        summary: `Typed ${text.length} characters`,
        content: seen.content,
        resource,
        ...(seen.images ? { images: seen.images } : {}),
      };
    }

    if (action === "key" || action === "press") {
      const key = String(args.key ?? args.name ?? "").trim();
      if (!key) throw new Error("A key name is required.");
      const modifiers = Array.isArray(args.modifiers)
        ? (args.modifiers as unknown[]).map((item) => String(item))
        : [];
      if (latestPoint) {
        await showScreenCursor(latestPoint, {
          label: `${modifiers.length ? `${modifiers.join("+")}+` : ""}${key}`,
          key: "⌨",
        });
      }
      await pressScreenKey(key, modifiers);
      await new Promise((resolve) => setTimeout(resolve, 220));
      const seen = await observe(
        options.vision,
        `Pressed ${modifiers.length ? `${modifiers.join("+")}+` : ""}${key}.`,
      );
      return {
        ok: true,
        summary: `Pressed ${key}`,
        content: seen.content,
        resource,
        ...(seen.images ? { images: seen.images } : {}),
      };
    }

    if (action === "scroll") {
      const dx = num(args.dx ?? args.x) ?? 0;
      const dy = num(args.dy ?? args.y) ?? 3;
      if (latestPoint) {
        await showScreenCursor(latestPoint, { label: dy < 0 ? "Scroll up" : "Scroll down", key: "↕" });
      }
      await scrollScreen(dx, dy);
      await new Promise((resolve) => setTimeout(resolve, 280));
      const seen = await observe(options.vision, `Scrolled ${dy < 0 ? "up" : "down"} ${Math.abs(dy)}.`);
      return {
        ok: true,
        summary: `Scrolled ${dy < 0 ? "up" : "down"}`,
        content: seen.content,
        resource,
        ...(seen.images ? { images: seen.images } : {}),
      };
    }

    if (action === "drag") {
      const start = await resolvePoint({
        ...(args.fromRef ? { ref: args.fromRef } : {}),
        ...(args.fromX !== undefined ? { x: args.fromX, y: args.fromY } : {}),
      });
      const end = args.toRef
        ? await resolvePoint({ ref: args.toRef })
        : await resolvePoint({ x: args.toX, y: args.toY });
      await showScreenCursor(start, { label: start.label, down: true });
      await dragScreen(start.x, start.y, end.x, end.y);
      await new Promise((resolve) => setTimeout(resolve, 320));
      const seen = await observe(
        options.vision,
        `Dragged from ${round(start.x)},${round(start.y)} to ${round(end.x)},${round(end.y)}.`,
      );
      return {
        ok: true,
        summary: "Dragged",
        content: seen.content,
        resource,
        ...(seen.images ? { images: seen.images } : {}),
      };
    }

    return {
      ok: false,
      summary: `Unknown screen action ${action}`,
      content:
        "Unknown screen action. Use snapshot, windows, focus, click, move, type, key, scroll, drag, or wait.",
      resource,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      summary: message,
      content: `Screen action failed: ${message}`,
      resource,
    };
  }
}
