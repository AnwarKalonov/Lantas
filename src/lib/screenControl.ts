/**
 * Sight and control for the floating screen assistant.
 *
 * The user never sees a preview of their own screen inside the card. What the
 * model gets is a private copy of the front window: a picture with a labelled
 * 16×10 grid, every accessibility control boxed with its ref, and a header that
 * names the window. That picture is sent to the model and thrown away.
 *
 * Reading is accessibility-first. Every control has a role, a label, a value,
 * a screen rectangle and a child-index path, so a model can press the control
 * itself instead of guessing a pixel. The grid and the cell names are the
 * fallback for things the accessibility tree cannot name (canvas, video, a
 * blank area of a page). Coordinates are fractions of the target window.
 *
 * Acting uses Core Graphics through the native side, and a blue pointer is
 * drawn on the display so the user can watch the step.
 */

import type { ChatImage } from "./providers";

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenElement {
  ref: string;
  /** Child indices from the window root; used for a direct AX press. */
  path?: string;
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
  frame?: ScreenRect;
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

export interface ScreenShot extends ScreenRect {
  /** Raw data URL. Kept in memory only; never rendered in the card. */
  image: string;
  app: string;
  window: string;
  display: ScreenInfo;
}

export interface ScreenResult {
  ok: boolean;
  summary: string;
  content: string;
  resource: string;
  images?: ChatImage[];
}

export interface ScreenSight {
  tree: ScreenTree | null;
  shot: ScreenShot | null;
  content: string;
  images?: ChatImage[];
}

const COLUMNS = "ABCDEFGHIJKLMNOP";
const COLS = COLUMNS.length;
const ROWS = 10;

let latestElements: ScreenElement[] = [];
let latestFrame: ScreenRect | null = null;
let latestPoint: { x: number; y: number } | null = null;
let latestShot: ScreenShot | null = null;
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
  latestFrame =
    parsed.frame && parsed.frame.width > 1 && parsed.frame.height > 1
      ? { ...parsed.frame }
      : null;
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

/* ── capture ──────────────────────────────────────────────────────────── */

/**
 * A picture of the target window, straight from macOS. Capturing the window
 * (not the display) keeps Lantas's own floating card and blue pointer out of
 * the image, and gives the model the exact frame its coordinates refer to.
 * Falls back to the full display when Accessibility is not available yet.
 */
export async function captureShot(fresh = true): Promise<ScreenShot | null> {
  if (!fresh && latestShot) return latestShot;

  try {
    const raw = await invoke<string>("screen_snapshot");
    const data = JSON.parse(raw) as {
      app?: string;
      window?: string;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      image?: string;
    };
    if (data.image && data.width && data.height) {
      const display = await screenInfo().catch(() => ({
        x: Number(data.x) || 0,
        y: Number(data.y) || 0,
        width: Number(data.width) || 0,
        height: Number(data.height) || 0,
      }));
      latestShot = {
        image: `data:image/jpeg;base64,${data.image}`,
        x: Number(data.x) || 0,
        y: Number(data.y) || 0,
        width: Number(data.width) || 0,
        height: Number(data.height) || 0,
        app: data.app || "the front app",
        window: data.window || "",
        display,
      };
      return latestShot;
    }
  } catch {
    /* fall through to the display capture */
  }

  try {
    const { captureNativeScreen } = await import("./screen");
    const image = await captureNativeScreen();
    const display = await screenInfo();
    if (!image || !display.width || !display.height) return null;
    latestShot = {
      image,
      x: display.x,
      y: display.y,
      width: display.width,
      height: display.height,
      app: "Display",
      window: "whole screen",
      display,
    };
    return latestShot;
  } catch {
    return null;
  }
}

function bounds(shot: ScreenShot): ScreenRect {
  return { x: shot.x, y: shot.y, width: shot.width, height: shot.height };
}

/* ── the private picture ──────────────────────────────────────────────── */

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The screen capture could not be read."));
    image.src = source;
  });
}

function chip(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options: { size?: number; colour?: string; background?: string } = {},
) {
  const size = options.size ?? 9;
  context.font = `600 ${size}px "SF Mono", ui-monospace, Menlo, monospace`;
  const width = context.measureText(text).width + 6;
  const height = size + 5;
  context.fillStyle = options.background ?? "rgba(8, 10, 16, 0.76)";
  context.beginPath();
  const radius = 3;
  if (typeof context.roundRect === "function") {
    context.roundRect(x, y, width, height, radius);
  } else {
    context.rect(x, y, width, height);
  }
  context.fill();
  context.fillStyle = options.colour ?? "rgba(236, 244, 255, 0.92)";
  context.fillText(text, x + 3, y + size);
  return width;
}

function intersects(a: ScreenRect, b: ScreenRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * Draws the grid and control boxes on a copy of the shot.
 *
 * This is the part the user never sees. It is deliberately dense: a 16×10
 * major grid, a 4× sub-grid for eyeballing a point, every cell labelled, and
 * every accessibility control boxed with the ref the model can act on. A crop
 * (zoom) gets its own 8×6 grid so small text stays readable.
 */
async function annotate(
  shot: ScreenShot,
  tree: ScreenTree | null,
  options: { crop?: ScreenRect; cols?: number; rows?: number; zoom?: boolean } = {},
): Promise<ChatImage | undefined> {
  try {
    const image = await loadImage(shot.image);
    const source = options.crop ?? bounds(shot);
    const scaleX = image.naturalWidth / Math.max(1, shot.width);
    const scaleY = image.naturalHeight / Math.max(1, shot.height);
    const clipX = Math.max(0, (source.x - shot.x) * scaleX);
    const clipY = Math.max(0, (source.y - shot.y) * scaleY);
    const clipW = Math.min(image.naturalWidth - clipX, source.width * scaleX);
    const clipH = Math.min(image.naturalHeight - clipY, source.height * scaleY);
    if (clipW < 8 || clipH < 8) return undefined;

    const outW = Math.round(Math.min(1600, Math.max(options.zoom ? 900 : 1080, clipW)));
    const outH = Math.round((clipH / clipW) * outW);
    // The caption sits above the picture instead of covering the window's own
    // title bar, tab strip or menu: those are often what the model needs.
    const bar = Math.max(24, Math.round(outH / 38));
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH + bar;
    const context = canvas.getContext("2d");
    if (!context) return undefined;

    context.drawImage(image, clipX, clipY, clipW, clipH, 0, bar, outW, outH);

    const cols = options.cols ?? COLS;
    const rows = options.rows ?? ROWS;
    const stepX = outW / cols;
    const stepY = outH / rows;
    const thin = Math.max(1, Math.round(outW / 1400));

    // Sub-grid: one quarter of a cell, faint enough not to hide the page.
    context.lineWidth = thin;
    context.strokeStyle = "rgba(74, 214, 255, 0.18)";
    context.beginPath();
    for (let column = 0; column <= cols * 4; column += 1) {
      const x = column * (stepX / 4);
      context.moveTo(x, bar);
      context.lineTo(x, bar + outH);
    }
    for (let row = 0; row <= rows * 4; row += 1) {
      const y = bar + row * (stepY / 4);
      context.moveTo(0, y);
      context.lineTo(outW, y);
    }
    context.stroke();

    // Major grid: the cells the model can name.
    context.lineWidth = Math.max(1.2, thin * 1.4);
    context.strokeStyle = "rgba(255, 92, 138, 0.34)";
    context.beginPath();
    for (let column = 0; column <= cols; column += 1) {
      const x = column * stepX;
      context.moveTo(x, bar);
      context.lineTo(x, bar + outH);
    }
    for (let row = 0; row <= rows; row += 1) {
      const y = bar + row * stepY;
      context.moveTo(0, y);
      context.lineTo(outW, y);
    }
    context.stroke();

    // Cell names, every cell. Small enough to ignore, useful when counting.
    const labelSize = Math.max(7, Math.min(10, Math.round(stepX / 12)));
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < cols; column += 1) {
        const name = `${COLUMNS[column] ?? "?"}${row + 1}`;
        chip(context, name, column * stepX + 2, bar + row * stepY + 2, {
          size: labelSize,
          colour: "rgba(255, 232, 242, 0.6)",
          background: "rgba(8, 10, 16, 0.32)",
        });
      }
    }

    // Control boxes, in window points scaled onto the picture.
    if (tree?.elements?.length) {
      let drawn = 0;
      for (const element of tree.elements) {
        if (drawn >= 90) break;
        const rect = {
          x: shot.x + (element.x - shot.x),
          y: shot.y + (element.y - shot.y),
          width: element.w,
          height: element.h,
        };
        if (rect.width < 2 || rect.height < 2) continue;
        if (!intersects(rect, source)) continue;
        const x = ((rect.x - source.x) / source.width) * outW;
        const y = bar + ((rect.y - source.y) / source.height) * outH;
        const w = (rect.width / source.width) * outW;
        const h = (rect.height / source.height) * outH;
        const focused = Boolean(element.focused);
        context.strokeStyle = focused
          ? "rgba(92, 160, 255, 0.95)"
          : "rgba(255, 214, 102, 0.82)";
        context.lineWidth = focused ? 2 : 1.2;
        context.strokeRect(x + 0.5, y + 0.5, Math.max(1, w), Math.max(1, h));
        if (element.enabled === false) {
          context.setLineDash([3, 3]);
          context.strokeStyle = "rgba(255, 255, 255, 0.28)";
          context.strokeRect(x + 0.5, y + 0.5, Math.max(1, w), Math.max(1, h));
          context.setLineDash([]);
        }
        const tagY = y > 13 ? y - 13 : y + 1;
        chip(context, element.ref, x + 1, tagY, {
          size: 9,
          colour: "rgba(255, 236, 190, 0.98)",
          background: "rgba(20, 16, 8, 0.82)",
        });
        drawn += 1;
      }
    }

    // Header: what this picture is, and how to address it.
    context.fillStyle = "#07090f";
    context.fillRect(0, 0, outW, bar);
    const gradient = context.createLinearGradient(0, 0, 0, bar);
    gradient.addColorStop(0, "rgba(18, 26, 44, 0.9)");
    gradient.addColorStop(1, "rgba(7, 9, 15, 0.2)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, outW, bar);
    context.fillStyle = "rgba(226, 238, 255, 0.94)";
    context.font = `600 ${Math.max(10, Math.round(bar / 2.4))}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    const title = options.zoom
      ? `zoom · ${shot.app}${shot.window ? ` — ${shot.window}` : ""} · ${Math.round(source.width)}×${Math.round(source.height)} pts`
      : `${shot.app}${shot.window ? ` — ${shot.window}` : ""} · ${Math.round(shot.width)}×${Math.round(shot.height)} pts`;
    context.fillText(title.slice(0, 96), 8, Math.round(bar * 0.66));
    context.fillStyle = "rgba(158, 190, 230, 0.78)";
    context.font = `500 ${Math.max(8, Math.round(bar / 3.4))}px "SF Mono", ui-monospace, monospace`;
    context.fillText(
      `grid ${cols}×${rows} · ref, cell ${COLUMNS[0]}1–${COLUMNS[cols - 1] ?? "?"}${rows}, or x/y 0–1`.slice(0, 110),
      8,
      bar - 4,
    );

    return {
      mime: "image/jpeg",
      data: canvas.toDataURL("image/jpeg", 0.86).split(",")[1] ?? "",
    };
  } catch {
    return undefined;
  }
}

/* ── reading ──────────────────────────────────────────────────────────── */

function round(value: number): number {
  return Math.round(value);
}

function elementName(element: ScreenElement): string {
  return element.title || element.value || element.subrole || element.role;
}

function describeTree(
  tree: ScreenTree | null,
  shot: ScreenShot | null,
  note?: string,
  vision = true,
): string {
  const head = tree
    ? `App: ${tree.app || "unknown"}${tree.window ? ` — window: ${tree.window}` : ""}`
    : "The accessibility tree is not available.";
  const frame = tree?.frame && tree.frame.width > 1 ? tree.frame : shot ? bounds(shot) : null;
  const geometry = frame
    ? `Window: ${Math.round(frame.width)}×${Math.round(frame.height)} points at ${Math.round(frame.x)},${Math.round(frame.y)}.`
    : "";
  const grid = vision
    ? "Grid: 16 columns A–P × 10 rows. A private copy of this window with the grid and every control boxed is attached to this result; the user never sees it. Click an element by ref (Lantas presses the control itself), a cell like \"G4\", or x/y as fractions of this window (0–1). screenX/screenY are absolute screen points."
    : "Click an element by ref (Lantas presses the control itself) or click a fraction of this window with x/y (0–1); screenX/screenY are absolute screen points. This model cannot see the picture, so use the exact rectangles below.";
  if (!tree) {
    return [note, head, geometry, grid].filter(Boolean).join("\n");
  }
  if (!tree.elements?.length) {
    return [
      note,
      head,
      geometry,
      grid,
      `No labelled controls were exposed by this window.${tree.truncated ? " The tree was truncated." : ""}`,
    ]
      .filter(Boolean)
      .join("\n");
  }
  const lines = tree.elements.slice(0, 120).map((element) => {
    const name = elementName(element);
    const value =
      element.value && element.value !== name
        ? `, value “${element.value.slice(0, 90)}”`
        : "";
    const state = element.enabled === false ? ", disabled" : element.focused ? ", focused" : "";
    return `${element.ref} ${element.role.replace(/^AX/, "")} “${name.slice(0, 120)}”${value}${state} — centre ${round(
      element.x + element.w / 2,
    )},${round(element.y + element.h / 2)} (${round(element.w)}×${round(element.h)})`;
  });
  return [
    note,
    head,
    geometry,
    grid,
    `${tree.elements.length} controls${tree.truncated ? " (truncated)" : ""}:`,
    ...lines,
  ]
    .filter(Boolean)
    .join("\n");
}

async function observe(vision: boolean, note?: string): Promise<ScreenSight> {
  let tree: ScreenTree | null = null;
  let treeProblem = "";
  try {
    tree = await readScreenTree();
  } catch (error) {
    treeProblem = error instanceof Error ? error.message : String(error);
  }
  // A text-only model never needs a picture, so no screenshot is taken at all.
  const shot = vision ? await captureShot() : latestShot;
  const image = vision && shot ? await annotate(shot, tree) : undefined;
  const content = describeTree(
    tree,
    shot,
    [note, treeProblem ? `Could not read the accessibility tree: ${treeProblem}` : ""]
      .filter(Boolean)
      .join("\n\n") || undefined,
    vision,
  );
  return { tree, shot, content, ...(image ? { images: [image] } : {}) };
}

/** One observation for the first turn of a screen conversation. */
export async function screenSight(vision = true): Promise<ScreenSight> {
  return await observe(vision);
}

/* ── coordinates ──────────────────────────────────────────────────────── */

function num(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCell(value: string): { column: number; row: number } | null {
  const match = /^([A-Pa-p])\s*([1-9]|10)$/.exec(value.trim());
  if (!match) return null;
  return {
    column: COLUMNS.indexOf(match[1].toUpperCase()),
    row: Number(match[2]) - 1,
  };
}

function frameFor(shot: ScreenShot | null, info: ScreenInfo | null): ScreenRect {
  if (shot) return bounds(shot);
  if (info) return { x: info.x, y: info.y, width: info.width, height: info.height };
  return { x: 0, y: 0, width: 1, height: 1 };
}

async function resolvePoint(args: Record<string, unknown>): Promise<{
  x: number;
  y: number;
  label?: string;
  element?: ScreenElement;
}> {
  const shot = latestShot ?? (await captureShot());
  const info = shot ? null : await screenInfo().catch(() => null);
  const frame = latestFrame ?? frameFor(shot, info);
  const label = typeof args.label === "string" ? args.label : undefined;

  const screenX = num(args.screenX ?? args.screen_x);
  const screenY = num(args.screenY ?? args.screen_y);
  if (screenX !== null && screenY !== null) {
    return { x: screenX, y: screenY, label };
  }

  const cell = String(args.cell ?? "").trim();
  if (cell) {
    const parsed = parseCell(cell);
    if (!parsed) {
      throw new Error(`“${cell}” is not a cell. Use a column A–P and a row 1–10, like G4.`);
    }
    return {
      x: frame.x + ((parsed.column + 0.5) / COLS) * frame.width,
      y: frame.y + ((parsed.row + 0.5) / ROWS) * frame.height,
      label: `cell ${cell.toUpperCase()}`,
    };
  }

  let normalizedX = num(args.x);
  let normalizedY = num(args.y);
  if (normalizedX !== null && normalizedY !== null) {
    // Models often answer on a 0–1000 grid. Accept it instead of treating 500
    // as 500 screens to the right.
    if (normalizedX > 1 || normalizedY > 1) {
      normalizedX /= 1000;
      normalizedY /= 1000;
    }
    normalizedX = Math.min(1, Math.max(0, normalizedX));
    normalizedY = Math.min(1, Math.max(0, normalizedY));
    return {
      x: frame.x + normalizedX * frame.width,
      y: frame.y + normalizedY * frame.height,
      label,
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
      "No target found. Call snapshot first, then use an element ref, a cell like G4, or x/y as fractions of the window.",
    );
  }
  return {
    x: element.x + element.w / 2,
    y: element.y + element.h / 2,
    label: elementName(element).slice(0, 60),
    element,
  };
}

/** A window-point rectangle for a zoom, from a ref, a cell or a centre point. */
async function resolveRegion(
  args: Record<string, unknown>,
  shot: ScreenShot | null,
): Promise<ScreenRect> {
  const frame = frameFor(shot, null);
  const pad = (rect: ScreenRect): ScreenRect => {
    const x = Math.max(frame.x, rect.x);
    const y = Math.max(frame.y, rect.y);
    return {
      x,
      y,
      width: Math.max(40, Math.min(frame.x + frame.width - x, rect.width)),
      height: Math.max(30, Math.min(frame.y + frame.height - y, rect.height)),
    };
  };
  const ref = String(args.ref ?? "").trim();
  if (ref) {
    const element = latestElements.find((item) => item.ref === ref || item.ref === `s${ref}`);
    if (!element) throw new Error("That ref is not in the latest snapshot.");
    const marginX = Math.max(18, element.w * 0.25);
    const marginY = Math.max(14, element.h * 0.3);
    return pad({
      x: element.x - marginX,
      y: element.y - marginY,
      width: element.w + marginX * 2,
      height: element.h + marginY * 2,
    });
  }
  const cell = String(args.cell ?? "").trim();
  if (cell) {
    const parsed = parseCell(cell);
    if (!parsed) throw new Error(`“${cell}” is not a cell.`);
    const width = frame.width / 3;
    const height = frame.height / 3;
    const centreX = frame.x + ((parsed.column + 0.5) / COLS) * frame.width;
    const centreY = frame.y + ((parsed.row + 0.5) / ROWS) * frame.height;
    return pad({
      x: centreX - width / 2,
      y: centreY - height / 2,
      width,
      height,
    });
  }
  const point = await resolvePoint(args);
  const width = Math.min(frame.width, (num(args.width) ?? 0.3) * frame.width);
  const height = Math.min(frame.height, (num(args.height) ?? 0.24) * frame.height);
  return pad({
    x: point.x - width / 2,
    y: point.y - height / 2,
    width,
    height,
  });
}

/* ── actions ──────────────────────────────────────────────────────────── */

async function pressElement(element: ScreenElement | undefined): Promise<boolean> {
  if (!element?.path) return false;
  try {
    await invoke<string>("screen_press", { path: element.path });
    return true;
  } catch {
    return false;
  }
}

async function focusElement(element: ScreenElement | undefined): Promise<boolean> {
  if (!element?.path) return false;
  try {
    await invoke("screen_focus_element", { path: element.path });
    return true;
  } catch {
    return false;
  }
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
  const readOnly = ["snapshot", "windows", "wait", "info", "zoom"].includes(action);
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
        content: `Main display: ${info.width}×${info.height} points at ${info.x},${info.y}. The agent works on the front window; take a snapshot to see its frame.`,
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

    if (action === "zoom" || action === "inspect") {
      const tree = await readScreenTree().catch(() => null);
      const shot = latestShot ?? (await captureShot());
      if (!shot) throw new Error("No window could be captured. Allow Screen Recording first.");
      const region = await resolveRegion(args, shot);
      const centreX = region.x + region.width / 2;
      const centreY = region.y + region.height / 2;
      const mapping = `Region ${round(region.x)},${round(region.y)} ${round(region.width)}×${round(
        region.height,
      )} inside ${shot.width}×${shot.height} at ${shot.x},${shot.y}. To click inside it, pass x/y as fractions of the whole window: ${(
        (centreX - shot.x) /
        Math.max(1, shot.width)
      ).toFixed(3)}, ${((centreY - shot.y) / Math.max(1, shot.height)).toFixed(3)}.`;

      if (!options.vision) {
        const inside = (tree?.elements ?? []).filter((element) =>
          intersects(
            { x: element.x, y: element.y, width: element.w, height: element.h },
            region,
          ),
        );
        return {
          ok: true,
          summary: `${inside.length} controls in the region`,
          content: [
            `Text-only zoom: the controls inside this region, with exact centres.`,
            mapping,
            ...inside
              .slice(0, 40)
              .map(
                (element) =>
                  `${element.ref} ${element.role.replace(/^AX/, "")} “${elementName(element).slice(0, 100)}” — centre ${round(
                    element.x + element.w / 2,
                  )},${round(element.y + element.h / 2)} (${round(element.w)}×${round(element.h)})`,
              ),
          ].join("\n"),
          resource,
        };
      }

      const image = await annotate(shot, tree, {
        crop: region,
        cols: 8,
        rows: 6,
        zoom: true,
      });
      return {
        ok: true,
        summary: `Zoomed ${round(region.width)}×${round(region.height)}`,
        content: [
          "Attached: a closer look at one region, with its own 8×6 grid.",
          mapping,
          "Use this to read small labels, then act with a ref, a cell from the full snapshot, or the fractions above.",
        ].join("\n"),
        resource,
        ...(image ? { images: [image] } : {}),
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
      // Let the pointer paint before the click lands, so the step is visible
      // even when the action itself is instant.
      await new Promise((resolve) => setTimeout(resolve, 70));
      let how = "clicked";
      if (button === "left" && count === 1 && point.element) {
        // Press the control itself when macOS exposes it. This lands even if a
        // tooltip or a floating card covers part of the element.
        if (await pressElement(point.element)) how = "pressed";
        else await clickScreen(point.x, point.y, button, count);
      } else {
        await clickScreen(point.x, point.y, button, count);
      }
      await new Promise((resolve) => setTimeout(resolve, 320));
      const seen = await observe(
        options.vision,
        `${how === "pressed" ? "Pressed" : "Clicked"} ${
          point.label ? `“${point.label}”` : "the screen"
        } at ${round(point.x)},${round(point.y)}${count > 1 ? ` (${count}×)` : ""}.`,
      );
      return {
        ok: true,
        summary: `${how === "pressed" ? "Pressed" : "Clicked"} ${point.label || "the screen"}`,
        content: seen.content,
        resource,
        ...(seen.images ? { images: seen.images } : {}),
      };
    }

    if (action === "type" || action === "write" || action === "fill" || action === "set_value") {
      const text = String(args.text ?? args.value ?? "");
      if (!text) throw new Error("Text to type is required.");
      const ref = String(args.ref ?? "").trim();
      const element = ref
        ? latestElements.find((item) => item.ref === ref || item.ref === `s${ref}`)
        : undefined;
      if (element) await showScreenCursor(
        { x: element.x + element.w / 2, y: element.y + element.h / 2 },
        { label: elementName(element).slice(0, 50), key: "⌨" },
      );
      let how = "typed";
      if (element?.path && (action === "fill" || action === "set_value" || args.replace)) {
        try {
          await invoke("screen_set_text", { path: element.path, text });
          how = "filled";
        } catch {
          // The field refused a direct value (common in web views). Click it so
          // the keystrokes land there instead of in the floating card.
          await clickScreen(element.x + element.w / 2, element.y + element.h / 2);
          await new Promise((resolve) => setTimeout(resolve, 120));
          await typeScreenText(text);
        }
      } else if (element) {
        const focused = await focusElement(element);
        if (!focused) {
          await clickScreen(element.x + element.w / 2, element.y + element.h / 2);
          await new Promise((resolve) => setTimeout(resolve, 140));
        }
        await typeScreenText(text);
      } else {
        await typeScreenText(text);
      }
      if (args.submit || args.enter) {
        await pressScreenKey("Return");
      }
      await new Promise((resolve) => setTimeout(resolve, 260));
      const seen = await observe(
        options.vision,
        `${how === "filled" ? "Filled" : "Typed"} ${text.length} character${
          text.length === 1 ? "" : "s"
        }${args.submit || args.enter ? " and pressed Return" : ""}.`,
      );
      return {
        ok: true,
        summary: `${how === "filled" ? "Filled" : "Typed"} ${text.length} characters`,
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
        await showScreenCursor(latestPoint, {
          label: dy < 0 ? "Scroll up" : "Scroll down",
          key: "↕",
        });
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
        ...(args.fromCell ? { cell: args.fromCell } : {}),
        ...(args.fromX !== undefined ? { x: args.fromX, y: args.fromY } : {}),
      });
      const end = args.toRef
        ? await resolvePoint({ ref: args.toRef })
        : args.toCell
          ? await resolvePoint({ cell: args.toCell })
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
        "Unknown screen action. Use snapshot, zoom, windows, focus, click, move, type, fill, key, scroll, drag, or wait.",
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
