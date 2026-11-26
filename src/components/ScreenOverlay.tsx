import { useEffect, useRef } from "react";

/**
 * The transparent, click-through layer over the display.
 *
 * The window itself is created by the native side with no decorations, no
 * focus and cursor events ignored, so everything drawn here floats above other
 * apps without taking a single click. Marks fade on their own.
 */

interface Mark {
  x: number;
  y: number;
  label?: string;
  born: number;
}

const LIFETIME = 4200;

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

      if (marks.length) {
        raf = window.requestAnimationFrame(frame);
      } else {
        running = false;
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
      if (!running) {
        running = true;
        raf = window.requestAnimationFrame(frame);
      }
    };

    // The overlay is driven from the main window, and also from this window's
    // own event bus so it works whichever side sends.
    const listeners: Array<() => void> = [];
    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        listeners.push(await listen<{ x: number; y: number; label?: string }>("lantas:pointer", (event) => {
          const detail = event.payload;
          const custom = new CustomEvent("lantas:pointer", { detail });
          window.dispatchEvent(custom);
        }));
      } catch {
        /* not running inside the app shell */
      }
    })();
    window.addEventListener("lantas:pointer", push);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("lantas:pointer", push);
      for (const off of listeners) off();
      document.documentElement.classList.remove("is-overlay");
      document.body.classList.remove("is-overlay");
    };
  }, []);

  return <canvas className="screen-overlay-canvas" ref={canvasRef} aria-hidden="true" />;
}
