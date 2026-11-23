import { useSyncExternalStore } from "react";

/**
 * A tiny in-memory trace of what the assistant is doing in the browser.
 *
 * The coding loop already receives verified page results. This store mirrors
 * those steps into one live object so the chat can show a small browser view
 * while the full Browser tab stays one click away.
 */

export interface BrowserActivityStep {
  id: string;
  text: string;
  tone: "run" | "done" | "error";
  at: number;
}

export interface BrowserActivityState {
  active: boolean;
  prompt: string;
  action: string;
  status: string;
  url: string;
  title: string;
  steps: BrowserActivityStep[];
  startedAt: number;
  updatedAt: number;
}

const EMPTY: BrowserActivityState = {
  active: false,
  prompt: "",
  action: "",
  status: "",
  url: "",
  title: "",
  steps: [],
  startedAt: 0,
  updatedAt: 0,
};

let snapshot: BrowserActivityState = EMPTY;
const listeners = new Set<() => void>();

function publish(next: BrowserActivityState) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function stepId() {
  return `bstep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function beginBrowserActivity(prompt = "", action = "Opening the browser") {
  const now = Date.now();
  publish({
    active: true,
    prompt,
    action,
    status: action,
    url: "",
    title: "",
    steps: [{ id: stepId(), text: action, tone: "run", at: now }],
    startedAt: now,
    updatedAt: now,
  });
}

export function updateBrowserActivity(patch: {
  action?: string;
  status?: string;
  url?: string;
  title?: string;
  done?: boolean;
  error?: boolean;
}) {
  if (!snapshot.active && !snapshot.steps.length) return;
  const now = Date.now();
  const text = patch.status ?? patch.action;
  const steps = text
    ? [
        ...snapshot.steps.slice(-5),
        {
          id: stepId(),
          text,
          tone: patch.error ? ("error" as const) : patch.done ? ("done" as const) : ("run" as const),
          at: now,
        },
      ]
    : snapshot.steps;
  publish({
    ...snapshot,
    active: patch.done ? false : snapshot.active,
    action: patch.action ?? snapshot.action,
    status: text ?? snapshot.status,
    url: patch.url ?? snapshot.url,
    title: patch.title ?? snapshot.title,
    steps,
    updatedAt: now,
  });
}

export function finishBrowserActivity(status?: string) {
  if (!snapshot.active && !snapshot.steps.length) return;
  const now = Date.now();
  publish({
    ...snapshot,
    active: false,
    status: status ?? snapshot.status,
    steps: status
      ? [...snapshot.steps.slice(-5), { id: stepId(), text: status, tone: "done", at: now }]
      : snapshot.steps,
    updatedAt: now,
  });
}

export function dismissBrowserActivity() {
  publish(EMPTY);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useBrowserActivity(): BrowserActivityState {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}
