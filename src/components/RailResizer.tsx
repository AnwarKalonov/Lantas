import { useCallback, useEffect, useRef, useState } from "react";

const MIN = 268;
const MAX = 560;

function clamp(value: number) {
  const room = typeof window === "undefined" ? MAX : window.innerWidth - 380;
  return Math.round(Math.max(MIN, Math.min(value, Math.max(MIN, Math.min(MAX, room)))));
}

/**
 * The side chat is a workspace, not a fixed strip. Every rail remembers the
 * width the user dragged it to, so the choice survives a tab switch and a
 * relaunch.
 */
export function useRailWidth(storageKey: string, initial: number) {
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(window.localStorage.getItem(storageKey));
      return Number.isFinite(saved) && saved > 0 ? clamp(saved) : clamp(initial);
    } catch {
      return clamp(initial);
    }
  });
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(width));
    } catch {
      /* private mode */
    }
  }, [storageKey, width]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    drag.current = { startX: event.clientX, startWidth: width };
    document.documentElement.classList.add("is-resizing-rail");

    const move = (next: PointerEvent) => {
      if (!drag.current) return;
      setWidth(clamp(drag.current.startWidth - (next.clientX - drag.current.startX)));
    };
    const up = () => {
      drag.current = null;
      document.documentElement.classList.remove("is-resizing-rail");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, [width]);

  return { width, onPointerDown };
}

export function RailResizer({
  onPointerDown,
  label,
}: {
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  label: string;
}) {
  return (
    <span
      className="rail-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      onPointerDown={onPointerDown}
    >
      <span />
    </span>
  );
}
