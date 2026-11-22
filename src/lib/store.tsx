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
  AgentId,
  AppState,
  McpServer,
  Message,
  ProviderConfig,
  ProviderId,
  Session,
  Settings,
  Skill,
  ViewId,
} from "./types";
import { DEFAULT_SETTINGS, PROVIDERS, seedState } from "./data";
import { uid } from "./util";

const STORAGE_KEY = "lantas.app.v2";
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
  setView: (view: ViewId) => void;
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

function loadState(): AppState {
  const fallback = seedState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppState>;
      if (!Array.isArray(parsed.sessions)) return fallback;
      return {
        sessions: parsed.sessions as Session[],
        activeId: typeof parsed.activeId === "string" ? parsed.activeId : null,
        view: (parsed.view as ViewId) ?? "chats",
        settings: {
          ...DEFAULT_SETTINGS,
          ...(parsed.settings ?? {}),
          providers: { ...DEFAULT_SETTINGS.providers, ...(parsed.settings?.providers ?? {}) },
        },
        skills: parsed.skills ?? fallback.skills,
        mcpServers: parsed.mcpServers ?? fallback.mcpServers,
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
          settings: {
            ...fallback.settings,
            ...(parsed.settings ?? {}),
            providers: fallback.settings.providers,
            defaultProvider: "anthropic",
            defaultModel: "claude-opus-4-5",
          },
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
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            sessions: state.sessions,
            activeId: state.activeId,
            view: state.view,
            settings: state.settings,
            skills: state.skills,
            mcpServers: state.mcpServers,
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

  const setView = useCallback<Store["setView"]>((view) => {
    setState((prev) => ({ ...prev, view, activeId: view === "chats" ? prev.activeId : null }));
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
      setView,
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
      setView,
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
