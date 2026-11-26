import type { ProviderConfig, ProviderId, ProviderMeta } from "./types";
import { PROVIDERS } from "./data";
import { MarkerFilter } from "./text";

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
  const configured = (config.baseUrl || "").trim();
  // A key pasted into the Base URL field would otherwise produce an invalid URL.
  const base = /^https?:\/\//i.test(configured) ? configured : meta.baseUrl.trim();
  return base.replace(/\/+$/, "");
}

/** Keys arrive from clipboard with stray whitespace or quotes often enough to strip. */
export function apiKeyOf(config: ProviderConfig): string {
  return (config.apiKey || "").trim().replace(/^["'`]|["'`]$/g, "").trim();
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
  "minimaxai/minimax-m3.1-flash": "MiniMax M3.1 Flash",
  "moonshotai/kimi-k3.1-pro": "Kimi K3.1 Pro",
  "z-ai/glm-5.3-flash": "GLM 5.3 Flash",
  "mistralai/mistral-large-4-1t-a52b": "Mistral Large 4",
  "google/gemma-4-31b-it": "Gemma 4 31B",
  "nvidia/nemotron-3.5-lightning-30b-a3b": "Nemotron 3.5 Lightning",
  "qwen3-coder:30b": "Qwen3 Coder 30B",
  "llama3.3:latest": "Llama 3.3",
  "deepseek-r1:14b": "DeepSeek R1 14B",
};

export function prettyModel(model: string): string {
  return PRETTY[model] ?? model.replace(/^[a-z0-9-]+\//i, "");
}

/**
 * Whether a model can take an image at all. Text-only models reject the whole
 * request when a screenshot is attached, so the browser falls back to the DOM
 * scan for them instead of spending a turn on a failed image call.
 */
const VISION_MODEL =
  /(gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-5|(^|[-/])o[34](-|$)|claude-(3|4)|gemini|gemma-?3|llama-?3\.2.*vision|llama-?4|qwen.*(vl|vision)|pixtral|llava|moondream|internvl|minicpm-v|grok.*vision|mistral-small-3)/i;

export function canSeeImages(_provider: ProviderId, model: string): boolean {
  const name = (model || "").toLowerCase();
  if (!name) return false;
  // Coder, reasoning and math builds are text-only even when a sibling in the
  // same family has a vision variant.
  if (/(coder|deepseek-(r1|v3)|math|reason|text-only)/.test(name)) return false;
  return VISION_MODEL.test(name);
}

export function isConfigured(id: ProviderId, config: ProviderConfig): boolean {
  const meta = getProvider(id);
  if (!config.enabled) return false;
  if (meta.needsKey && !apiKeyOf(config)) return false;
  return Boolean(resolveBase(config, meta));
}

export interface ChatImage {
  /** image/jpeg, image/png, image/webp */
  mime: string;
  /** Base64 without the data: prefix. */
  data: string;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  images?: ChatImage[];
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
  /** Thinking/reasoning deltas, kept separate from the visible answer. */
  onReasoning?: (text: string) => void;
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
      "x-api-key": apiKeyOf(options.config),
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: options.model,
      max_tokens: 4096,
      stream: true,
      // Cache the system prompt: an agent turn re-sends it on every step, and
      // Anthropic charges and processes a cached prefix far faster than a cold
      // one. Providers that ignore the field simply ignore it.
      ...(options.system
        ? {
            system: [
              {
                type: "text",
                text: options.system,
                cache_control: { type: "ephemeral" },
              },
            ],
          }
        : {}),
      messages: options.messages.map((message) =>
        message.images?.length
          ? {
              role: message.role,
              content: [
                ...message.images.map((image) => ({
                  type: "image",
                  source: { type: "base64", media_type: image.mime, data: image.data },
                })),
                ...(message.content ? [{ type: "text", text: message.content }] : []),
              ],
            }
          : { role: message.role, content: message.content },
      ),
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
      if (
        event.type === "content_block_delta" &&
        event.delta?.type === "thinking_delta" &&
        typeof event.delta.thinking === "string"
      ) {
        options.onReasoning?.(event.delta.thinking);
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
    ...options.messages.map((message) =>
      message.images?.length
        ? {
            role: message.role,
            content: [
              ...(message.content ? [{ type: "text", text: message.content }] : []),
              ...message.images.map((image) => ({
                type: "image_url",
                image_url: { url: `data:${image.mime};base64,${image.data}` },
              })),
            ],
          }
        : { role: message.role, content: message.content },
    ),
  ];

  const response = await httpFetch(`${base}/chat/completions`, {
    method: "POST",
    signal: options.signal,
    headers: {
      "content-type": "application/json",
      ...(apiKeyOf(options.config) ? { authorization: `Bearer ${apiKeyOf(options.config)}` } : {}),
      ...(options.provider === "openrouter"
        ? { "http-referer": "https://github.com/AnwarKalonov/Lantas", "x-title": "Lantas" }
        : {}),
    },
    body: JSON.stringify({
      model: options.model,
      messages,
      stream: true,
      ...(options.provider === "nvidia" ? {} : { stream_options: { include_usage: true } }),
    }),
  });

  if (!response.ok) {
    const error = await httpError(response);
    if (options.provider === "opencode" && response.status === 403) {
      throw new Error(
        `OpenCode refused this model. Free-tier models only work inside the OpenCode app, so choose a pay-as-you-go model, or verify the key at opencode.ai/console. ${error.message}`,
      );
    }
    throw error;
  }

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
      const choice = event.choices?.[0]?.delta;
      const delta = choice?.content;
      if (typeof delta === "string" && delta) options.onDelta(delta);
      const reasoning =
        choice?.reasoning_content ??
        choice?.reasoning ??
        (Array.isArray(choice?.reasoning_details)
          ? choice.reasoning_details
              .map((detail: any) => detail?.text ?? detail?.summary ?? "")
              .join("")
          : "");
      if (typeof reasoning === "string" && reasoning) {
        options.onReasoning?.(reasoning);
      }
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

/** Gemini 4 Argon and its successors are served by the Interactions API only. */
export function needsInteractions(model: string): boolean {
  return /^gemini-4/i.test(model);
}

/**
 * Interactions API, stateless streaming.
 * History is resent as steps: user_input / model_output blocks.
 */
async function streamGoogleInteractions(options: StreamOptions): Promise<void> {
  const meta = getProvider("google");
  const base = resolveBase(options.config, meta);

  const steps = options.messages.map((message) => ({
    type: message.role === "assistant" ? "model_output" : "user_input",
    content: [
      ...(message.content ? [{ type: "text", text: message.content }] : []),
      ...(message.images ?? []).map((image) => ({
        type: "image",
        mime_type: image.mime,
        data: image.data,
      })),
    ],
  }));

  const response = await httpFetch(`${base}/interactions?alt=sse`, {
    method: "POST",
    signal: options.signal,
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKeyOf(options.config),
    },
    body: JSON.stringify({
      model: options.model,
      input: steps,
      stream: true,
      // Client-held history: nothing is retained on Google's side.
      store: false,
      ...(options.system ? { system_instruction: options.system } : {}),
    }),
  });

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
      if (event.event_type === "error" || event.error) {
        throw new Error(event.error?.message ?? "Google returned an error.");
      }
      const delta = event.delta;
      if (
        (event.event_type === "step.delta" || event.event_type === "content.delta") &&
        (delta?.type === "thought" || delta?.type === "thinking") &&
        typeof delta.text === "string"
      ) {
        options.onReasoning?.(delta.text);
      } else if (
        (event.event_type === "step.delta" || event.event_type === "content.delta") &&
        delta?.type === "text" &&
        typeof delta.text === "string"
      ) {
        options.onDelta(delta.text);
      }
      const usage = event.interaction?.usage ?? event.usage;
      if (event.event_type === "interaction.completed" && usage) {
        options.onUsage?.({
          input: usage.total_input_tokens,
          output: usage.total_output_tokens,
        });
      }
    },
    options.signal,
  );
}

async function streamGoogle(options: StreamOptions): Promise<void> {
  if (needsInteractions(options.model)) return streamGoogleInteractions(options);

  const meta = getProvider("google");
  const base = resolveBase(options.config, meta);

  const contents = options.messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [
      ...(message.content ? [{ text: message.content }] : []),
      ...(message.images ?? []).map((image) => ({
        inline_data: { mime_type: image.mime, data: image.data },
      })),
    ],
  }));

  const response = await httpFetch(
    `${base}/models/${encodeURIComponent(options.model)}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      signal: options.signal,
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKeyOf(options.config),
      },
      body: JSON.stringify({
        contents,
        ...(options.system ? { systemInstruction: { parts: [{ text: options.system }] } } : {}),
      }),
    },
  );

  if (!response.ok) {
    const error = await httpError(response);
    if (/interactions api/i.test(error.message)) {
      // This model moved to the newer transport.
      return streamGoogleInteractions(options);
    }
    throw error;
  }

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
      const parts = event.candidates?.[0]?.content?.parts ?? [];
      const text = parts
        .filter((part: any) => !part.thought)
        .map((part: any) => part.text ?? "")
        .join("");
      if (text) options.onDelta(text);
      const thought = parts
        .filter((part: any) => part.thought)
        .map((part: any) => part.text ?? "")
        .join("");
      if (thought) options.onReasoning?.(thought);
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
    ...options.messages.map((message) => ({
      role: message.role,
      content: message.content,
      ...(message.images?.length ? { images: message.images.map((image) => image.data) } : {}),
    })),
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
      const thinking = event.message?.thinking;
      if (typeof thinking === "string" && thinking) options.onReasoning?.(thinking);
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
    // Providers answer with {error:{message}}; show the sentence, not the wrapper.
    const parsed = JSON.parse(text);
    detail = parsed?.error?.message ?? parsed?.message ?? detail;
  } catch {
    /* keep the raw text */
  }
  const auth = response.status === 401 || response.status === 403;
  const hint = auth ? " Check the API key in Settings → Providers." : "";
  return new Error(`${response.status} ${response.statusText}.${hint} ${detail}`.trim());
}

function retryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(429|500|502|503|504)\b/.test(message) ||
    /failed to fetch|network|timed?\s*out|connection reset|econnreset/i.test(message);
}

/**
 * Retry only before the first token has been emitted. Replaying a stream after
 * text is visible would duplicate output and corrupt the transcript.
 */
export async function streamChat(options: StreamOptions): Promise<void> {
  const meta = getProvider(options.provider);
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let started = false;
    // Strip provider control markers before they reach the transcript, while
    // keeping the raw text available to the tool parser.
    const filter = new MarkerFilter();
    const wrapped: StreamOptions = {
      ...options,
      onDelta: (chunk) => {
        const clean = filter.push(chunk);
        if (!clean) return;
        started = true;
        options.onDelta(clean);
      },
      onReasoning: options.onReasoning,
    };

    try {
      if (meta.kind === "anthropic") await streamAnthropic(wrapped);
      else if (meta.kind === "google") await streamGoogle(wrapped);
      else if (meta.kind === "ollama") await streamOllama(wrapped);
      else await streamOpenAI(wrapped);
      const rest = filter.end();
      if (rest) options.onDelta(rest);
      return;
    } catch (error) {
      lastError = error;
      if (started || options.signal.aborted || attempt === 3 || !retryable(error)) {
        throw error;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 500 * 2 ** (attempt - 1)));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/* ------------------------------------------------------------------ *
 * Model discovery and connection tests
 * ------------------------------------------------------------------ */

const FREE_GOOGLE = new Set([
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-4-hydrogen",
]);

/** Free today: OpenRouter's :free variants and Google's free-tier rows. */
export function isFreeModel(provider: ProviderId, model: string): boolean {
  if (model.includes(":free")) return true;
  if (provider === "opencode") return /-free$/.test(model) || model === "big-pickle";
  if (provider === "google") return FREE_GOOGLE.has(model);
  return false;
}

/** The cheapest thing worth spending on a connection test. */
export function pickTestModel(provider: ProviderId, models: string[]): string {
  // OpenCode's live catalog includes free ids that only work inside its own
  // app. Testing one of those would fail every otherwise-valid paid key.
  if (provider === "opencode") {
    return (
      models.find((model) => /(^|-)flash($|-)/i.test(model)) ??
      models.find((model) => /glm|kimi|deepseek|qwen|minimax/i.test(model)) ??
      models.find((model) => !isFreeModel(provider, model)) ??
      models[0]
    );
  }
  return (
    models.find((model) => isFreeModel(provider, model)) ??
    models.find((model) => !/pro|opus|sonnet/i.test(model)) ??
    models[0]
  );
}

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
      const response = await httpFetch(`${base}/models?pageSize=200`, {
        method: "GET",
        headers: { "x-goog-api-key": apiKeyOf(config) },
      });
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
      // Interactions-only models (Gemini 4) may not appear in models.list.
      const merged = Array.from(new Set([...meta.models, ...models]));
      return {
        ok: true,
        detail: `${merged.length} models`,
        models: merged,
      };
    }

    const response = await httpFetch(`${base}/models`, {
      method: "GET",
      headers: apiKeyOf(config) ? { authorization: `Bearer ${apiKeyOf(config)}` } : undefined,
    });
    if (!response.ok) return { ok: false, detail: await failure(response) };
    const data = await response.json();
    const models: string[] = (data.data ?? data.models ?? [])
      .map((model: any) => model.id ?? model.name)
      .filter(Boolean)
      .filter((name: string) =>
        id === "nvidia"
          ? !/(embed|embedqa|nvclip|gliner|safety|guard|nemoguard|detector|retriever|riva|arctic-embed|calibration)/i.test(
              name,
            )
          : id === "opencode"
            ? !isFreeModel(id, name)
            : true,
      )
      .sort((a: string, b: string) => {
        if (id === "openrouter") {
          const free = Number(b.includes(":free")) - Number(a.includes(":free"));
          if (free !== 0) return free;
        }
        if (id === "nvidia") {
          const rank = (name: string) =>
            /minimax/i.test(name) ? 0 : /kimi/i.test(name) ? 1 : /glm/i.test(name) ? 2 : 3;
          const diff = rank(a) - rank(b);
          if (diff !== 0) return diff;
        }
        return a.localeCompare(b);
      });
    return { ok: true, detail: `${models.length} models`, models };
  } catch (error) {
    return { ok: false, detail: describeError(error, meta) };
  }
}

async function failure(response: Response): Promise<string> {
  let text = "";
  try {
    const raw = await response.text();
    text = raw.slice(0, 200);
    // Providers answer with {error:{message}}; show the sentence, not the wrapper.
    try {
      const parsed = JSON.parse(raw);
      text = parsed?.error?.message ?? parsed?.message ?? text;
    } catch {
      /* not JSON — keep the text */
    }
  } catch {
    /* ignore */
  }
  const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
  return `${status}${text ? ` · ${text}` : ""}`;
}

function describeError(error: unknown, meta: ProviderMeta): string {
  if (error instanceof TypeError) {
    const detail = error.message && error.message !== "Failed to fetch" ? ` (${error.message})` : "";
    return meta.local
      ? `Could not reach ${meta.name} at ${meta.baseUrl}. Is it running?${detail}`
      : `Could not reach ${meta.name}. The request never left the app${detail}. Check that the Base URL is ${meta.baseUrl} and that this machine is online.`;
  }
  return error instanceof Error ? error.message : String(error);
}

export async function testProvider(
  id: ProviderId,
  config: ProviderConfig,
): Promise<ProviderStatus> {
  const meta = getProvider(id);

  if (meta.needsKey && !apiKeyOf(config)) {
    return { ok: false, detail: "Add an API key first" };
  }

  const result = await listModels(id, config);
  if (!result.ok) return result;

  // A key can be valid for /models but not for chat; send one tiny turn.
  if (meta.kind === "openai" || meta.kind === "anthropic" || meta.kind === "google") {
    const model = pickTestModel(id, result.models?.length ? result.models : meta.models);
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
