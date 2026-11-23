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
  Session,
  Settings,
  Skill,
  StagedChange,
  ViewId,
  WorkspaceFile,
} from "./types";
import { DEFAULT_SETTINGS, PROVIDERS, SKILL_SEEDS, seedState } from "./data";
import { uid } from "./util";
import { writeWorkspaceFile } from "./workspace";

const STORAGE_KEY = "lantas.app.v2";
/** Threads that shipped as sample content in earlier builds. */
const DEMO_THREADS = new Set(["ses_streams", "ses_auth", "ses_ci"]);
const LEGACY_KEY = "lantas.workspace.v1";

export interface ToastMessage {
  id: string;
  text: string;
  tone: "default" | "error";
}

interface Store {
  state: AppState;
  activeSession: Session | null;
  createSession: (agent?: AgentId, provider?: ProviderId, model?: string) => string;
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

function loadState(): AppState {
  const fallback = seedState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppState>;
      if (!Array.isArray(parsed.sessions)) return fallback;
      const sessions = (parsed.sessions as Session[]).filter(
        (session) => !DEMO_THREADS.has(session.id),
      );
      const activeId =
        typeof parsed.activeId === "string" && sessions.some((s) => s.id === parsed.activeId)
          ? parsed.activeId
          : (sessions[0]?.id ?? null);
      return {
        sessions,
        activeId,
        view: (parsed.view as ViewId) ?? "chats",
        mode: (parsed.mode as Mode) ?? "chat",
        browserUrl: typeof parsed.browserUrl === "string" ? parsed.browserUrl : "https://example.com",
        workspace: [],
        workspaceName: parsed.workspaceName ?? "",
        workspaceRoot: parsed.workspaceRoot ?? "",
        settings: normalizeSettings(parsed.settings),
        skills: mergeBuiltins(parsed.skills, fallback.skills),
        mcpServers: parsed.mcpServers ?? fallback.mcpServers,
        commands: parsed.commands ?? [],
        sidebarOpen: parsed.sidebarOpen ?? true,
        panelOpen: parsed.panelOpen ?? true,
      };
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

export function LantasProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(loadState);
  const [staged, setStaged] = useState<StagedChange[]>([]);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const stateRef = useRef(state);
  stateRef.current = state;
  const stagedRef = useRef(staged);
  stagedRef.current = staged;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            sessions: state.sessions,
            activeId: state.activeId,
            view: state.view,
            mode: state.mode,
            browserUrl: state.browserUrl,
            workspaceName: state.workspaceName,
            workspaceRoot: state.workspaceRoot,
            settings: state.settings,
            skills: state.skills,
            mcpServers: state.mcpServers,
            commands: state.commands,
            sidebarOpen: state.sidebarOpen,
            panelOpen: state.panelOpen,
          }),
        );
      } catch {
        /* storage full or unavailable — the app keeps working in memory */
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [state]);

  const notify = useCallback((text: string, tone: "default" | "error" = "default") => {
    window.clearTimeout(toastTimer.current);
    setToast({ id: uid("toast"), text, tone });
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const createSession = useCallback<Store["createSession"]>((agent, provider, model) => {
    const id = uid("ses");
    setState((prev) => {
      const nextProvider = provider ?? prev.settings.defaultProvider;
      const nextModel = model ?? prev.settings.defaultModel;
      const local = PROVIDERS.find((item) => item.id === nextProvider)?.local;
      const session: Session = {
        id,
        title: "New session",
        cwd: "~/dev/lantas",
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
      };
      return { ...prev, sessions: [session, ...prev.sessions], activeId: id, view: "chats" };
    });
    return id;
  }, []);

  const selectSession = useCallback<Store["selectSession"]>((id) => {
    setState((prev) => ({ ...prev, activeId: id, view: id ? "chats" : prev.view }));
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
    setState((prev) => ({ ...prev, mode }));
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
    let written = 0;
    for (const change of changes) {
      try {
        // Sequential on purpose: one failed write should not hide the others.
        // eslint-disable-next-line no-await-in-loop
        const ok = await writeWorkspaceFile(root, change.path, change.after);
        if (ok) written += 1;
      } catch {
        /* the workspace copy stays, and the user can save from the editor */
      }
    }
    setStaged([]);
    return written;
  }, []);

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
      ok = await writeWorkspaceFile(
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
