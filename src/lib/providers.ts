import type { ProviderConfig, ProviderId, ProviderMeta } from "./types";
import { PROVIDERS } from "./data";

/* ------------------------------------------------------------------ *
 * HTTP bridge
 *
 * In the browser we use fetch, which is subject to CORS. Inside the
 * Tauri shell the http plugin routes through Rust instead, so any
 * provider works and API keys never hit a browser CORS preflight.
 * ------------------------------------------------------------------ */

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function httpFetch(input: string, init: RequestInit): Promise<Response> {
  if (inTauri) {
    try {
      const mod = await import("@tauri-apps/plugin-http");
      return await mod.fetch(input, init as never);
    } catch {
      /* plugin missing or blocked — fall back to webview fetch */
    }
  }
  return fetch(input, init);
}

export function getProvider(id: ProviderId): ProviderMeta {
  return PROVIDERS.find((provider) => provider.id === id) ?? PROVIDERS[0];
}

export function resolveBase(config: ProviderConfig, meta: ProviderMeta): string {
  const base = (config.baseUrl || meta.baseUrl).trim().replace(/\/+$/, "");
  return base;
}

const PRETTY: Record<string, string> = {
  "claude-opus-4-5": "Opus 4.5",
  "claude-sonnet-4-5": "Sonnet 4.5",
  "claude-haiku-4-5": "Haiku 4.5",
  "gpt-5.1": "GPT-5.1",
  "gpt-5.1-mini": "GPT-5.1 mini",
  "gpt-4.1": "GPT-4.1",
  "gemini-4-argon": "Gemini 4 Argon",
  "gemini-3.8-flash": "Gemini 3.8 Flash",
  "gemini-3.6-flash": "Gemini 3.6 Flash",
  "gemini-3.5-flash-lite": "Gemini 3.5 Flash-Lite",
  "gemini-2.5-pro": "Gemini 2.5 Pro",
  "gemini-2.5-flash": "Gemini 2.5 Flash",
  "anthropic/claude-opus-4.5": "Claude Opus 4.5",
  "openai/gpt-5.1": "GPT-5.1",
  "google/gemini-3-pro": "Gemini 3 Pro",
  "qwen/qwen3-coder": "Qwen3 Coder",
  "llama-3.3-70b-versatile": "Llama 3.3 70B",
  "qwen-3-32b": "Qwen3 32B",
  "moonshotai/kimi-k2-instruct": "Kimi K2",
  "qwen3-coder:30b": "Qwen3 Coder 30B",
  "llama3.3:latest": "Llama 3.3",
  "deepseek-r1:14b": "DeepSeek R1 14B",
};

export function prettyModel(model: string): string {
  return PRETTY[model] ?? model.replace(/^[a-z0-9-]+\//i, "");
}

export function isConfigured(id: ProviderId, config: ProviderConfig): boolean {
  const meta = getProvider(id);
  if (!config.enabled) return false;
  if (meta.needsKey && !config.apiKey.trim()) return false;
  return Boolean(resolveBase(config, meta));
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface StreamUsage {
  input?: number;
  output?: number;
}

export interface StreamOptions {
  provider: ProviderId;
  config: ProviderConfig;
  model: string;
  system?: string;
  messages: ChatTurn[];
  signal: AbortSignal;
  onDelta: (text: string) => void;
  onUsage?: (usage: StreamUsage) => void;
}

/* ------------------------------------------------------------------ *
 * Line reader shared by SSE and NDJSON
 * ------------------------------------------------------------------ */

async function readLines(
  response: Response,
  onLine: (line: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("This provider returned an empty response body.");
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    if (signal.aborted) {
      reader.cancel().catch(() => {});
      throw new DOMException("aborted", "AbortError");
    }
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) onLine(line.replace(/\r$/, ""));
  }
  if (buffer.trim()) onLine(buffer.trim());
}

function ssePayload(line: string): string | null {
  if (!line.startsWith("data:")) return null;
  return line.slice(5).trim();
}

/* ------------------------------------------------------------------ *
 * Anthropic Messages API
 * ------------------------------------------------------------------ */

async function streamAnthropic(options: StreamOptions): Promise<void> {
  const meta = getProvider("anthropic");
  const base = resolveBase(options.config, meta);

  const response = await httpFetch(`${base}/v1/messages`, {
    method: "POST",
    signal: options.signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": options.config.apiKey.trim(),
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: options.model,
      max_tokens: 4096,
      stream: true,
      ...(options.system ? { system: options.system } : {}),
      messages: options.messages,
    }),
  });

  if (!response.ok) throw await httpError(response);

  await readLines(
    response,
    (line) => {
      const payload = ssePayload(line);
      if (!payload || payload === "[DONE]") return;
      let event: any;
      try {
        event = JSON.parse(payload);
      } catch {
        return;
      }
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        options.onDelta(event.delta.text ?? "");
      }
      if (event.type === "message_start") {
        options.onUsage?.({ input: event.message?.usage?.input_tokens });
      }
      if (event.type === "message_delta" && event.usage) {
        options.onUsage?.({ output: event.usage.output_tokens });
      }
      if (event.type === "error") {
        throw new Error(event.error?.message ?? "Anthropic returned an error.");
      }
    },
    options.signal,
  );
}

/* ------------------------------------------------------------------ *
 * OpenAI-compatible chat completions (OpenAI, OpenRouter, Groq,
 * LM Studio, custom gateways)
 * ------------------------------------------------------------------ */

async function streamOpenAI(options: StreamOptions): Promise<void> {
  const meta = getProvider(options.provider);
  const base = resolveBase(options.config, meta);
  const messages = [
    ...(options.system ? [{ role: "system", content: options.system }] : []),
    ...options.messages,
  ];

  const response = await httpFetch(`${base}/chat/completions`, {
    method: "POST",
    signal: options.signal,
    headers: {
      "content-type": "application/json",
      ...(options.config.apiKey.trim()
        ? { authorization: `Bearer ${options.config.apiKey.trim()}` }
        : {}),
    },
    body: JSON.stringify({
      model: options.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    }),
  });

  if (!response.ok) throw await httpError(response);

  await readLines(
    response,
    (line) => {
      const payload = ssePayload(line);
      if (!payload || payload === "[DONE]") return;
      let event: any;
      try {
        event = JSON.parse(payload);
      } catch {
        return;
      }
      const delta = event.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) options.onDelta(delta);
      if (event.usage) {
        options.onUsage?.({
          input: event.usage.prompt_tokens,
          output: event.usage.completion_tokens,
        });
      }
      if (event.error) throw new Error(event.error.message ?? "Provider returned an error.");
    },
    options.signal,
  );
}

/* ------------------------------------------------------------------ *
 * Google Gemini (streaming generateContent)
 * ------------------------------------------------------------------ */

async function streamGoogle(options: StreamOptions): Promise<void> {
  const meta = getProvider("google");
  const base = resolveBase(options.config, meta);

  const contents = options.messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));

  const response = await httpFetch(
    `${base}/models/${encodeURIComponent(options.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(
      options.config.apiKey.trim(),
    )}`,
    {
      method: "POST",
      signal: options.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents,
        ...(options.system ? { systemInstruction: { parts: [{ text: options.system }] } } : {}),
      }),
    },
  );

  if (!response.ok) throw await httpError(response);

  await readLines(
    response,
    (line) => {
      const payload = ssePayload(line);
      if (!payload) return;
      let event: any;
      try {
        event = JSON.parse(payload);
      } catch {
        return;
      }
      const text = event.candidates?.[0]?.content?.parts
        ?.map((part: any) => part.text ?? "")
        .join("");
      if (text) options.onDelta(text);
      if (event.usageMetadata) {
        options.onUsage?.({
          input: event.usageMetadata.promptTokenCount,
          output: event.usageMetadata.candidatesTokenCount,
        });
      }
    },
    options.signal,
  );
}

/* ------------------------------------------------------------------ *
 * Ollama native chat API
 * ------------------------------------------------------------------ */

async function streamOllama(options: StreamOptions): Promise<void> {
  const meta = getProvider("ollama");
  const base = resolveBase(options.config, meta);
  const messages = [
    ...(options.system ? [{ role: "system", content: options.system }] : []),
    ...options.messages,
  ];

  const response = await httpFetch(`${base}/api/chat`, {
    method: "POST",
    signal: options.signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: options.model, messages, stream: true }),
  });

  if (!response.ok) throw await httpError(response);

  await readLines(
    response,
    (line) => {
      if (!line.trim()) return;
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      const chunk = event.message?.content;
      if (typeof chunk === "string" && chunk) options.onDelta(chunk);
      if (event.error) throw new Error(event.error);
      if (event.done) {
        options.onUsage?.({ input: event.prompt_eval_count, output: event.eval_count });
      }
    },
    options.signal,
  );
}

async function httpError(response: Response): Promise<Error> {
  let detail = "";
  try {
    const text = await response.text();
    detail = text.slice(0, 400);
  } catch {
    /* ignore */
  }
  const auth = response.status === 401 || response.status === 403;
  const hint = auth ? " Check the API key in Settings → Providers." : "";
  return new Error(`${response.status} ${response.statusText}.${hint} ${detail}`.trim());
}

export function streamChat(options: StreamOptions): Promise<void> {
  const meta = getProvider(options.provider);
  if (meta.kind === "anthropic") return streamAnthropic(options);
  if (meta.kind === "google") return streamGoogle(options);
  if (meta.kind === "ollama") return streamOllama(options);
  return streamOpenAI(options);
}

/* ------------------------------------------------------------------ *
 * Model discovery and connection tests
 * ------------------------------------------------------------------ */

export interface ProviderStatus {
  ok: boolean;
  detail: string;
  models?: string[];
}

export async function listModels(
  id: ProviderId,
  config: ProviderConfig,
): Promise<ProviderStatus> {
  const meta = getProvider(id);
  const base = resolveBase(config, meta);

  try {
    if (meta.kind === "ollama") {
      const response = await httpFetch(`${base}/api/tags`, { method: "GET" });
      if (!response.ok) return { ok: false, detail: await failure(response) };
      const data = await response.json();
      const models = (data.models ?? []).map((model: any) => model.name as string);
      return {
        ok: true,
        detail: models.length ? `${models.length} local models` : "Ollama is running, no models pulled yet",
        models,
      };
    }

    if (meta.kind === "anthropic") {
      return { ok: true, detail: "Curated model list", models: meta.models };
    }

    if (id === "google") {
      // AI Studio keys can list their own models, so the picker reflects what
      // this key can actually call instead of a hardcoded guess.
      const response = await httpFetch(
        `${base}/models?pageSize=200&key=${encodeURIComponent(config.apiKey.trim())}`,
        { method: "GET" },
      );
      if (!response.ok) return { ok: false, detail: await failure(response) };
      const data = await response.json();
      const models: string[] = (data.models ?? [])
        .filter((model: any) =>
          (model.supportedGenerationMethods ?? []).includes("generateContent"),
        )
        .map((model: any) => String(model.name ?? "").replace(/^models\//, ""))
        .filter(
          (name: string) =>
            name && !/(embedding|tts|live|image|transcribe|lyria|omni|veo)/i.test(name),
        )
        .sort();
      return {
        ok: true,
        detail: models.length ? `${models.length} models` : "No text models on this key",
        models,
      };
    }

    const response = await httpFetch(`${base}/models`, {
      method: "GET",
      headers: config.apiKey.trim()
        ? { authorization: `Bearer ${config.apiKey.trim()}` }
        : undefined,
    });
    if (!response.ok) return { ok: false, detail: await failure(response) };
    const data = await response.json();
    const models: string[] = (data.data ?? data.models ?? [])
      .map((model: any) => model.id ?? model.name)
      .filter(Boolean)
      .sort();
    return { ok: true, detail: `${models.length} models`, models };
  } catch (error) {
    return { ok: false, detail: describeError(error, meta) };
  }
}

async function failure(response: Response): Promise<string> {
  let text = "";
  try {
    text = (await response.text()).slice(0, 200);
  } catch {
    /* ignore */
  }
  return `${response.status} ${response.statusText}${text ? ` · ${text}` : ""}`;
}

function describeError(error: unknown, meta: ProviderMeta): string {
  if (error instanceof TypeError) {
    return meta.local
      ? `Could not reach ${meta.name} at ${meta.baseUrl}. Is it running?`
      : `Could not reach ${meta.name}. Check your connection, or the base URL.`;
  }
  return error instanceof Error ? error.message : String(error);
}

export async function testProvider(
  id: ProviderId,
  config: ProviderConfig,
): Promise<ProviderStatus> {
  const meta = getProvider(id);

  if (meta.needsKey && !config.apiKey.trim()) {
    return { ok: false, detail: "Add an API key first" };
  }

  const result = await listModels(id, config);
  if (!result.ok) return result;

  // A key can be valid for /models but not for chat; send one tiny turn.
  if (meta.kind === "openai" || meta.kind === "anthropic" || meta.kind === "google") {
    const model = result.models?.[0] ?? meta.models[0];
    const controller = new AbortController();
    try {
      let text = "";
      await streamChat({
        provider: id,
        config,
        model,
        messages: [{ role: "user", content: "Reply with the word ready." }],
        signal: controller.signal,
        onDelta: (chunk) => {
          text += chunk;
          if (text.length > 0) controller.abort();
        },
      });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        return { ok: false, detail: describeError(error, meta) };
      }
    }
  }

  return result;
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 3.6));
}
