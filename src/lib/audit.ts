import { uid } from "./util";

/**
 * A small local record of permission decisions. It answers "what did the agent
 * try to do, and did I allow it?" without sending anything anywhere.
 */

export interface AuditEntry {
  id: string;
  at: number;
  tool: string;
  resource: string;
  decision: "allowed" | "denied";
}

const STORAGE_KEY = "lantas.permission-audit.v1";
const LIMIT = 200;
const EVENT = "lantas:audit";

export function recordAudit(entry: Omit<AuditEntry, "id" | "at">): void {
  try {
    const current = getAuditLog();
    const next = [
      { ...entry, id: uid("audit"), at: Date.now() },
      ...current,
    ].slice(0, LIMIT);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    // A full or unavailable localStorage should never block a run.
  }
}

export function getAuditLog(): AuditEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as AuditEntry[]) : [];
    return Array.isArray(parsed) ? parsed.slice(0, LIMIT) : [];
  } catch {
    return [];
  }
}

export function clearAuditLog(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* ignore */
  }
}

export function subscribeAudit(handler: () => void): () => void {
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
