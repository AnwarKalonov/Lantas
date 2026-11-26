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

export type UserAskFieldType =
  | "text"
  | "email"
  | "password"
  | "number"
  | "tel"
  | "url"
  | "textarea"
  | "select";

/** One labelled input in the reply card: “Name”, “Age”, “Country”… */
export interface UserAskField {
  label: string;
  type?: UserAskFieldType;
  placeholder?: string;
  /** Choices for `select`; also makes the field a picker. */
  options?: string[];
  optional?: boolean;
}

export interface UserAsk {
  id: string;
  question: string;
  kind: UserAskKind;
  /** A titled box per detail, so the user knows exactly what to type. */
  fields?: UserAskField[];
  /** A multiple-choice question; one click per answer. */
  options?: string[];
  multiple?: boolean;
}

export interface UserAskExtra {
  fields?: UserAskField[];
  options?: string[];
  multiple?: boolean;
}

const FIELD_TYPES: UserAskFieldType[] = [
  "text",
  "email",
  "password",
  "number",
  "tel",
  "url",
  "textarea",
  "select",
];

function cleanFields(input: UserAskField[] | undefined): UserAskField[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const fields: UserAskField[] = [];
  for (const field of input) {
    const label = String(field?.label ?? "").trim().slice(0, 80);
    if (!label) continue;
    const requested = String(field?.type ?? "text").toLowerCase();
    const type: UserAskFieldType = FIELD_TYPES.includes(requested as UserAskFieldType)
      ? (requested as UserAskFieldType)
      : "text";
    const options = Array.isArray(field?.options)
      ? field.options
          .map((option) => String(option).trim().slice(0, 80))
          .filter(Boolean)
          .slice(0, 12)
      : undefined;
    fields.push({
      label,
      type: options?.length ? "select" : type,
      placeholder: field?.placeholder ? String(field.placeholder).slice(0, 120) : undefined,
      options,
      optional: Boolean(field?.optional),
    });
    if (fields.length === 6) break;
  }
  return fields.length ? fields : undefined;
}

function cleanOptions(input: string[] | undefined): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const options = input
    .map((option) => String(option).trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 10);
  return options.length ? options : undefined;
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
  input: { question: string; kind?: UserAskKind } & UserAskExtra,
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
    const fields = cleanFields(input.fields);
    const options = cleanOptions(input.options);
    const ask: UserAsk = {
      id: uid("ask"),
      question: input.question,
      kind: input.kind ?? "text",
      ...(fields ? { fields } : {}),
      ...(options ? { options, multiple: Boolean(input.multiple) } : {}),
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
