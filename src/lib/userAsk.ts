import { uid } from "./util";

/**
 * A question the browser agent cannot answer from the page.
 *
 * The tool loop waits on this promise, so the turn genuinely pauses instead
 * of the model guessing a password or ending with a question the user cannot
 * answer in place. Answers live only in memory for the tool call; they are not
 * added to the transcript or written into the session file.
 */

export type UserAskKind = "text" | "email" | "password" | "credentials";

export interface UserAsk {
  id: string;
  question: string;
  kind: UserAskKind;
}

interface PendingAsk {
  ask: UserAsk;
  resolve: (answer: string) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

let pending: PendingAsk | null = null;
const listeners = new Set<(ask: UserAsk | null) => void>();

function publish() {
  const current = pending?.ask ?? null;
  for (const listener of listeners) listener(current);
}

function cleanup() {
  const current = pending;
  pending = null;
  if (current?.signal && current.onAbort) {
    current.signal.removeEventListener("abort", current.onAbort);
  }
  publish();
}

export function getActiveUserAsk(): UserAsk | null {
  return pending?.ask ?? null;
}

export function subscribeUserAsk(listener: (ask: UserAsk | null) => void): () => void {
  listeners.add(listener);
  listener(getActiveUserAsk());
  return () => listeners.delete(listener);
}

export function askUser(
  input: { question: string; kind?: UserAskKind },
  signal?: AbortSignal,
): Promise<string> {
  if (pending) {
    return Promise.reject(
      new Error("Another question is already waiting for an answer in this window."),
    );
  }
  if (signal?.aborted) {
    return Promise.reject(new DOMException("aborted", "AbortError"));
  }
  return new Promise<string>((resolve, reject) => {
    const ask: UserAsk = {
      id: uid("ask"),
      question: input.question,
      kind: input.kind ?? "text",
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("aborted", "AbortError"));
    };
    pending = { ask, resolve, reject, signal, onAbort };
    signal?.addEventListener("abort", onAbort, { once: true });
    publish();
  });
}

export function answerUserAsk(id: string, answer: string): boolean {
  if (!pending || pending.ask.id !== id) return false;
  const { resolve } = pending;
  cleanup();
  resolve(answer);
  return true;
}

export function skipUserAsk(id: string): boolean {
  if (!pending || pending.ask.id !== id) return false;
  const { resolve } = pending;
  cleanup();
  resolve("The user skipped the question. Do not guess; continue only with what you can verify, or explain what is blocked.");
  return true;
}
