import { useEffect, useRef } from "react";

/**
 * The transparent, click-through layer over the display.
 *
 * The window itself is created by the native side with no decorations, no
 * focus and cursor events ignored, so everything drawn here floats above other
 * apps without taking a single click. Marks fade on their own; the blue Lantas
 * pointer follows the real pointer while the screen card controls the Mac.
 */

interface Mark {
  x: number;
  y: number;
  label?: string;
  born: number;
}

interface Cursor {
  x: number;
  y: number;
  label?: string;
  key?: string;
  born: number;
  downAt: number;
}

const LIFETIME = 4200;
// The pointer is the only sign of what the screen agent is doing. It used to
// vanish after 3.2s, mid-task, which made a slow step look like a failure.
const CURSOR_LIFETIME = 12_000;

export function ScreenOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    document.documentElement.classList.add("is-overlay");
    document.body.classList.add("is-overlay");
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const marks: Mark[] = [];
    let cursor: Cursor | null = null;
    let raf = 0;
    let running = false;
    let width = 0;
    let height = 0;
    let dpr = 1;

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    };
    resize();
    window.addEventListener("resize", resize);

    const ease = (t: number) => 1 - Math.pow(1 - t, 3);

    const drawCursor = (now: number) => {
      if (!cursor) return;
      const age = now - cursor.born;
      if (age > CURSOR_LIFETIME) {
        cursor = null;
        return;
      }
      const fadeOut = Math.max(0, (age - (CURSOR_LIFETIME - 520)) / 520);
      const alpha = 1 - fadeOut;
      const x = cursor.x * width;
      const y = cursor.y * height;

      // A soft blue halo so the pointer reads on dark and light windows.
      const halo = context.createRadialGradient(x, y, 2, x, y, 54);
      halo.addColorStop(0, `rgba(76, 140, 255, ${0.4 * alpha})`);
      halo.addColorStop(1, "rgba(76, 140, 255, 0)");
      context.fillStyle = halo;
      context.beginPath();
      context.arc(x, y, 54, 0, Math.PI * 2);
      context.fill();

      // A slow breathing ring says “still working” without moving the pointer.
      const breath = 1 + Math.sin(now / 340) * 0.07;
      context.beginPath();
      context.arc(x, y, 24 * breath, 0, Math.PI * 2);
      context.lineWidth = 1.3;
      context.strokeStyle = `rgba(120, 178, 255, ${0.45 * alpha})`;
      context.stroke();

      // The pointer itself: the same shape as a cursor, in Lantas blue.
      context.save();
      context.translate(x, y);
      context.scale(1.22, 1.22);
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(0, 19);
      context.lineTo(5.4, 15);
      context.lineTo(8.9, 22.6);
      context.lineTo(12.4, 20.9);
      context.lineTo(9.1, 13.5);
      context.lineTo(14.8, 13.1);
      context.closePath();
      context.fillStyle = `rgba(76, 140, 255, ${alpha})`;
      context.fill();
      context.lineWidth = 1.4;
      context.strokeStyle = `rgba(235, 244, 255, ${alpha})`;
      context.stroke();
      context.restore();

      // A click leaves a short blue ripple where it landed.
      const clickAge = now - cursor.downAt;
      if (cursor.downAt && clickAge < 620) {
        const t = clickAge / 620;
        context.beginPath();
        context.arc(x, y, 12 + 34 * ease(t), 0, Math.PI * 2);
        context.lineWidth = 2.5 * (1 - t);
        context.strokeStyle = `rgba(92, 160, 255, ${0.85 * (1 - t)})`;
        context.stroke();
      }

      const label = [cursor.key, cursor.label].filter(Boolean).join(" ") || "Lantas";
      context.font = "600 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      const text = label.slice(0, 48);
      const textWidth = context.measureText(text).width;
      const boxW = textWidth + 18;
      const boxH = 23;
      const boxX = Math.min(Math.max(8, x + 16), width - boxW - 8);
      const boxY = y + 26 + boxH > height ? y - 28 - boxH : y + 26;
      context.fillStyle = `rgba(12, 20, 38, ${0.9 * alpha})`;
      context.beginPath();
      if (typeof context.roundRect === "function") {
        context.roundRect(boxX, boxY, boxW, boxH, 7);
      } else {
        context.rect(boxX, boxY, boxW, boxH);
      }
      context.fill();
      context.strokeStyle = `rgba(92, 160, 255, ${0.65 * alpha})`;
      context.lineWidth = 1;
      context.stroke();
      context.fillStyle = `rgba(214, 231, 255, ${alpha})`;
      context.fillText(text, boxX + 9, boxY + 15);
    };

    const frame = (now: number) => {
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      for (let index = marks.length - 1; index >= 0; index -= 1) {
        const mark = marks[index];
        const age = now - mark.born;
        if (age > LIFETIME) {
          marks.splice(index, 1);
          continue;
        }
        const inT = Math.min(1, age / 260);
        const outT = Math.max(0, (age - (LIFETIME - 620)) / 620);
        const alpha = ease(inT) * (1 - outT);
        const x = mark.x * width;
        const y = mark.y * height;
        const radius = (30 + 34 * ease(inT)) * (1 + 0.02 * Math.sin(age / 240));

        // A soft halo, then the ring: readable on a light page and a dark one.
        const halo = context.createRadialGradient(x, y, radius * 0.2, x, y, radius * 1.55);
        halo.addColorStop(0, `rgba(255, 214, 102, ${0.24 * alpha})`);
        halo.addColorStop(1, "rgba(255, 214, 102, 0)");
        context.fillStyle = halo;
        context.beginPath();
        context.arc(x, y, radius * 1.55, 0, Math.PI * 2);
        context.fill();

        context.strokeStyle = `rgba(255, 214, 102, ${alpha})`;
        context.lineWidth = 3;
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.stroke();

        if (mark.label) {
          context.font = "600 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
          const label = mark.label.slice(0, 40);
          const textWidth = context.measureText(label).width;
          const boxW = textWidth + 20;
          const boxH = 28;
          const boxX = Math.min(Math.max(8, x - boxW / 2), width - boxW - 8);
          const boxY = y + radius + 10 + boxH > height ? y - radius - 10 - boxH : y + radius + 10;
          context.fillStyle = `rgba(12, 12, 11, ${0.92 * alpha})`;
          context.beginPath();
          if (typeof context.roundRect === "function") {
            context.roundRect(boxX, boxY, boxW, boxH, 8);
          } else {
            context.rect(boxX, boxY, boxW, boxH);
          }
          context.fill();
          context.strokeStyle = `rgba(255, 214, 102, ${0.5 * alpha})`;
          context.lineWidth = 1;
          context.stroke();
          context.fillStyle = `rgba(255, 232, 168, ${alpha})`;
          context.fillText(label, boxX + 10, boxY + 18.5);
        }
      }

      drawCursor(now);

      const cursorAlive = cursor !== null;
      if (marks.length || cursorAlive) {
        raf = window.requestAnimationFrame(frame);
      } else {
        running = false;
      }
    };

    const start = () => {
      if (!running) {
        running = true;
        raf = window.requestAnimationFrame(frame);
      }
    };

    const push = (event: Event) => {
      const detail = (event as CustomEvent<{ x?: number; y?: number; label?: string }>).detail;
      const x = Number(detail?.x);
      const y = Number(detail?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      marks.push({
        x: Math.min(1, Math.max(0, x)),
        y: Math.min(1, Math.max(0, y)),
        label: detail?.label,
        born: performance.now(),
      });
      start();
    };

    const pushCursor = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          x?: number;
          y?: number;
          label?: string;
          key?: string;
          down?: boolean;
          hide?: boolean;
        }>
      ).detail;
      if (!detail || detail.hide) {
        cursor = null;
        start();
        return;
      }
      const x = Number(detail.x);
      const y = Number(detail.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const now = performance.now();
      cursor = {
        x: Math.min(1, Math.max(0, x)),
        y: Math.min(1, Math.max(0, y)),
        label: detail.label,
        key: detail.key,
        born: now,
        downAt: detail.down ? now : cursor?.downAt ?? 0,
      };
      start();
    };

    // The overlay is driven from the screen card, and also from this window's
    // own event bus so it works whichever side sends.
    const listeners: Array<() => void> = [];
    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        listeners.push(
          await listen<{ x: number; y: number; label?: string }>("lantas:pointer", (event) => {
            const custom = new CustomEvent("lantas:pointer", { detail: event.payload });
            window.dispatchEvent(custom);
          }),
        );
        listeners.push(
          await listen<Record<string, unknown>>("lantas:screen-cursor", (event) => {
            const custom = new CustomEvent("lantas:screen-cursor", { detail: event.payload });
            window.dispatchEvent(custom);
          }),
        );
      } catch {
        /* not running inside the app shell */
      }
    })();
    window.addEventListener("lantas:pointer", push);
    window.addEventListener("lantas:screen-cursor", pushCursor);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("lantas:pointer", push);
      window.removeEventListener("lantas:screen-cursor", pushCursor);
      for (const off of listeners) off();
      document.documentElement.classList.remove("is-overlay");
      document.body.classList.remove("is-overlay");
    };
  }, []);

  return <canvas className="screen-overlay-canvas" ref={canvasRef} aria-hidden="true" />;
}
