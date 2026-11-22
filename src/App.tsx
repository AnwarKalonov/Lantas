import { useCallback, useEffect, useRef, useState } from "react";
import { runAgent, type Emit } from "./lib/agent";
import { buildHistory, buildSystemPrompt } from "./lib/chat";
import { isConfigured, streamChat } from "./lib/providers";
import { useStore } from "./lib/store";
import type { AgentId, Message, Part, ProviderId, Session } from "./lib/types";
import { cx, titleFrom, uid } from "./lib/util";
import { CommandPalette } from "./components/CommandPalette";
import { ContextPanel } from "./components/ContextPanel";
import { Home } from "./components/Home";
import { IntegrationsView } from "./components/IntegrationsView";
import { SessionView } from "./components/SessionView";
import { SettingsModal, type SettingsTab } from "./components/SettingsModal";
import { Sidebar } from "./components/Sidebar";
import { SkillsView } from "./components/SkillsView";
import { TitleBar } from "./components/TitleBar";
import { PROVIDERS } from "./lib/data";

export function App() {
  const {
    state,
    activeSession,
    createSession,
    addMessage,
    patchMessage,
    updateSession,
    toggleSidebar,
    togglePanel,
    setSettings,
    toast,
  } = useStore();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const runs = useRef<Record<string, AbortController>>({});

  const streaming = Boolean(activeSession?.messages.at(-1)?.streaming);

  const openSettings = useCallback((tab: SettingsTab = "general") => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      const resolved =
        state.settings.theme === "system"
          ? query.matches
            ? "light"
            : "dark"
          : state.settings.theme;
      document.documentElement.dataset.theme = resolved;
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [state.settings.theme]);

  useEffect(() => {
    document.documentElement.classList.toggle("reduce-motion", state.settings.reduceMotion);
  }, [state.settings.reduceMotion]);

  useEffect(() => () => {
    Object.values(runs.current).forEach((controller) => controller.abort());
  }, []);

  const handleSend = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text) return;

      const existing = activeSession;
      if (existing?.messages.some((message) => message.streaming)) return;

      const sessionId = existing ? existing.id : createSession();
      const agent = existing?.agent ?? state.settings.defaultAgent;
      const provider = existing?.provider ?? state.settings.defaultProvider;
      const model = existing?.model ?? state.settings.defaultModel;
      const providerConfig = state.settings.providers[provider];
      const live = isConfigured(provider, providerConfig);
      const snapshot: Session | null = existing ?? null;
      const assistantId = uid("msg");
      const isNew = !existing || existing.messages.length === 0;

      addMessage(sessionId, {
        id: uid("msg"),
        role: "user",
        parts: [{ id: uid("part"), kind: "text", text }],
        created: Date.now(),
      });

      addMessage(sessionId, {
        id: assistantId,
        role: "assistant",
        parts: [],
        created: Date.now(),
        agent,
        provider,
        model,
        streaming: true,
      });

      updateSession(sessionId, (session) => ({
        ...session,
        updated: Date.now(),
        title: isNew ? titleFrom(text) : session.title,
      }));

      const controller = new AbortController();
      runs.current[sessionId] = controller;
      const started = Date.now();
      const patch = (updater: (message: Message) => Message) =>
        patchMessage(sessionId, assistantId, updater);

      try {
        if (live) {
          let textPartId: string | null = null;
          let inputTokens = 0;
          let outputTokens = 0;

          const history = snapshot
            ? [...buildHistory(snapshot), { role: "user" as const, content: text }]
            : [{ role: "user" as const, content: text }];

          const system = snapshot
            ? buildSystemPrompt(snapshot, state.skills)
            : buildSystemPrompt(
                { cwd: "~/dev/lantas", branch: "main", agent } as Session,
                state.skills,
              );

          await streamChat({
            provider,
            config: providerConfig,
            model,
            system,
            messages: history,
            signal: controller.signal,
            onDelta: (chunk) => {
              if (!textPartId) {
                const id = uid("part");
                textPartId = id;
                patch((message) => ({
                  ...message,
                  parts: [...message.parts, { id, kind: "text", text: chunk }],
                }));
              } else {
                const id = textPartId;
                patch((message) => ({
                  ...message,
                  parts: message.parts.map((part) =>
                    part.id === id && part.kind === "text"
                      ? { ...part, text: part.text + chunk }
                      : part,
                  ),
                }));
              }
            },
            onUsage: (usage) => {
              inputTokens = usage.input ?? inputTokens;
              outputTokens = usage.output ?? outputTokens;
            },
          });

          const tokens =
            inputTokens + outputTokens ||
            Math.max(1, Math.round(text.length / 3.6) + Math.round(200 / 3.6));

          patch((message) => ({
            ...message,
            streaming: false,
            durationMs: Date.now() - started,
            tokens,
          }));
          updateSession(sessionId, (session) => ({
            ...session,
            tokens: session.tokens + tokens,
            updated: Date.now(),
          }));
        } else {
          patch((message) => ({
            ...message,
            parts: [
              ...message.parts,
              {
                id: uid("part"),
                kind: "note",
                text: "Demo runtime. Connect a provider in Settings → Providers for live replies.",
              },
            ],
          }));

          const emit: Emit = {
            part: (part: Part) =>
              patch((message) => ({ ...message, parts: [...message.parts, part] })),
            patchPart: (id, delta) =>
              patch((message) => ({
                ...message,
                parts: message.parts.map((part) =>
                  part.id === id ? ({ ...part, ...delta } as Part) : part,
                ),
              })),
            appendText: (id, chunk) =>
              patch((message) => ({
                ...message,
                parts: message.parts.map((part) =>
                  part.id === id && part.kind === "text"
                    ? { ...part, text: part.text + chunk }
                    : part,
                ),
              })),
            appendOutput: (id, line) =>
              patch((message) => ({
                ...message,
                parts: message.parts.map((part) =>
                  part.id === id && part.kind === "shell"
                    ? { ...part, output: [...part.output, line] }
                    : part,
                ),
              })),
            todos: (todos) => updateSession(sessionId, (session) => ({ ...session, todos })),
            file: (file) =>
              updateSession(sessionId, (session) => ({
                ...session,
                files: session.files.some((item) => item.path === file.path)
                  ? session.files.map((item) => (item.path === file.path ? file : item))
                  : [...session.files, file],
              })),
            done: ({ durationMs, tokens, cost }) => {
              patch((message) => ({ ...message, streaming: false, durationMs, tokens, cost }));
              updateSession(sessionId, (session) => ({
                ...session,
                tokens: session.tokens + tokens,
                cost: session.cost + cost,
                updated: Date.now(),
              }));
            },
          };

          await runAgent(text, emit, controller.signal);
        }
      } catch (error) {
        const aborted = error instanceof DOMException && error.name === "AbortError";
        const detail =
          error instanceof Error ? error.message.slice(0, 400) : String(error).slice(0, 400);

        patch((message) =>
          aborted
            ? {
                ...message,
                streaming: false,
                interrupted: true,
                parts: message.parts.length
                  ? message.parts
                  : [
                      {
                        id: uid("part"),
                        kind: "note",
                        text: "Stopped before anything streamed.",
                      },
                    ],
              }
            : {
                ...message,
                streaming: false,
                parts: [
                  ...message.parts,
                  { id: uid("part"), kind: "note", text: `Request failed. ${detail}` },
                ],
              },
        );
      } finally {
        if (runs.current[sessionId] === controller) delete runs.current[sessionId];
      }
    },
    [
      activeSession,
      createSession,
      addMessage,
      patchMessage,
      updateSession,
      state.settings.defaultAgent,
      state.settings.defaultModel,
      state.settings.defaultProvider,
      state.settings.providers,
      state.skills,
    ],
  );

  const handleStop = useCallback(() => {
    if (!activeSession) return;
    runs.current[activeSession.id]?.abort();
  }, [activeSession]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;

      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        createSession();
        return;
      }
      if (event.key.toLowerCase() === "b") {
        event.preventDefault();
        if (event.shiftKey) togglePanel();
        else toggleSidebar();
        return;
      }
      if (event.key === ",") {
        event.preventDefault();
        openSettings("general");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createSession, togglePanel, toggleSidebar, openSettings]);

  const changeModel = (sessionId: string, provider: ProviderId, model: string) => {
    const local = PROVIDERS.find((item) => item.id === provider)?.local;
    updateSession(sessionId, (session) => ({
      ...session,
      provider,
      model,
      contextWindow: local ? 32_000 : 200_000,
    }));
    setSettings({ defaultProvider: provider, defaultModel: model });
  };

  const title =
    state.view === "skills"
      ? "Skills"
      : state.view === "integrations"
        ? "Integrations"
        : activeSession?.title ?? "Home";

  return (
    <div className="app">
      <TitleBar
        title={title}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenSettings={() => openSettings("general")}
      />

      <div className="workspace">
        {state.sidebarOpen && <Sidebar onOpenSettings={() => openSettings("general")} />}

        <main className="main">
          {state.view === "skills" && <SkillsView />}
          {state.view === "integrations" && <IntegrationsView />}
          {state.view === "chats" &&
            (activeSession ? (
              <SessionView
                key={activeSession.id}
                session={activeSession}
                streaming={streaming}
                onSend={handleSend}
                onStop={handleStop}
                onAgentChange={(agent: AgentId) =>
                  updateSession(activeSession.id, (session) => ({ ...session, agent }))
                }
                onModelChange={(provider, model) =>
                  changeModel(activeSession.id, provider, model)
                }
                onOpenProviders={() => openSettings("providers")}
              />
            ) : (
              <Home
                onSend={handleSend}
                onOpenSettings={() => openSettings("providers")}
              />
            ))}
        </main>

        {state.panelOpen && (
          <ContextPanel session={activeSession} onOpenSettings={() => openSettings("providers")} />
        )}
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenSettings={openSettings}
        onPrompt={handleSend}
      />

      <SettingsModal
        open={settingsOpen}
        initialTab={settingsTab}
        onClose={() => setSettingsOpen(false)}
      />

      {toast && (
        <div className={cx("toast", toast.tone === "error" && "is-error")} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}
