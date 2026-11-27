import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  CustomCommand,
  AgentId,
  AppState,
  McpServer,
  Message,
  Mode,
  ProviderConfig,
  ProviderId,
  Scope,
  Session,
  Settings,
  Skill,
  StagedChange,
  ViewId,
  Workspace,
  WorkspaceFile,
} from "./types";
import { DEFAULT_SETTINGS, PROVIDERS, SKILL_SEEDS, seedState } from "./data";
import { uid } from "./util";
import { writeWorkspacePath } from "./workspace";

const STORAGE_KEY = "lantas.app.v2";
/** Threads that shipped as sample content in earlier builds. */
const DEMO_THREADS = new Set(["ses_streams", "ses_auth", "ses_ci"]);
const LEGACY_KEY = "lantas.workspace.v1";

/** Workspace dots, cycled in order like OpenWork's project marks. */
const WORKSPACE_COLORS = [
  "#df5b43",
  "#2f5bd0",
  "#2f8f5b",
  "#b06f1f",
  "#7a55cf",
  "#1f8792",
];

export interface ToastMessage {
  id: string;
  text: string;
  tone: "default" | "error";
}

interface Store {
  state: AppState;
  activeSession: Session | null;
  createSession: (
    agent?: AgentId,
    provider?: ProviderId,
    model?: string,
    surface?: Mode,
  ) => string;
  selectSession: (id: string | null) => void;
  deleteSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  updateSession: (id: string, updater: (session: Session) => Session) => void;
  addMessage: (sessionId: string, message: Message) => void;
  patchMessage: (
    sessionId: string,
    messageId: string,
    updater: (message: Message) => Message,
  ) => void;
  setSettings: (patch: Partial<Settings>) => void;
  updateProvider: (id: ProviderId, patch: Partial<ProviderConfig>) => void;
  addSkill: (skill: Skill) => void;
  updateSkill: (id: string, patch: Partial<Skill>) => void;
  deleteSkill: (id: string) => void;
  addMcp: (server: McpServer) => void;
  updateMcp: (id: string, patch: Partial<McpServer>) => void;
  deleteMcp: (id: string) => void;
  setCommands: (commands: CustomCommand[]) => void;
  setView: (view: ViewId) => void;
  setMode: (mode: Mode) => void;
  setScope: (scope: Scope) => void;
  /** Create (or reuse) a project folder and make it the active workspace. */
  createWorkspace: (name: string, root: string) => string;
  selectWorkspace: (id: string) => void;
  updateWorkspace: (id: string, patch: Partial<Workspace>) => void;
  deleteWorkspace: (id: string) => void;
  setBrowserUrl: (url: string) => void;
  setWorkspace: (name: string, files: WorkspaceFile[], root?: string) => void;
  patchWorkspaceFile: (path: string, text: string) => void;
  clearWorkspace: () => void;
  /** Assistant edits waiting for Keep or Decline in the IDE. */
  staged: StagedChange[];
  stageChange: (path: string, after: string) => void;
  keepStaged: () => Promise<number>;
  discardStaged: () => void;
  keepChange: (path: string) => Promise<boolean>;
  discardChange: (path: string) => void;
  /** Replace the current state with the last good copy written to disk. */
  recoverSession: () => Promise<boolean>;
  /** Force an immediate disk save, used after each assistant turn. */
  checkpoint: () => Promise<boolean>;
  undo: (sessionId: string) => void;
  redo: (sessionId: string) => void;
  toggleSidebar: () => void;
  togglePanel: () => void;
  toast: ToastMessage | null;
  notify: (text: string, tone?: "default" | "error") => void;
}

const StoreContext = createContext<Store | null>(null);

function normalizeSession(raw: any): Session {
  const model = typeof raw.model === "string" ? raw.model : "claude-opus-4-5";
  const legacy: Record<string, string> = {
    opus: "claude-opus-4-5",
    sonnet: "claude-sonnet-4-5",
    gpt: "gpt-5.1",
    local: "qwen3-coder:30b",
  };
  return {
    ...raw,
    provider: (raw.provider as ProviderId) ?? (raw.model === "gpt" ? "openai" : "anthropic"),
    model: legacy[model] ?? model,
    surface: raw.surface === "browser" || raw.surface === "code" ? raw.surface : "chat",
    workspaceId: typeof raw.workspaceId === "string" ? raw.workspaceId : undefined,
  } as Session;
}

function normalizeSettings(raw: any): Settings {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(raw ?? {}),
    providers: { ...DEFAULT_SETTINGS.providers, ...(raw?.providers ?? {}) },
  } as Settings;
  // The Liquid Glass theme was removed; stored state falls back to dark.
  if ((merged.theme as string) === "glass") merged.theme = "dark";
  return merged;
}

/**
 * Built-in skills ship with the app, so they are replaced on load while a
 * user's enable/disable choice is preserved by name. Custom and plugin skills
 * are never touched.
 */
function mergeBuiltins(stored: Skill[] | undefined, fallback: Skill[]): Skill[] {
  if (!stored) return fallback;
  const choice = new Map(stored.filter((skill) => skill.builtin).map((skill) => [skill.name, skill.enabled]));
  const custom = stored.filter((skill) => !skill.builtin);
  const builtins = SKILL_SEEDS.map((skill) => ({
    ...skill,
    enabled: choice.get(skill.name) ?? skill.enabled,
  }));
  return [...builtins, ...custom];
}

function stateFromStored(parsed: Partial<AppState> | null, fallback: AppState): AppState | null {
  if (!parsed || !Array.isArray(parsed.sessions)) return null;
  const sessions = (parsed.sessions as Session[])
    .map(normalizeSession)
    .filter((session) => !DEMO_THREADS.has(session.id));
  const activeId =
    typeof parsed.activeId === "string" && sessions.some((session) => session.id === parsed.activeId)
      ? parsed.activeId
      : (sessions[0]?.id ?? null);
  // A dropped-file workspace lives only in memory. Keeping its name after a
  // reload would label an empty workspace as if the folder were still open.
  const workspaceRoot = typeof parsed.workspaceRoot === "string" ? parsed.workspaceRoot : "";
  // Older builds had a single folder. It becomes the first workspace so no
  // project or chat is lost when the workspace layer arrives.
  const saved = Array.isArray(parsed.workspaces)
    ? (parsed.workspaces as Workspace[])
        .filter((item) => item && typeof item.id === "string" && typeof item.name === "string")
        .map((item, index) => ({
          ...item,
          root: typeof item.root === "string" ? item.root : "",
          color:
            typeof item.color === "string"
              ? item.color
              : WORKSPACE_COLORS[index % WORKSPACE_COLORS.length],
          created: typeof item.created === "number" ? item.created : Date.now(),
          updated: typeof item.updated === "number" ? item.updated : Date.now(),
        }))
    : [];
  const workspaces =
    saved.length > 0
      ? saved
      : workspaceRoot
        ? [
            {
              id: "ws_migrated",
              name: parsed.workspaceName || "Workspace",
              root: workspaceRoot,
              color: WORKSPACE_COLORS[0],
              created: Date.now(),
              updated: Date.now(),
            },
          ]
        : [];
  const activeWorkspaceId = workspaces.some((item) => item.id === parsed.activeWorkspaceId)
    ? (parsed.activeWorkspaceId as string)
    : (workspaces[0]?.id ?? null);
  const belongs = new Set(workspaces.map((item) => item.id));
  const scopedSessions = sessions.map((session) =>
    session.workspaceId && !belongs.has(session.workspaceId)
      ? { ...session, workspaceId: undefined }
      : session,
  );
  const scope = parsed.scope === "workspace" && activeWorkspaceId ? "workspace" : "chat";
  // A restored active chat must belong to the restored scope, or the app opens
  // a workspace while showing an ordinary chat (and the other way round).
  const known = scopedSessions.find((session) => session.id === activeId);
  const scopeMismatch =
    (scope === "workspace" && known?.workspaceId !== activeWorkspaceId) ||
    (scope === "chat" && Boolean(known?.workspaceId));
  const scopedActiveId = scopeMismatch
    ? (scopedSessions
        .filter((session) =>
          scope === "workspace"
            ? session.workspaceId === activeWorkspaceId
            : !session.workspaceId,
        )
        .sort((a, b) => b.updated - a.updated)[0]?.id ?? null)
    : activeId;
  return {
    sessions: scopedSessions,
    activeId: scopedActiveId,
    view: (parsed.view as ViewId) ?? "chats",
    mode: (parsed.mode as Mode) ?? "chat",
    scope,
    workspaces,
    activeWorkspaceId,
    browserUrl: typeof parsed.browserUrl === "string" ? parsed.browserUrl : "https://example.com",
    workspace: [],
    workspaceName: workspaceRoot ? parsed.workspaceName ?? "" : "",
    workspaceRoot,
    settings: normalizeSettings(parsed.settings),
    skills: mergeBuiltins(parsed.skills, fallback.skills),
    mcpServers: parsed.mcpServers ?? fallback.mcpServers,
    commands: parsed.commands ?? [],
    sidebarOpen: parsed.sidebarOpen ?? true,
    panelOpen: parsed.panelOpen ?? true,
  };
}

function loadState(): AppState {
  const fallback = seedState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const stored = stateFromStored(JSON.parse(raw) as Partial<AppState>, fallback);
      if (stored) return stored;
    }

    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as { sessions?: any[]; settings?: any };
      if (Array.isArray(parsed.sessions)) {
        return {
          ...fallback,
          sessions: parsed.sessions.map(normalizeSession),
          settings: normalizeSettings({
            ...(parsed.settings ?? {}),
            providers: fallback.settings.providers,
            defaultProvider: "anthropic",
            defaultModel: "claude-opus-4-5",
          }),
        };
      }
    }
  } catch {
    return fallback;
  }
  return fallback;
}

/* ── durable disk state ────────────────────────────────────────────────── */

const DISK_FILE = "sessions.json";
let cachedDiskDir = "";
let diskChain: Promise<void> = Promise.resolve();
const isDesktop = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * `~/Library/Application Support/Lantas` on macOS, and the equivalent app-data
 * directory on Windows and Linux. appDataDir points at the bundle identifier,
 * so its parent plus the product name is the stable product-level folder.
 */
async function diskDir(): Promise<string> {
  if (cachedDiskDir) return cachedDiskDir;
  const path = await import("@tauri-apps/api/path");
  const parent = await path.dirname(await path.appDataDir());
  const dir = await path.join(parent, "Lantas");
  const fs = await import("@tauri-apps/plugin-fs");
  await fs.mkdir(dir, { recursive: true }).catch((error) => {
    // mkdir is not idempotent on every platform; an existing directory is fine.
    if (!/exist/i.test(error instanceof Error ? error.message : String(error))) throw error;
  });
  cachedDiskDir = dir;
  return dir;
}

async function diskPath(): Promise<string> {
  const path = await import("@tauri-apps/api/path");
  return path.join(await diskDir(), DISK_FILE);
}

async function readDiskState(): Promise<Partial<AppState> | null> {
  if (!isDesktop()) return null;
  const fs = await import("@tauri-apps/plugin-fs");
  const file = await diskPath();
  const text = await fs.readTextFile(file);
  return JSON.parse(text) as Partial<AppState>;
}

/** Serialize writes so an older snapshot can never land after a newer one. */
async function writeDiskState(snapshot: ReturnType<typeof stateForDisk>): Promise<void> {
  if (!isDesktop()) return;
  const payload = JSON.stringify(snapshot);
  diskChain = diskChain.catch(() => undefined).then(async () => {
    const file = await diskPath();
    const fs = await import("@tauri-apps/plugin-fs");
    await fs.writeTextFile(file, payload);
  });
  await diskChain;
}

type DiskSnapshot = ReturnType<typeof stateForDisk>;

/**
 * One message small enough for the browser mirror: no screenshots, no undo
 * snapshots, and the long tool output capped. The disk copy is untouched.
 */
function trimMessageForStorage(message: Message): Message {
  return {
    ...message,
    attachments: message.attachments?.filter((attachment) => attachment.kind !== "image"),
    parts: message.parts.map((part) => {
      switch (part.kind) {
        case "text":
          return { ...part, text: part.text.slice(0, 12_000) };
        case "reasoning":
          return { ...part, text: part.text.slice(0, 2_000) };
        case "shell":
          return {
            ...part,
            output: part.output.slice(-40).map((line) => line.slice(0, 400)),
          };
        case "diff":
          return { ...part, lines: part.lines.slice(0, 120) };
        case "tool":
          return part.detail ? { ...part, detail: part.detail.slice(0, 300) } : part;
        default:
          return part;
      }
    }),
  };
}

/**
 * A mirror small enough to fit localStorage's ~5 MB budget.
 *
 * The previous version only dropped images, so a long session still carried
 * every terminal line and reasoning block and the quota error came back. This
 * keeps the recent conversations and trims each message; the disk copy holds
 * the whole thing.
 */
function compactForStorage(snapshot: DiskSnapshot) {
  return {
    ...snapshot,
    sessions: snapshot.sessions.slice(0, 12).map((session) => ({
      ...session,
      past: undefined,
      future: undefined,
      messages: session.messages.slice(-40).map(trimMessageForStorage),
    })),
  };
}

/** Last resort: the open conversation only, so a reload is never blank. */
function minimalForStorage(snapshot: DiskSnapshot) {
  const active =
    snapshot.sessions.find((session) => session.id === snapshot.activeId) ?? snapshot.sessions[0];
  return {
    ...snapshot,
    sessions: active
      ? [
          {
            ...active,
            past: undefined,
            future: undefined,
            messages: active.messages.slice(-10).map(trimMessageForStorage),
          },
        ]
      : [],
  };
}

function stateForDisk(state: AppState) {
  return {
    savedAt: Date.now(),
    sessions: state.sessions,
    activeId: state.activeId,
    view: state.view,
    mode: state.mode,
    scope: state.scope,
    workspaces: state.workspaces,
    activeWorkspaceId: state.activeWorkspaceId,
    browserUrl: state.browserUrl,
    workspaceName: state.workspaceName,
    workspaceRoot: state.workspaceRoot,
    settings: state.settings,
    skills: state.skills,
    mcpServers: state.mcpServers,
    commands: state.commands,
    sidebarOpen: state.sidebarOpen,
    panelOpen: state.panelOpen,
  };
}

export function LantasProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(loadState);
  const [staged, setStaged] = useState<StagedChange[]>([]);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [hydrated, setHydrated] = useState(() => !isDesktop());
  const toastTimer = useRef<number | undefined>(undefined);
  const stateRef = useRef(state);
  stateRef.current = state;
  const stagedRef = useRef(staged);
  stagedRef.current = staged;
  const diskWarned = useRef(false);
  const wasStreaming = useRef(false);

  // Pending assistant edits belong to the folder they were made in. Switching
  // projects discards the review instead of writing those edits into another
  // repository; nothing has touched disk yet.
  const forgetStagedForRoot = useCallback((nextRoot: string) => {
    if (nextRoot !== stateRef.current.workspaceRoot) setStaged([]);
  }, []);

  // Desktop boots from the last disk write. localStorage is the fallback for
  // the browser build and for a first launch where no file exists yet.
  useEffect(() => {
    if (!isDesktop()) return;
    let cancelled = false;
    void (async () => {
      try {
        const parsed = await readDiskState();
        const disk = stateFromStored(parsed, seedState());
        if (!cancelled && disk) {
          setState((prev) =>
            disk.sessions.length === 0 && prev.sessions.length > 0 ? prev : disk,
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // A missing file is normal on first launch; a permission or parse
        // failure is worth showing because the next save may also fail.
        if (!/no such file|not found|os error 2/i.test(message)) {
          setToast({ id: uid("toast"), text: `Disk backup unavailable: ${message}`, tone: "error" });
        }
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      const snapshot = stateForDisk(state);
      // Desktop has the full JSON on disk, so the mirror only needs to be a
      // recent, trimmed copy. Always replacing the old value frees whatever
      // the oversized snapshot was holding. Fall back once more to the open
      // conversation, and never interrupt a desktop turn over a mirror.
      const candidates = isDesktop()
        ? [compactForStorage(snapshot), minimalForStorage(snapshot)]
        : [snapshot, compactForStorage(snapshot), minimalForStorage(snapshot)];
      let mirrored = false;
      for (const candidate of candidates) {
        try {
          localStorage.removeItem(STORAGE_KEY);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(candidate));
          mirrored = true;
          break;
        } catch {
          // The next candidate is smaller; try it.
        }
      }
      if (!mirrored && !isDesktop() && !diskWarned.current) {
        diskWarned.current = true;
        setToast({
          id: uid("toast"),
          text: "Browser storage is full; this tab will keep the conversation until it closes.",
          tone: "error",
        });
      }

      void writeDiskState(snapshot).catch((error) => {
        if (diskWarned.current) return;
        diskWarned.current = true;
        setToast({
          id: uid("toast"),
          text: `Could not save to disk: ${
            error instanceof Error ? error.message : String(error)
          }`,
          tone: "error",
        });
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [state, hydrated]);

  const notify = useCallback((text: string, tone: "default" | "error" = "default") => {
    window.clearTimeout(toastTimer.current);
    setToast({ id: uid("toast"), text, tone });
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const checkpoint = useCallback<Store["checkpoint"]>(async () => {
    try {
      await writeDiskState(stateForDisk(stateRef.current));
      return true;
    } catch (error) {
      notify(
        `Could not checkpoint the session: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "error",
      );
      return false;
    }
  }, [notify]);

  // A streaming assistant message is the turn boundary. Save as soon as it
  // flips to complete instead of waiting for the next debounced change.
  const streamingNow = state.sessions.some(
    (session) => session.messages[session.messages.length - 1]?.streaming === true,
  );
  useEffect(() => {
    if (wasStreaming.current && !streamingNow && isDesktop()) void checkpoint();
    wasStreaming.current = streamingNow;
  }, [checkpoint, streamingNow]);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const recoverSession = useCallback<Store["recoverSession"]>(async () => {
    try {
      const parsed = await readDiskState();
      const disk = stateFromStored(parsed, seedState());
      if (!disk) {
        notify("No usable disk backup was found.", "error");
        return false;
      }
      setState(disk);
      notify("Restored sessions from the last disk save.");
      return true;
    } catch (error) {
      notify(
        `Could not read the disk backup: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "error",
      );
      return false;
    }
  }, [notify]);

  const createSession = useCallback<Store["createSession"]>((agent, provider, model, requestedSurface) => {
    const surface = requestedSurface ?? stateRef.current.mode;
    const workspace =
      stateRef.current.scope === "workspace"
        ? stateRef.current.workspaces.find(
            (item) => item.id === stateRef.current.activeWorkspaceId,
          )
        : undefined;
    // “New thread” on an untouched thread should focus that thread rather than
    // stacking empty ones in the sidebar every time the plus is pressed.
    const active = stateRef.current.sessions.find(
      (session) =>
        session.id === stateRef.current.activeId &&
        (session.surface ?? "chat") === surface &&
        (session.workspaceId ?? null) === (workspace?.id ?? null),
    );
    if (active && active.messages.length === 0) {
      setState((prev) => ({ ...prev, activeId: active.id }));
      return active.id;
    }
    const id = uid("ses");
    setState((prev) => {
      const nextProvider = provider ?? prev.settings.defaultProvider;
      const nextModel = model ?? prev.settings.defaultModel;
      const local = PROVIDERS.find((item) => item.id === nextProvider)?.local;
      const session: Session = {
        id,
        title: "New chat",
        cwd: workspace?.root || "~",
        branch: "main",
        created: Date.now(),
        updated: Date.now(),
        messages: [],
        todos: [],
        files: [],
        tokens: 0,
        contextWindow: local ? 32_000 : 200_000,
        cost: 0,
        agent: agent ?? prev.settings.defaultAgent,
        provider: nextProvider,
        model: nextModel,
        surface,
        workspaceId: workspace?.id,
      };
      return {
        ...prev,
        sessions: [session, ...prev.sessions],
        activeId: id,
        mode: surface,
        view: surface === "chat" ? "chats" : prev.view,
      };
    });
    return id;
  }, []);

  const selectSession = useCallback<Store["selectSession"]>((id) => {
    const incoming = stateRef.current.sessions.find((session) => session.id === id);
    const incomingWorkspace = stateRef.current.workspaces.find(
      (workspace) => workspace.id === incoming?.workspaceId,
    );
    if (incomingWorkspace) forgetStagedForRoot(incomingWorkspace.root);
    setState((prev) => {
      const session = prev.sessions.find((item) => item.id === id);
      const surface = session?.surface ?? "chat";
      if (!session) {
        return { ...prev, activeId: id, mode: id ? surface : prev.mode };
      }
      const workspace = prev.workspaces.find((item) => item.id === session.workspaceId);
      // A chat reopens its project's folder, so the agent is never pointed at
      // the files of the workspace you were looking at a moment ago. An
      // ordinary chat drops a project folder rather than silently using it.
      const projectRoot =
        !workspace &&
        Boolean(prev.workspaceRoot) &&
        prev.workspaces.some((item) => item.root === prev.workspaceRoot);
      const sameRoot = workspace ? prev.workspaceRoot === workspace.root : !projectRoot;
      return {
        ...prev,
        activeId: id,
        mode: surface,
        view: "chats",
        scope: workspace ? "workspace" : "chat",
        activeWorkspaceId: workspace?.id ?? prev.activeWorkspaceId,
        workspaceName: workspace
          ? workspace.name
          : projectRoot
            ? ""
            : prev.workspaceName,
        workspaceRoot: workspace
          ? workspace.root
          : projectRoot
            ? ""
            : prev.workspaceRoot,
        workspace: sameRoot ? prev.workspace : [],
      };
    });
  }, []);

  const deleteSession = useCallback<Store["deleteSession"]>((id) => {
    setState((prev) => ({
      ...prev,
      sessions: prev.sessions.filter((session) => session.id !== id),
      activeId: prev.activeId === id ? null : prev.activeId,
    }));
  }, []);

  const renameSession = useCallback<Store["renameSession"]>((id, title) => {
    const clean = title.trim();
    if (!clean) return;
    setState((prev) => ({
      ...prev,
      sessions: prev.sessions.map((session) =>
        session.id === id ? { ...session, title: clean, updated: Date.now() } : session,
      ),
    }));
  }, []);

  const updateSession = useCallback<Store["updateSession"]>((id, updater) => {
    setState((prev) => ({
      ...prev,
      sessions: prev.sessions.map((session) => (session.id === id ? updater(session) : session)),
    }));
  }, []);

  const addMessage = useCallback<Store["addMessage"]>((sessionId, message) => {
    setState((prev) => ({
      ...prev,
      sessions: prev.sessions.map((session) =>
        session.id === sessionId
          ? { ...session, messages: [...session.messages, message], updated: Date.now() }
          : session,
      ),
    }));
  }, []);

  const patchMessage = useCallback<Store["patchMessage"]>((sessionId, messageId, updater) => {
    setState((prev) => ({
      ...prev,
      sessions: prev.sessions.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              updated: Date.now(),
              messages: session.messages.map((message) =>
                message.id === messageId ? updater(message) : message,
              ),
            }
          : session,
      ),
    }));
  }, []);

  const setSettings = useCallback<Store["setSettings"]>((patch) => {
    setState((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }));
  }, []);

  const updateProvider = useCallback<Store["updateProvider"]>((id, patch) => {
    setState((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        providers: {
          ...prev.settings.providers,
          [id]: { ...prev.settings.providers[id], ...patch },
        },
      },
    }));
  }, []);

  const addSkill = useCallback<Store["addSkill"]>((skill) => {
    setState((prev) => ({ ...prev, skills: [skill, ...prev.skills] }));
  }, []);

  const updateSkill = useCallback<Store["updateSkill"]>((id, patch) => {
    setState((prev) => ({
      ...prev,
      skills: prev.skills.map((skill) => (skill.id === id ? { ...skill, ...patch } : skill)),
    }));
  }, []);

  const deleteSkill = useCallback<Store["deleteSkill"]>((id) => {
    setState((prev) => ({ ...prev, skills: prev.skills.filter((skill) => skill.id !== id) }));
  }, []);

  const addMcp = useCallback<Store["addMcp"]>((server) => {
    setState((prev) => ({ ...prev, mcpServers: [...prev.mcpServers, server] }));
  }, []);

  const updateMcp = useCallback<Store["updateMcp"]>((id, patch) => {
    setState((prev) => ({
      ...prev,
      mcpServers: prev.mcpServers.map((server) =>
        server.id === id ? { ...server, ...patch } : server,
      ),
    }));
  }, []);

  const deleteMcp = useCallback<Store["deleteMcp"]>((id) => {
    setState((prev) => ({
      ...prev,
      mcpServers: prev.mcpServers.filter((server) => server.id !== id),
    }));
  }, []);

  const setCommands = useCallback<Store["setCommands"]>((commands) => {
    setState((prev) => ({ ...prev, commands }));
  }, []);

  const setView = useCallback<Store["setView"]>((view) => {
    setState((prev) => ({ ...prev, view, activeId: view === "chats" ? prev.activeId : null }));
  }, []);

  const setMode = useCallback<Store["setMode"]>((mode) => {
    setState((prev) => {
      const current = prev.sessions.find((session) => session.id === prev.activeId);
      if (current && (current.surface ?? "chat") === mode) return { ...prev, mode };
      // Each surface reopens the thread you last used there, inside the same
      // scope (ordinary Chat or this workspace) instead of another project.
      const next = prev.sessions
        .filter(
          (session) =>
            (session.surface ?? "chat") === mode &&
            (prev.scope === "workspace"
              ? session.workspaceId === prev.activeWorkspaceId
              : !session.workspaceId),
        )
        .sort((a, b) => b.updated - a.updated)[0];
      return { ...prev, mode, activeId: next?.id ?? null };
    });
  }, []);

  const setScope = useCallback<Store["setScope"]>((scope) => {
    const current = stateRef.current;
    const target =
      scope === "workspace"
        ? current.workspaces.find((item) => item.id === current.activeWorkspaceId) ??
          current.workspaces[0]
        : undefined;
    forgetStagedForRoot(
      scope === "workspace"
        ? (target?.root ?? "")
        : current.workspaces.some((item) => item.root === current.workspaceRoot)
          ? ""
          : current.workspaceRoot,
    );
    setState((prev) => {
      if (scope === "chat") {
        const next = prev.sessions
          .filter((session) => !session.workspaceId)
          .sort((a, b) => b.updated - a.updated)[0];
        // Ordinary Chat is not attached to a project. A folder the user opened
        // directly in Chat stays; a workspace's folder does not leak into it.
        const projectRoot =
          Boolean(prev.workspaceRoot) &&
          prev.workspaces.some((item) => item.root === prev.workspaceRoot);
        return {
          ...prev,
          scope,
          mode: "chat",
          view: "chats",
          activeId: next?.id ?? null,
          workspaceRoot: projectRoot ? "" : prev.workspaceRoot,
          workspaceName: projectRoot ? "" : prev.workspaceName,
          workspace: projectRoot ? [] : prev.workspace,
        };
      }
      const workspace =
        prev.workspaces.find((item) => item.id === prev.activeWorkspaceId) ??
        prev.workspaces[0];
      const next = prev.sessions
        .filter(
          (session) =>
            session.workspaceId === workspace?.id && (session.surface ?? "chat") === "chat",
        )
        .sort((a, b) => b.updated - a.updated)[0];
      return {
        ...prev,
        scope,
        mode: "chat",
        view: "chats",
        activeWorkspaceId: workspace?.id ?? null,
        workspaceName: workspace?.name ?? prev.workspaceName,
        workspaceRoot: workspace?.root ?? "",
        workspace: workspace && prev.workspaceRoot === workspace.root ? prev.workspace : [],
        activeId: next?.id ?? null,
      };
    });
  }, []);

  const createWorkspace = useCallback<Store["createWorkspace"]>((name, root) => {
    const existing = stateRef.current.workspaces.find((item) => item.root === root);
    forgetStagedForRoot(root);
    if (existing) {
      setState((prev) => {
        const next = prev.sessions
          .filter(
            (session) =>
              session.workspaceId === existing.id && (session.surface ?? "chat") === "chat",
          )
          .sort((a, b) => b.updated - a.updated)[0];
        return {
          ...prev,
          scope: "workspace",
          activeWorkspaceId: existing.id,
          mode: "chat",
          view: "chats",
          activeId: next?.id ?? null,
          workspaceName: existing.name,
          workspaceRoot: existing.root,
          workspace: prev.workspaceRoot === existing.root ? prev.workspace : [],
        };
      });
      return existing.id;
    }
    const id = uid("ws");
    setState((prev) => ({
      ...prev,
      scope: "workspace",
      workspaces: [
        ...prev.workspaces,
        {
          id,
          name,
          root,
          color: WORKSPACE_COLORS[prev.workspaces.length % WORKSPACE_COLORS.length],
          created: Date.now(),
          updated: Date.now(),
        },
      ],
      activeWorkspaceId: id,
      mode: "chat",
      view: "chats",
      activeId: null,
      workspaceName: name,
      workspaceRoot: root,
      workspace: [],
    }));
    return id;
  }, []);

  const selectWorkspace = useCallback<Store["selectWorkspace"]>((id) => {
    const target = stateRef.current.workspaces.find((item) => item.id === id);
    if (target) forgetStagedForRoot(target.root);
    setState((prev) => {
      const workspace = prev.workspaces.find((item) => item.id === id);
      if (!workspace) return prev;
      const next = prev.sessions
        .filter(
          (session) => session.workspaceId === id && (session.surface ?? "chat") === "chat",
        )
        .sort((a, b) => b.updated - a.updated)[0];
      const sameRoot = prev.workspaceRoot === workspace.root;
      return {
        ...prev,
        scope: "workspace",
        activeWorkspaceId: id,
        mode: "chat",
        view: "chats",
        activeId: next?.id ?? null,
        workspaceName: workspace.name,
        workspaceRoot: workspace.root,
        workspace: sameRoot ? prev.workspace : [],
      };
    });
  }, []);

  const updateWorkspace = useCallback<Store["updateWorkspace"]>((id, patch) => {
    setState((prev) => ({
      ...prev,
      workspaces: prev.workspaces.map((workspace) =>
        workspace.id === id ? { ...workspace, ...patch, updated: Date.now() } : workspace,
      ),
    }));
  }, []);

  const deleteWorkspace = useCallback<Store["deleteWorkspace"]>((id) => {
    if (stateRef.current.activeWorkspaceId === id) forgetStagedForRoot("");
    setState((prev) => {
      const workspaces = prev.workspaces.filter((workspace) => workspace.id !== id);
      const active = prev.activeWorkspaceId === id;
      const sessions = prev.sessions.map((session) =>
        session.workspaceId === id ? { ...session, workspaceId: undefined } : session,
      );
      const next = workspaces[0];
      return {
        ...prev,
        workspaces,
        sessions,
        activeWorkspaceId: active ? (next?.id ?? null) : prev.activeWorkspaceId,
        scope: active && !next ? "chat" : prev.scope,
        activeId: active ? null : prev.activeId,
        workspaceName: active ? (next?.name ?? prev.workspaceName) : prev.workspaceName,
        workspaceRoot: active ? (next?.root ?? "") : prev.workspaceRoot,
        workspace: active && next?.root !== prev.workspaceRoot ? [] : prev.workspace,
      };
    });
  }, []);

  const setBrowserUrl = useCallback<Store["setBrowserUrl"]>((browserUrl) => {
    setState((prev) => ({ ...prev, browserUrl }));
  }, []);

  const setWorkspace = useCallback<Store["setWorkspace"]>((workspaceName, workspace, root) => {
    setState((prev) => ({
      ...prev,
      workspaceName,
      workspace,
      workspaceRoot: root ?? prev.workspaceRoot,
    }));
  }, []);

  const patchWorkspaceFile = useCallback<Store["patchWorkspaceFile"]>((path, text) => {
    setState((prev) => {
      const exists = prev.workspace.some((file) => file.path === path);
      return {
        ...prev,
        workspace: exists
          ? prev.workspace.map((file) =>
              file.path === path ? { ...file, text, size: text.length } : file,
            )
          : [
              ...prev.workspace,
              {
                id: path,
                name: path.split("/").pop() ?? path,
                path,
                size: text.length,
                text,
                added: Date.now(),
              },
            ],
      };
    });
  }, []);

  const clearWorkspace = useCallback(() => {
    setStaged([]);
    setState((prev) => ({ ...prev, workspaceName: "", workspaceRoot: "", workspace: [] }));
  }, []);

  /**
   * Holds one assistant edit in memory. Nothing reaches disk until Keep, so a
   * bad turn costs a click rather than a git checkout.
   */
  const stageChange = useCallback((path: string, after: string) => {
    const file = stateRef.current.workspace.find((entry) => entry.path === path);
    setStaged((current) => {
      const existing = current.find((entry) => entry.path === path);
      const next: StagedChange = {
        path,
        before: existing?.before ?? file?.text ?? "",
        after,
        existed: existing?.existed ?? Boolean(file),
        at: Date.now(),
      };
      return existing
        ? current.map((entry) => (entry.path === path ? next : entry))
        : [...current, next];
    });
  }, []);

  const keepStaged = useCallback(async () => {
    const changes = stagedRef.current;
    if (!changes.length) return 0;
    const root = stateRef.current.workspaceRoot;
    if (!root) {
      setStaged([]);
      return changes.length;
    }
    let written = 0;
    let failed = 0;
    for (const change of changes) {
      try {
        // Sequential on purpose: one failed write should not hide the others.
        // eslint-disable-next-line no-await-in-loop
        const ok = await writeWorkspacePath(root, change.path, change.after);
        if (ok) written += 1;
        else failed += 1;
      } catch (error) {
        failed += 1;
        console.error(`Could not write ${change.path}`, error);
      }
    }
    if (failed > 0) {
      notify(
        `${failed} file${failed === 1 ? "" : "s"} stayed in the workspace but could not be written to disk.`,
        "error",
      );
    }
    setStaged([]);
    return written;
  }, [notify]);

  const discardStaged = useCallback(() => {
    const changes = stagedRef.current;
    setState((prev) => {
      let workspace = prev.workspace;
      for (const change of changes) {
        workspace = change.existed
          ? workspace.map((file) =>
              file.path === change.path
                ? { ...file, text: change.before, size: change.before.length }
                : file,
            )
          : workspace.filter((file) => file.path !== change.path);
      }
      return { ...prev, workspace };
    });
    setStaged([]);
  }, []);

  const keepChange = useCallback(async (path: string) => {
    const change = stagedRef.current.find((entry) => entry.path === path);
    if (!change) return false;
    let ok = false;
    try {
      ok = await writeWorkspacePath(
        stateRef.current.workspaceRoot,
        change.path,
        change.after,
      );
    } catch {
      ok = false;
    }
    setStaged((current) => current.filter((entry) => entry.path !== path));
    return ok;
  }, []);

  const discardChange = useCallback((path: string) => {
    const change = stagedRef.current.find((entry) => entry.path === path);
    if (!change) return;
    setState((prev) => ({
      ...prev,
      workspace: change.existed
        ? prev.workspace.map((file) =>
            file.path === change.path
              ? { ...file, text: change.before, size: change.before.length }
              : file,
          )
        : prev.workspace.filter((file) => file.path !== change.path),
    }));
    setStaged((current) => current.filter((entry) => entry.path !== path));
  }, []);

  const undo = useCallback<Store["undo"]>((sessionId) => {
    setState((prev) => ({
      ...prev,
      sessions: prev.sessions.map((session) => {
        if (session.id !== sessionId || !session.past?.length) return session;
        const past = [...session.past];
        const previous = past.pop() as Message[];
        return {
          ...session,
          messages: previous,
          past,
          future: [...(session.future ?? []), session.messages],
        };
      }),
    }));
  }, []);

  const redo = useCallback<Store["redo"]>((sessionId) => {
    setState((prev) => ({
      ...prev,
      sessions: prev.sessions.map((session) => {
        if (session.id !== sessionId || !session.future?.length) return session;
        const future = [...session.future];
        const next = future.pop() as Message[];
        return {
          ...session,
          messages: next,
          future,
          past: [...(session.past ?? []), session.messages],
        };
      }),
    }));
  }, []);

  const toggleSidebar = useCallback(() => {
    setState((prev) => ({ ...prev, sidebarOpen: !prev.sidebarOpen }));
  }, []);

  const togglePanel = useCallback(() => {
    setState((prev) => ({ ...prev, panelOpen: !prev.panelOpen }));
  }, []);

  const activeSession = useMemo(
    () => state.sessions.find((session) => session.id === state.activeId) ?? null,
    [state.sessions, state.activeId],
  );

  const value = useMemo<Store>(
    () => ({
      state,
      activeSession,
      createSession,
      selectSession,
      deleteSession,
      renameSession,
      updateSession,
      addMessage,
      patchMessage,
      setSettings,
      updateProvider,
      addSkill,
      updateSkill,
      deleteSkill,
      addMcp,
      updateMcp,
      deleteMcp,
      setCommands,
      setView,
      setMode,
      setScope,
      createWorkspace,
      selectWorkspace,
      updateWorkspace,
      deleteWorkspace,
      setBrowserUrl,
      setWorkspace,
      patchWorkspaceFile,
      clearWorkspace,
      staged,
      stageChange,
      keepStaged,
      discardStaged,
      keepChange,
      discardChange,
      recoverSession,
      checkpoint,
      undo,
      redo,
      toggleSidebar,
      togglePanel,
      toast,
      notify,
    }),
    [
      state,
      activeSession,
      createSession,
      selectSession,
      deleteSession,
      renameSession,
      updateSession,
      addMessage,
      patchMessage,
      setSettings,
      updateProvider,
      addSkill,
      updateSkill,
      deleteSkill,
      addMcp,
      updateMcp,
      deleteMcp,
      setCommands,
      setView,
      setMode,
      setScope,
      createWorkspace,
      selectWorkspace,
      updateWorkspace,
      deleteWorkspace,
      setBrowserUrl,
      setWorkspace,
      patchWorkspaceFile,
      clearWorkspace,
      staged,
      stageChange,
      keepStaged,
      discardStaged,
      keepChange,
      discardChange,
      recoverSession,
      checkpoint,
      undo,
      redo,
      toggleSidebar,
      togglePanel,
      toast,
      notify,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used inside LantasProvider");
  return store;
}
