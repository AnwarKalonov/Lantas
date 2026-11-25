import { getProvider, httpFetch, resolveBase } from "./providers";
import type { ProviderConfig, ProviderId } from "./types";

/**
 * Client for the local browser engine (engine/browser_engine.py), which runs
 * browser-use in its own process and drives a real Chromium over CDP.
 *
 * The app keeps its own step-by-step agent for ordinary clicking; this is for
 * a whole browsing job ("open Mathway and solve 2x+4=10"), where a real browser
 * with trusted input and a persistent profile does better than synthetic events
 * inside the embedded webview. If the engine is not running, nothing breaks:
 * callers fall back and tell the user how to start it.
 */

const URL_KEY = "lantas.engine.url";
const DEFAULT_URL = "http://127.0.0.1:8765";

export function engineUrl(): string {
  try {
    return (localStorage.getItem(URL_KEY) || "").trim() || DEFAULT_URL;
  } catch {
    return DEFAULT_URL;
  }
}

export function setEngineUrl(url: string) {
  try {
    const value = url.trim();
    if (value) localStorage.setItem(URL_KEY, value);
    else localStorage.removeItem(URL_KEY);
  } catch {
    /* storage unavailable */
  }
  health = null;
}

type EngineModel = {
  provider: ProviderId;
  model: string;
  config: ProviderConfig;
};

let current: EngineModel | null = null;

/** Called with the session's provider before a turn so the engine uses it too. */
export function setEngineModel(next: EngineModel | null) {
  current = next;
}

export interface EngineHealth {
  ok: boolean;
  detail: string;
  version?: string;
}

let health: { at: number; value: EngineHealth } | null = null;

/** Cheap and cached: the tool calls this before every delegated task. */
export async function engineHealth(force = false): Promise<EngineHealth> {
  if (!force && health && Date.now() - health.at < 10_000) return health.value;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_500);
  try {
    const response = await httpFetch(`${engineUrl()}/health`, {
      signal: controller.signal,
    } as RequestInit);
    if (!response.ok) throw new Error(String(response.status));
    const data = (await response.json()) as { ok?: boolean; version?: string; error?: string };
    const value: EngineHealth = data.ok
      ? { ok: true, detail: `browser-use ${data.version ?? "ready"}`, version: data.version }
      : { ok: false, detail: data.error || "The browser engine is starting up." };
    health = { at: Date.now(), value };
    return value;
  } catch {
    const value: EngineHealth = {
      ok: false,
      detail: `No browser engine at ${engineUrl()}. Start it with: bash engine/run.sh`,
    };
    health = { at: Date.now(), value };
    return value;
  } finally {
    clearTimeout(timer);
  }
}

export interface EngineTaskResult {
  ok: boolean;
  result: string;
  steps: string[];
  error?: string;
}

/**
 * Hands the whole task to browser-use. It plans its own steps and returns one
 * answer; the app shows those steps as activity so the user can see it working.
 */
export async function engineTask(task: string, maxSteps = 25): Promise<EngineTaskResult> {
  const state = await engineHealth();
  if (!state.ok) return { ok: false, result: "", steps: [], error: state.detail };

  const active = current;
  if (!active) {
    return {
      ok: false,
      result: "",
      steps: [],
      error: "Pick a model for this chat first; the browser engine uses the same one.",
    };
  }

  const meta = getProvider(active.provider);
  const base = resolveBase(active.config, meta);
  const controller = new AbortController();
  // A browsing job is long, but it must never hang the turn forever.
  const timer = setTimeout(() => controller.abort(), 15 * 60 * 1000);

  try {
    const response = await httpFetch(`${engineUrl()}/task`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        task,
        model: active.model,
        kind: meta.kind,
        apiKey: (active.config.apiKey || "").trim(),
        // Ollama speaks the OpenAI shape under /v1; the app's base URL is bare.
        baseUrl: meta.kind === "ollama" && base ? `${base.replace(/\/+$/, "")}/v1` : base,
        maxSteps,
      }),
      signal: controller.signal,
    } as RequestInit);

    const data = (await response.json()) as {
      ok?: boolean;
      result?: string;
      steps?: string[];
      error?: string;
    };
    return {
      ok: Boolean(data.ok),
      result: String(data.result ?? "").trim(),
      steps: Array.isArray(data.steps) ? data.steps : [],
      error: data.ok ? undefined : String(data.error ?? "The browser engine failed."),
    };
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === "AbortError";
    return {
      ok: false,
      result: "",
      steps: [],
      error: aborted
        ? "The browser task ran past 15 minutes and was stopped."
        : `The browser engine did not answer: ${
            error instanceof Error ? error.message : String(error)
          }`,
    };
  } finally {
    clearTimeout(timer);
  }
}
