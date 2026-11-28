import { useCallback, useEffect, useRef, useState } from "react";
import { hostOf } from "../lib/el";
import { Icon } from "./Icons";

export interface MiniPreview {
  url: string;
  nonce: number;
}

type Bounds = { x: number; y: number; width: number; height: number };

const STORE = "lantas.mini.bounds";
const MIN_W = 320;
const MIN_H = 220;

function clampBounds(bounds: Bounds): Bounds {
  const width = Math.min(Math.max(bounds.width, MIN_W), Math.max(MIN_W, window.innerWidth - 24));
  const height = Math.min(Math.max(bounds.height, MIN_H), Math.max(MIN_H, window.innerHeight - 120));
  return {
    width,
    height,
    x: Math.min(Math.max(bounds.x, 8), Math.max(8, window.innerWidth - width - 8)),
    y: Math.min(Math.max(bounds.y, 44), Math.max(44, window.innerHeight - height - 8)),
  };
}

function initialBounds(): Bounds {
  const fallback: Bounds = {
    x: Math.max(16, window.innerWidth - 500),
    y: 92,
    width: 452,
    height: 318,
  };
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORE) ?? "null") as Bounds | null;
    if (
      saved &&
      [saved.x, saved.y, saved.width, saved.height].every((value) => Number.isFinite(value))
    ) {
      return clampBounds(saved);
    }
  } catch {
    /* first run, or storage was cleared */
  }
  return clampBounds(fallback);
}

/**
 * A page the agent opens belongs in a small window over the surface the user
 * is already on, not in a forced jump to the Browser tab. This is a real
 * framed page with a drag bar, a resize corner and one explicit way out.
 */
export function MiniBrowser({
  preview,
  onClose,
  onOpen,
}: {
  preview: MiniPreview;
  onClose: () => void;
  onOpen: () => void;
}) {
  const [bounds, setBounds] = useState<Bounds>(initialBounds);
  const [loaded, setLoaded] = useState(false);
  const drag = useRef<{
    mode: "move" | "resize";
    startX: number;
    startY: number;
    origin: Bounds;
  } | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORE, JSON.stringify(bounds));
    } catch {
      /* private mode */
    }
  }, [bounds]);

  useEffect(() => {
    const keepInside = () => setBounds((current) => clampBounds(current));
    window.addEventListener("resize", keepInside);
    return () => window.removeEventListener("resize", keepInside);
  }, []);

  useEffect(() => setLoaded(false), [preview.url, preview.nonce]);

  const begin = useCallback(
    (mode: "move" | "resize", event: React.PointerEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      drag.current = {
        mode,
        startX: event.clientX,
        startY: event.clientY,
        origin: bounds,
      };
      document.documentElement.classList.add("is-dragging-mini");
    },
    [bounds],
  );

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = drag.current;
      if (!current) return;
      const dx = event.clientX - current.startX;
      const dy = event.clientY - current.startY;
      if (current.mode === "move") {
        setBounds(
          clampBounds({
            ...current.origin,
            x: current.origin.x + dx,
            y: current.origin.y + dy,
          }),
        );
        return;
      }
      setBounds(
        clampBounds({
          ...current.origin,
          width: current.origin.width + dx,
          height: current.origin.height + dy,
        }),
      );
    };
    const up = () => {
      drag.current = null;
      document.documentElement.classList.remove("is-dragging-mini");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.documentElement.classList.remove("is-dragging-mini");
    };
  }, []);

  const host = preview.url ? hostOf(preview.url) : "Preview";

  return (
    <div
      className="mini-browser"
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
      }}
      role="dialog"
      aria-label={`Preview of ${host}`}
    >
      <header className="mini-browser-bar" onPointerDown={(event) => begin("move", event)}>
        <span className="mini-browser-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="mini-browser-title">{host}</span>
        <button
          type="button"
          className="mini-browser-action"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onOpen}
          title="Open this page in the Browser tab"
        >
          <Icon name="external" size={11} />
          Open browser
        </button>
        <button
          type="button"
          className="mini-browser-close"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onClose}
          aria-label="Close preview"
          title="Close preview"
        >
          <Icon name="close" size={12} />
        </button>
      </header>

      <div className="mini-browser-stage">
        {!loaded && (
          <div className="mini-browser-loading" role="status">
            <span className="mini-browser-spinner" />
            Loading {host}
          </div>
        )}
        <iframe
          key={`${preview.url}-${preview.nonce}`}
          className="mini-browser-frame"
          src={preview.url}
          title={`Preview of ${host}`}
          onLoad={() => setLoaded(true)}
          referrerPolicy="no-referrer"
        />
      </div>

      <span
        className="mini-browser-resize"
        onPointerDown={(event) => begin("resize", event)}
        aria-hidden="true"
      />
    </div>
  );
}
