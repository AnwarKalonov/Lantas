import { useReducedMotion } from "motion/react";

/**
 * One timing scale for the whole app, taken from the ux-motion rules:
 * feedback 100-150ms, most transitions 150-300ms, large moves up to 400ms,
 * and every exit runs at roughly half the entry.
 */
export const DUR = {
  press: 0.11,
  fast: 0.15,
  base: 0.24,
  panel: 0.36,
} as const;

export const EASE = {
  out: [0.16, 1, 0.3, 1] as [number, number, number, number],
  in: [0.7, 0, 0.84, 0] as [number, number, number, number],
  move: [0.65, 0, 0.35, 1] as [number, number, number, number],
};

/** No overshoot, no blur: a short fade and a small rise. */
export const enter = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
};

export const panelEnter = {
  initial: { opacity: 0, y: 10, scale: 0.995 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -6, scale: 0.998 },
};

export const popoverEnter = {
  initial: { opacity: 0, scale: 0.97, y: -4 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.985, y: -2 },
};

/**
 * Respects the OS preference and the app's own "Reduce motion" setting,
 * which is applied as a class on <html> from App state.
 */
export function useStill(): boolean {
  const system = useReducedMotion();
  if (typeof document === "undefined") return Boolean(system);
  return Boolean(system) || document.documentElement.classList.contains("reduce-motion");
}

/** Zero-duration transitions for when motion is turned off. */
export function timing(preferred: number, still: boolean) {
  return { duration: still ? 0 : preferred, ease: EASE.out };
}
