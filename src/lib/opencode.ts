import { invoke } from "@tauri-apps/api/core";
import type { DiffLine, Message, Part, ProviderConfig, ProviderId, Session } from "./types";
import { inTauri } from "./native";

/**
 * OpenCode runtime client.
 *
 * OpenWork starts a bundled `opencode serve` and uses its HTTP API; Lantas now
 * does the same for workspace chats. The server owns the agent loop, tools,
 * edits and commands. This module maps its event stream onto the transcript
 * parts the Lantas UI already renders, so the visible product stays the same
 * while the engine underneath is OpenCode.
 */

interface ServerInfo {
  port: number;
  token: string;
}

export interface OpenCodeConnection {
  base: string;
  auth: string;
}

interface OpenCodeServer extends ServerInfo, OpenCodeConnection {}

interface ProviderCatalog {
  id: string;
  models: Record<string, unknown>;
}

interface ModelChoice {
  providerID: string;
  modelID: string;
  substituted?: { requested: string; used: string };
}

interface ToolState {
  status?: "pending" | "running" | "completed" | "error";
  input?: Record<string, unknown>;
  output?: string;
  title?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  time?: { start?: number; end?: number };
}

interface OpenCodePart {
  id: string;
  sessionID: string;
  messageID: string;
  type: string;
  text?: string;
  tool?: string;
  state?: ToolState;
  time?: { start?: number; end?: number };
}

interface PermissionRequest {
  id: string;
  sessionID: string;
  permission: string;
  patterns?: string[];
  metadata?: Record<string, unknown>;
  always?: string[];
  tool?: { messageID?: string; callID?: string };
}

interface OpenCodeEvent {
  type: string;
  properties: Record<string, any>;
}

const servers = new Map<string, Promise<OpenCodeServer>>();

export function canUseOpenCode(): boolean {
  return inTauri();
}

const PROVIDER_ENV: Partial<Record<ProviderId, string[]>> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  groq: ["GROQ_API_KEY"],
  google: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
  nvidia: ["NVIDIA_API_KEY"],
  opencode: ["OPENCODE_API_KEY"],
  ollama: ["OLLAMA_HOST"],
  lmstudio: ["LMSTUDIO_HOST"],
};

/** The OpenCode provider id for a Lantas provider. */
function providerId(provider: ProviderId): string {
  return provider;
}

function providerEnv(providers: Record<ProviderId, ProviderConfig>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [provider, names] of Object.entries(PROVIDER_ENV)) {
    const config = providers[provider as ProviderId];
    if (!config) continue;
    const key = (config.apiKey || "").trim();
    const base = (config.baseUrl || "").trim();
    for (const name of names ?? []) {
      if (key) env[name] = key;
      if (!key && base && (name === "OLLAMA_HOST" || name === "LMSTUDIO_HOST")) env[name] = base;
    }
  }
  return env;
}

async function startServer(
  root: string,
  providers: Record<ProviderId, ProviderConfig>,
): Promise<OpenCodeServer> {
  if (!inTauri()) throw new Error("OpenCode needs the desktop app.");
  const info = await invoke<ServerInfo>("opencode_start", {
    root,
    env: providerEnv(providers),
  });
  const server: OpenCodeServer = {
    ...info,
    base: `http://127.0.0.1:${info.port}`,
    auth: `Basic ${btoa(`opencode:${info.token}`)}`,
  };

  const started = Date.now();
  let last = "";
  while (Date.now() - started < 20_000) {
    try {
      const response = await fetch(`${server.base}/global/health`, {
        headers: { authorization: server.auth },
      });
      if (response.ok) {
        const health = (await response.json()) as { healthy?: boolean };
        if (health.healthy) return server;
      }
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  throw new Error(`OpenCode did not become ready${last ? ` (${last})` : ""}.`);
}

async function healthy(server: OpenCodeServer): Promise<boolean> {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), 1_500);
  try {
    const response = await fetch(`${server.base}/global/health`, {
      headers: { authorization: server.auth },
      signal: stop.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function ensureServer(
  root: string,
  providers: Record<ProviderId, ProviderConfig>,
): Promise<OpenCodeServer> {
  const existing = servers.get(root);
  if (existing) {
    try {
      const server = await existing;
      if (await healthy(server)) return server;
    } catch {
      // The cached start failed; replace it below.
    }
    servers.delete(root);
  }
  const started = startServer(root, providers);
  servers.set(root, started);
  try {
    return await started;
  } catch (error) {
    servers.delete(root);
    throw error;
  }
}

export async function stopOpenCode(root: string): Promise<void> {
  servers.delete(root);
  if (!inTauri()) return;
  try {
    await invoke("opencode_stop", { root });
  } catch {
    // The process may already have exited.
  }
}

async function request(
  server: OpenCodeConnection,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", server.auth);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(`${server.base}${path}`, { ...init, headers });
}

async function json<T>(server: OpenCodeConnection, path: string, init?: RequestInit): Promise<T> {
  const response = await request(server, path, init);
  const text = await response.text();
  if (!response.ok) {
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      detail = parsed?.data?.message ?? parsed?.message ?? text;
    } catch {
      // keep the raw body
    }
    throw new Error(detail || `OpenCode returned HTTP ${response.status}.`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

async function modelFor(
  server: OpenCodeConnection,
  provider: ProviderId,
  model: string,
): Promise<ModelChoice> {
  const providerID = providerId(provider);
  const catalog = await json<{ providers: ProviderCatalog[]; default?: Record<string, string> }>(
    server,
    "/config/providers",
  );
  const entry = catalog.providers?.find((item) => item.id === providerID);
  if (!entry) {
    throw new Error(
      `OpenCode has no ${providerID} provider. Connect one in OpenCode, or pick another model.`,
    );
  }
  if (entry.models?.[model]) return { providerID, modelID: model };
  const fallback =
    catalog.default?.[providerID] && entry.models?.[catalog.default[providerID]]
      ? catalog.default[providerID]
      : Object.keys(entry.models ?? {})[0];
  if (!fallback) throw new Error(`OpenCode lists no models for ${providerID}.`);
  return {
    providerID,
    modelID: fallback,
    substituted: { requested: model, used: fallback },
  };
}

/* ------------------------------------------------------------------ events */

function parseSseBlock(block: string): string | null {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  return data || null;
}

async function readEvents(
  server: OpenCodeConnection,
  signal: AbortSignal,
  onEvent: (event: OpenCodeEvent) => void,
): Promise<void> {
  const response = await request(server, "/event", {
    headers: { accept: "text/event-stream" },
    signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`OpenCode event stream failed (HTTP ${response.status}).`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let at = buffer.indexOf("\n\n");
    while (at >= 0) {
      const block = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      const payload = parseSseBlock(block);
      if (payload) {
        try {
          onEvent(JSON.parse(payload) as OpenCodeEvent);
        } catch {
          // A malformed frame should not kill the turn.
        }
      }
      at = buffer.indexOf("\n\n");
    }
  }
}

/* ------------------------------------------------------------------ diffs */

function diffLines(patch: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const raw of patch.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      continue;
    }
    if (
      !raw ||
      raw.startsWith("Index:") ||
      raw.startsWith("===") ||
      raw.startsWith("---") ||
      raw.startsWith("+++") ||
      raw.startsWith("\\ No newline")
    ) {
      continue;
    }
    if (raw.startsWith("+")) {
      lines.push({ type: "add", no: newNo++, text: raw.slice(1) });
    } else if (raw.startsWith("-")) {
      lines.push({ type: "del", no: oldNo++, text: raw.slice(1) });
    } else if (raw.startsWith(" ")) {
      lines.push({ type: "ctx", no: newNo++, text: raw.slice(1) });
      oldNo += 1;
    }
  }
  return lines;
}

function relative(root: string, file: string): string {
  const clean = file.replace(/\\/g, "/");
  const base = root.replace(/\\/g, "/").replace(/\/+$/, "");
  return clean.startsWith(`${base}/`) ? clean.slice(base.length + 1) : clean;
}

/* ------------------------------------------------------------------- turn */

export interface OpenCodePermission {
  call: { name: string; args: Record<string, unknown> };
  resource: string;
  label: string;
}

export interface OpenCodeTurnOptions {
  /** The workspace folder; also keys the sidecar process. */
  root: string;
  /** The session before the current user message was added. */
  session: Session;
  /** The visible prompt. */
  text: string;
  images: Array<{ mime: string; data: string }>;
  provider: ProviderId;
  model: string;
  providers: Record<ProviderId, ProviderConfig>;
  /** Auto mode answers its own permission requests. */
  autoApprove: boolean;
  signal: AbortSignal;
  patch: (updater: (message: Message) => Message) => void;
  /** Shows a permission card and resolves the person's choice. */
  onPermission: (request: OpenCodePermission) => Promise<boolean>;
  /** Stores the OpenCode session id on the Lantas thread. */
  onSessionId: (id: string) => void;
}

export interface OpenCodeTurnResult {
  input: number;
  output: number;
  cost: number;
}

export async function runOpenCodeTurn(options: OpenCodeTurnOptions): Promise<OpenCodeTurnResult> {
  const server = await ensureServer(options.root, options.providers);
  return executeOpenCodeTurn(server, options);
}

/** The turn itself, separated so it can be exercised against a real server. */
export async function executeOpenCodeTurn(
  server: OpenCodeConnection,
  options: OpenCodeTurnOptions,
): Promise<OpenCodeTurnResult> {
  const choice = await modelFor(server, options.provider, options.model);

  if (choice.substituted) {
    options.patch((message) => ({
      ...message,
      parts: [
        ...message.parts,
        {
          id: `oc-note-model-${Date.now()}`,
          kind: "note",
          text: `OpenCode does not list ${options.provider}/${choice.substituted?.requested}. This turn used ${choice.providerID}/${choice.substituted?.used}.`,
        },
      ],
    }));
  }

  let sessionID = options.session.opencodeSessionId;
  if (sessionID) {
    const check = await request(server, `/session/${encodeURIComponent(sessionID)}`);
    if (!check.ok) sessionID = undefined;
  }
  if (!sessionID) {
    const created = await json<{ id: string }>(server, "/session", {
      method: "POST",
      body: JSON.stringify({ title: options.session.title }),
    });
    sessionID = created.id;
    options.onSessionId(sessionID);

    // A thread that existed before the engine switch has no OpenCode history.
    // Hand it a compact transcript once, without asking the model to answer.
    const prior = options.session.messages;
    const transcript = prior
      .slice(-10)
      .map((message) => {
        const body = message.parts
          .filter((part): part is Extract<Part, { kind: "text" }> => part.kind === "text")
          .map((part) => part.text)
          .join("\n")
          .slice(0, 2_000);
        return body ? `${message.role === "user" ? "User" : "Assistant"}: ${body}` : "";
      })
      .filter(Boolean)
      .join("\n\n");
    if (transcript) {
      await json(server, `/session/${encodeURIComponent(sessionID)}/prompt_async`, {
        method: "POST",
        body: JSON.stringify({
          model: { providerID: choice.providerID, modelID: choice.modelID },
          noReply: true,
          parts: [
            {
              type: "text",
              text: `Earlier messages in this thread, before the engine moved to OpenCode:\n\n${transcript}`,
            },
          ],
        }),
      });
    }
  }

  const sessionPath = `/session/${encodeURIComponent(sessionID)}`;
  const lantasPart = new Map<string, string>();
  const partText = new Map<string, string>();
  const toolCreated = new Map<string, { tool: string; shell: string; diff: string }>();
  const handledPermissions = new Set<string>();
  const assistantMessages = new Set<string>();
  const usage = new Map<string, { input: number; output: number; cost: number }>();
  let settled = false;
  let resolveTurn: () => void = () => {};
  let rejectTurn: (error: unknown) => void = () => {};
  let resolveConnected: () => void = () => {};
  const connected = new Promise<void>((resolve) => {
    resolveConnected = resolve;
  });

  const finish = () => {
    if (settled) return;
    settled = true;
    resolveTurn();
  };
  const fail = (error: unknown) => {
    if (settled) return;
    settled = true;
    rejectTurn(error);
  };

  const closeReasoning = () => {
    options.patch((message) => ({
      ...message,
      parts: message.parts.map((part) =>
        part.kind === "reasoning" && part.state === "run" ? { ...part, state: "done" } : part,
      ),
    }));
  };

  const writePart = (ocID: string, updater: (part: Part) => Part) => {
    const id = lantasPart.get(ocID);
    if (!id) return;
    options.patch((message) => ({
      ...message,
      parts: message.parts.map((part) => (part.id === id ? updater(part) : part)),
    }));
  };

  const setText = (part: OpenCodePart) => {
    const text = part.text ?? "";
    const id = lantasPart.get(part.id);
    if (id) {
      partText.set(part.id, text);
      writePart(part.id, (current) =>
        current.kind === "text" ? { ...current, text } : current,
      );
      return;
    }
    const next = `oc-text-${part.id}`;
    lantasPart.set(part.id, next);
    partText.set(part.id, text);
    options.patch((message) => ({
      ...message,
      parts: [...message.parts, { id: next, kind: "text", text }],
    }));
  };

  const appendDelta = (partID: string, field: string, delta: string) => {
    if (field !== "text") return;
    const text = (partText.get(partID) ?? "") + delta;
    partText.set(partID, text);
    const id = lantasPart.get(partID);
    if (id) {
      writePart(partID, (current) =>
        current.kind === "text" ? { ...current, text } : current,
      );
      return;
    }
    const next = `oc-text-${partID}`;
    lantasPart.set(partID, next);
    options.patch((message) => ({
      ...message,
      parts: [...message.parts, { id: next, kind: "text", text }],
    }));
  };

  const setReasoning = (part: OpenCodePart) => {
    const text = part.text ?? "";
    const done = Boolean(part.time?.end);
    const id = lantasPart.get(part.id);
    if (id) {
      writePart(part.id, (current) =>
        current.kind === "reasoning"
          ? {
              ...current,
              text,
              state: done ? "done" : "run",
              ...(done && part.time?.start
                ? { durationMs: Math.max(0, (part.time.end ?? 0) - part.time.start) }
                : {}),
            }
          : current,
      );
      return;
    }
    const next = `oc-reason-${part.id}`;
    lantasPart.set(part.id, next);
    options.patch((message) => ({
      ...message,
      parts: [
        ...message.parts,
        {
          id: next,
          kind: "reasoning" as const,
          text,
          state: done ? ("done" as const) : ("run" as const),
        },
      ],
    }));
  };

  const appendReasoningDelta = (partID: string, delta: string) => {
    const id = lantasPart.get(partID);
    if (!id) {
      const next = `oc-reason-${partID}`;
      lantasPart.set(partID, next);
      options.patch((message) => ({
        ...message,
        parts: [
          ...message.parts,
          { id: next, kind: "reasoning" as const, text: delta, state: "run" as const },
        ],
      }));
      return;
    }
    writePart(partID, (current) =>
      current.kind === "reasoning" ? { ...current, text: current.text + delta } : current,
    );
  };

  const toolLabel = (name: string, input: Record<string, unknown>, title?: string): string => {
    const file = String(input.filePath ?? input.path ?? input.file ?? "");
    const path = file ? relative(options.root, file) : "";
    switch (name) {
      case "bash":
        return String(input.command ?? title ?? "Run a command");
      case "read":
        return path ? `Read ${path}` : "Read a file";
      case "edit":
      case "write":
      case "patch":
        return path ? `Edit ${path}` : "Change a file";
      case "grep":
        return `Search ${String(input.pattern ?? "")}`.trim();
      case "glob":
        return `Find ${String(input.pattern ?? "")}`.trim();
      case "list":
        return path ? `List ${path}` : "List files";
      case "webfetch":
        return `Fetch ${String(input.url ?? "")}`.trim();
      case "task":
        return title ?? `Delegate: ${String(input.description ?? "subtask")}`;
      case "todowrite":
        return "Update the plan";
      default:
        return title ?? name;
    }
  };

  const toolKind = (name: string): Extract<Part, { kind: "tool" }>["tool"] => {
    if (name === "read") return "read";
    if (["grep", "glob", "list"].includes(name)) return "grep";
    if (["edit", "write", "patch"].includes(name)) return "edit";
    if (name === "bash") return "terminal";
    if (["webfetch", "fetch"].includes(name)) return "web";
    return "plan";
  };

  const handleTool = (part: OpenCodePart) => {
    const state = part.state ?? {};
    const input = (state.input ?? {}) as Record<string, unknown>;
    const status = state.status ?? "running";
    const toolState = status === "completed" ? "done" : status === "error" ? "error" : "run";
    const name = part.tool ?? "tool";
    const label = toolLabel(name, input, state.title);
    let created = toolCreated.get(part.id);
    if (!created) {
      created = { tool: `oc-tool-${part.id}`, shell: `oc-shell-${part.id}`, diff: `oc-diff-${part.id}` };
      toolCreated.set(part.id, created);
      closeReasoning();
      const additions: Part[] = [
        {
          id: created.tool,
          kind: "tool",
          tool: toolKind(name),
          label,
          detail: status === "error" ? state.error : undefined,
          state: toolState,
        },
      ];
      if (name === "bash") {
        additions.push({
          id: created.shell,
          kind: "shell",
          command: String(input.command ?? ""),
          output: [],
          state: toolState,
        });
      }
      options.patch((message) => ({ ...message, parts: [...message.parts, ...additions] }));
    } else {
      options.patch((message) => ({
        ...message,
        parts: message.parts.flatMap((current): Part[] => {
          if (current.id === created?.tool && current.kind === "tool") {
            return [
              {
                ...current,
                label,
                detail:
                  status === "error"
                    ? state.error
                    : status === "completed"
                      ? state.title ?? current.detail
                      : current.detail,
                state: toolState,
              },
            ];
          }
          if (current.id === created?.shell && current.kind === "shell") {
            const output = String(state.output ?? state.metadata?.output ?? "");
            return [
              {
                ...current,
                command: String(input.command ?? current.command),
                output: output ? output.split("\n").slice(-240) : current.output,
                state: toolState,
              },
            ];
          }
          return [current];
        }),
      }));
    }

    const filediff = state.metadata?.filediff as
      | { file?: string; patch?: string; additions?: number; deletions?: number }
      | undefined;
    if (filediff?.patch && created) {
      const diffID = created.diff;
      const exists = (current: Message) => current.parts.some((item) => item.id === diffID);
      options.patch((message) => {
        if (exists(message)) return message;
        const file = filediff.file ?? String(input.filePath ?? input.path ?? "");
        const lines = diffLines(filediff.patch ?? "");
        if (!lines.length) return message;
        return {
          ...message,
          parts: [
            ...message.parts,
            {
              id: diffID,
              kind: "diff",
              path: relative(options.root, file),
              added: filediff.additions ?? lines.filter((line) => line.type === "add").length,
              removed: filediff.deletions ?? lines.filter((line) => line.type === "del").length,
              lines,
            },
          ],
        };
      });
    }
  };

  const answerPermission = async (permission: PermissionRequest) => {
    if (handledPermissions.has(permission.id)) return;
    handledPermissions.add(permission.id);
    const patterns = permission.patterns ?? [];
    const metadata = permission.metadata ?? {};
    const resource = patterns.join(", ") || permission.permission;
    let allowed = options.autoApprove;
    if (!options.autoApprove) {
      const call =
        permission.permission === "bash"
          ? { name: "terminal", args: { command: String(metadata.command ?? resource) } }
          : permission.permission === "edit"
            ? {
                name: "edit",
                args: {
                  path: String(metadata.filepath ?? resource),
                  ...(metadata.diff ? { diff: String(metadata.diff) } : {}),
                },
              }
            : permission.permission === "webfetch"
              ? { name: "browser", args: { url: String(metadata.url ?? resource) } }
              : { name: permission.permission, args: { ...metadata } };
      allowed = await options
        .onPermission({
          call,
          resource,
          label: `OpenCode wants to ${permission.permission}.`,
        })
        .catch(() => false);
    }
    try {
      await request(
        server,
        `${sessionPath}/permissions/${encodeURIComponent(permission.id)}`,
        {
          method: "POST",
          body: JSON.stringify({ response: allowed ? "once" : "reject" }),
        },
      );
    } catch {
      // The turn may have been stopped while the card was open.
    }
  };

  const handleEvent = (event: OpenCodeEvent) => {
    if (event.type === "server.connected") {
      resolveConnected();
      return;
    }
    const properties = event.properties ?? {};
    if (properties.sessionID !== sessionID) return;
    switch (event.type) {
      case "message.part.updated": {
        const part = properties.part as OpenCodePart;
        if (!part || part.sessionID !== sessionID) return;
        // The user's own prompt is also a text part on this stream. Only parts
        // belonging to assistant messages belong in the transcript.
        if (!assistantMessages.has(part.messageID)) return;
        if (part.type === "text") setText(part);
        else if (part.type === "reasoning") setReasoning(part);
        else if (part.type === "tool") handleTool(part);
        break;
      }
      case "message.part.delta": {
        const partID = String(properties.partID ?? "");
        if (!partID) return;
        if (properties.field === "text") {
          // Reasoning parts use the same field name; the part's type was set by
          // its first update, so the map tells them apart.
          const existing = lantasPart.get(partID);
          if (existing?.startsWith("oc-reason-")) appendReasoningDelta(partID, String(properties.delta ?? ""));
          else appendDelta(partID, properties.field, String(properties.delta ?? ""));
        }
        break;
      }
      case "permission.asked":
        void answerPermission(properties as PermissionRequest);
        break;
      case "message.updated": {
        const info = properties.info;
        if (info?.role === "assistant" && info.id) assistantMessages.add(info.id);
        if (info?.role === "assistant" && info.tokens) {
          usage.set(info.id, {
            input: Number(info.tokens.input ?? 0),
            output: Number(info.tokens.output ?? 0),
            cost: Number(info.cost ?? 0),
          });
        }
        break;
      }
      case "session.error": {
        const message = properties.error?.data?.message ?? properties.error?.message;
        fail(new Error(String(message ?? "OpenCode reported an error.")));
        break;
      }
      case "session.idle":
        finish();
        break;
      default:
        break;
    }
  };

  const stream = new AbortController();
  const onAbort = () => {
    void request(server, `${sessionPath}/abort`, { method: "POST" }).catch(() => {});
    stream.abort();
    fail(new DOMException("aborted", "AbortError"));
  };
  const turn = new Promise<void>((resolve, reject) => {
    resolveTurn = resolve;
    rejectTurn = reject;
  });
  options.signal.addEventListener("abort", onAbort, { once: true });
  if (options.signal.aborted) onAbort();

  const reader = readEvents(server, stream.signal, handleEvent).catch((error) => {
    if (!stream.signal.aborted) fail(error);
  });

  // Do not send the prompt until the event stream is live, or a very fast
  // first tool call can happen before the listener sees it.
  await Promise.race([
    connected,
    new Promise<void>((resolve) => setTimeout(resolve, 4_000)),
  ]);

  const parts: unknown[] = [];
  for (const image of options.images.slice(0, 4)) {
    parts.push({
      type: "file",
      mime: image.mime,
      filename: `image.${image.mime.split("/")[1] ?? "jpg"}`,
      url: `data:${image.mime};base64,${image.data}`,
    });
  }
  const prompt = options.text;
  if (prompt.trim()) parts.unshift({ type: "text", text: prompt });

  try {
    if (!settled) {
      await json(server, `${sessionPath}/prompt_async`, {
        method: "POST",
        body: JSON.stringify({
          model: { providerID: choice.providerID, modelID: choice.modelID },
          agent: options.session.agent === "plan" ? "plan" : "build",
          parts,
        }),
      });
    }
    await turn;
  } finally {
    options.signal.removeEventListener("abort", onAbort);
    stream.abort();
    void reader;
    // A finishing turn may leave reasoning open.
    if (!settled) finish();
  }

  closeReasoning();
  let input = 0;
  let output = 0;
  let cost = 0;
  for (const value of usage.values()) {
    input += value.input;
    output += value.output;
    cost += value.cost;
  }
  return { input, output, cost };
}
