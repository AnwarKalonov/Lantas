import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runAgent, type Emit } from "./lib/agent";
import { buildHistory, buildSystemPrompt, parseImage } from "./lib/chat";
import { isConfigured, streamChat } from "./lib/providers";
import { useStore } from "./lib/store";
import { acquireScreen, captureFrame, currentScreen, releaseScreen } from "./lib/screen";
import { openWorkspaceFolder } from "./lib/workspace";
import type { AgentId, Attachment, Message, Mode, Part, ProviderId, Session } from "./lib/types";
import { cx, titleFrom, uid } from "./lib/util";
import { CodeView } from "./components/CodeView";
import { CommandPalette } from "./components/CommandPalette";
import { ContextPanel } from "./components/ContextPanel";
import { Home } from "./components/Home";
import { IntegrationsView } from "./components/IntegrationsView";
import { SessionView } from "./components/SessionView";
import { SettingsModal, type SettingsTab } from "./components/SettingsModal";
import { Sidebar } from "./components/Sidebar";
import { SkillsView } from "./components/SkillsView";
import { TitleBar } from "./components/TitleBar";
import { PROVIDERS, SLASH_COMMANDS } from "./lib/data";

const THEME_ORDER = ["dark", "light", "glass", "system"] as const;

/** Commands that become an instruction instead of running in the shell. */
const PROMPT_COMMANDS: Record<string, string> = {
  "/init":
    "Read this repository and write a concise AGENTS.md: what the project does, how to install, run, test and lint it, the directory map, and the conventions a new contributor must follow. Show me the file before writing anything.",
  "/review":
    "Review my current changes like a senior engineer. List real defects (correctness, security, data loss, race conditions) with file:line, worst first. Skip style opinions. If nothing is wrong, say so plainly.",
  "/fix":
    "Find the failing thing, explain the cause in one or two sentences, then fix the cause with the smallest change. Re-run the relevant check and report what passed.",
  "/test":
    "Run the project's tests, read the failures, and fix the cause rather than the assertion. Report the command and its real output.",
  "/plan":
    "Do not edit files. Produce a plan: the goal, the files you will touch, the risks, the verification step, and the order of work. Wait for my go-ahead.",
  "/diff":
    "Show the diff of your last change, then explain each hunk in one line.",
  "/commit":
    "Commit the current changes with a short, specific message about why the change was made. Do not push.",
  "/explain":
    "Explain how this part of the codebase works, top-down, with the real file and line references. No speculation.",
};

export function App() {
  const {
    state,
    activeSession,
    createSession,
    addMessage,
    patchMessage,
    updateSession,
    setSettings,
    setMode,
    setView,
    setWorkspace,
    undo,
    redo,
    toggleSidebar,
    togglePanel,
    notify,
    toast,
  } = useStore();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [helpOpen, setHelpOpen] = useState(false);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const runs = useRef<Record<string, AbortController>>({});
  const screenRef = useRef<HTMLVideoElement | null>(null);

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

  useEffect(() => {
    if (screenRef.current && screenStream) {
      screenRef.current.srcObject = screenStream;
      void screenRef.current.play().catch(() => {});
    }
  }, [screenStream]);

  useEffect(() => () => {
    Object.values(runs.current).forEach((controller) => controller.abort());
  }, []);

  const startScreen = useCallback(async () => {
    try {
      const stream = await acquireScreen();
      setScreenStream(stream);
      setSettings({ screenAccess: true });
      notify("Screen shared — the next turn includes a frame");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Screen access was declined", "error");
    }
  }, [notify, setSettings]);

  const stopScreen = useCallback(() => {
    releaseScreen();
    setScreenStream(null);
    setSettings({ screenAccess: false });
    notify("Screen sharing stopped");
  }, [notify, setSettings]);

  const handleScreenToggle = useCallback(() => {
    if (screenStream) stopScreen();
    else void startScreen();
  }, [screenStream, startScreen, stopScreen]);

  const openFolder = useCallback(async () => {
    try {
      const next = await openWorkspaceFolder();
      if (!next) return;
      setWorkspace(next.name, next.files);
      notify(`${next.files.length} files from ${next.name}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not open that folder", "error");
    }
  }, [notify, setWorkspace]);

  const exportSession = useCallback(
    (session: Session | null) => {
      if (!session) {
        notify("Nothing to export yet", "error");
        return;
      }
      const blob = new Blob([JSON.stringify(session, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${session.title.replace(/[^\w-]+/g, "-").toLowerCase() || "thread"}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      notify("Thread exported");
    },
    [notify],
  );

  const copyTranscript = useCallback(
    (session: Session | null) => {
      if (!session) return;
      const text = session.messages
        .map((message) => {
          const body = message.parts
            .map((part) => (part.kind === "text" ? part.text : part.kind === "note" ? part.text : ""))
            .filter(Boolean)
            .join("\n\n");
          return `${message.role === "user" ? "You" : "Lantas"}:\n${body}`;
        })
        .join("\n\n---\n\n");
      navigator.clipboard?.writeText(text).catch(() => {});
      notify("Transcript copied");
    },
    [notify],
  );

  /** Returns true when the text was a command and should not be sent. */
  const runCommand = useCallback(
    (raw: string): boolean => {
      const [name] = raw.slice(1).split(/\s+/);
      const command = `/${name.toLowerCase()}`;
      const session = activeSession;

      switch (command) {
        case "/new":
          createSession();
          setMode("chat");
          return true;
        case "/clear":
          if (session) updateSession(session.id, (current) => ({ ...current, messages: [] }));
          return true;
        case "/undo":
          if (session) undo(session.id);
          return true;
        case "/redo":
          if (session) redo(session.id);
          return true;
        case "/export":
          exportSession(session);
          return true;
        case "/copy":
          copyTranscript(session);
          return true;
        case "/code":
          setMode("code");
          return true;
        case "/chat":
          setMode("chat");
          return true;
        case "/attach":
          notify("Use the paperclip in the composer");
          return true;
        case "/screen":
          void startScreen();
          return true;
        case "/theme": {
          const index = THEME_ORDER.indexOf(state.settings.theme as (typeof THEME_ORDER)[number]);
          const next = THEME_ORDER[(index + 1) % THEME_ORDER.length];
          setSettings({ theme: next });
          notify(`Theme: ${next}`);
          return true;
        }
        case "/plan":
          if (session) updateSession(session.id, (current) => ({ ...current, agent: "plan" }));
          else setSettings({ defaultAgent: "plan" });
          return true;
        case "/build":
          if (session) updateSession(session.id, (current) => ({ ...current, agent: "build" }));
          else setSettings({ defaultAgent: "build" });
          return true;
        case "/model":
          openSettings("models");
          return true;
        case "/agents":
          openSettings("agents");
          return true;
        case "/skills":
          openSettings("skills");
          return true;
        case "/mcp":
          openSettings("integrations");
          return true;
        case "/permissions":
          openSettings("permissions");
          return true;
        case "/usage":
          togglePanel();
          notify(`${session?.tokens ?? 0} tokens · $${(session?.cost ?? 0).toFixed(2)}`);
          return true;
        case "/help":
          setHelpOpen(true);
          return true;
        case "/compact":
          if (session) {
            updateSession(session.id, (current) => ({
              ...current,
              messages: [
                ...current.messages.slice(0, 1),
                {
                  id: uid("msg"),
                  role: "assistant",
                  created: Date.now(),
                  parts: [
                    {
                      id: uid("part"),
                      kind: "note",
                      text: `Compacted ${Math.max(0, current.messages.length - 5)} earlier messages. The thread keeps its last turns and the system prompt.`,
                    },
                  ],
                },
                ...current.messages.slice(-4),
              ],
            }));
            notify("Thread compacted");
          }
          return true;
        default:
          return false;
      }
    },
    [
      activeSession,
      copyTranscript,
      createSession,
      exportSession,
      notify,
      openSettings,
      redo,
      setMode,
      setSettings,
      startScreen,
      state.settings.theme,
      togglePanel,
      undo,
      updateSession,
    ],
  );

  const handleSend = useCallback(
    async (raw: string, attachments: Attachment[] = []) => {
      let text = raw.trim();
      if (!text && attachments.length === 0) return;

      if (text.startsWith("/") && runCommand(text)) return;

      const [head, ...rest] = text.split(/\s+/);
      const args = rest.join(" ");
      const custom = state.commands.find(
        (item) => `/${item.name}` === head.toLowerCase(),
      );
      const expansion = PROMPT_COMMANDS[head.toLowerCase()];
      if (custom) {
        text = custom.template.includes("$ARGUMENTS")
          ? custom.template.replaceAll("$ARGUMENTS", args)
          : args
            ? `${custom.template}\n\n${args}`
            : custom.template;
      } else if (expansion) {
        text = args ? `${expansion}\n\nSpecifically: ${args}` : expansion;
      }

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

      const screen = state.settings.screenAccess ? currentScreen() : null;
      let outgoing = attachments;
      if (screen) {
        const frame = await captureFrame(screen);
        if (frame) {
          outgoing = [
            ...attachments,
            {
              id: uid("att"),
              name: "screen.jpg",
              size: frame.length,
              kind: "image",
              body: frame,
            },
          ];
        }
      }

      if (existing) {
        updateSession(sessionId, (session) => ({
          ...session,
          past: [...(session.past ?? []), session.messages].slice(-20),
          future: [],
        }));
      }

      addMessage(sessionId, {
        id: uid("msg"),
        role: "user",
        parts: text ? [{ id: uid("part"), kind: "text", text }] : [],
        created: Date.now(),
        attachments: outgoing.length ? outgoing : undefined,
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
        title: isNew ? titleFrom(text || outgoing[0]?.name || "Attachment") : session.title,
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

          const images = outgoing
            .filter((file) => file.kind === "image")
            .map((file) => parseImage(file.body))
            .filter((image): image is { mime: string; data: string } => Boolean(image))
            .slice(0, 4);
          const fileText = outgoing
            .filter((file) => file.kind === "text")
            .map((file) => `<file name="${file.name}">\n${file.body.slice(0, 24_000)}\n</file>`)
            .join("\n\n");
          const userTurn = {
            role: "user" as const,
            content: [text, fileText].filter(Boolean).join("\n\n") || "(attachment)",
            ...(images.length ? { images } : {}),
          };
          const history = snapshot ? [...buildHistory(snapshot), userTurn] : [userTurn];

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

        if (state.settings.notifications && !document.hasFocus() && "Notification" in window) {
          if (Notification.permission === "granted") {
            new Notification("Lantas", { body: "The turn finished." });
          }
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
      addMessage,
      createSession,
      patchMessage,
      runCommand,
      state.settings.defaultAgent,
      state.settings.defaultModel,
      state.settings.defaultProvider,
      state.settings.notifications,
      state.settings.providers,
      state.settings.screenAccess,
      state.commands,
      state.skills,
      updateSession,
    ],
  );

  const handleStop = useCallback(() => {
    if (!activeSession) return;
    runs.current[activeSession.id]?.abort();
  }, [activeSession]);

  const changeMode = useCallback(
    (mode: Mode) => {
      setMode(mode);
      if (mode === "chat" && state.view !== "chats") setView("chats");
    },
    [setMode, setView, state.view],
  );

  useEffect(() => {
    if ("__TAURI_INTERNALS__" in window) document.documentElement.dataset.runtime = "tauri";
  }, []);

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

  const title = useMemo(() => {
    if (state.mode === "code") return "Code";
    if (state.view === "skills") return "Skills";
    if (state.view === "integrations") return "Integrations";
    return activeSession?.title ?? "Home";
  }, [state.mode, state.view, activeSession]);

  return (
    <div className="app">
      <TitleBar
        title={title}
        mode={state.mode}
        onModeChange={changeMode}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenSettings={() => openSettings("general")}
      />

      <div className="workspace">
        {state.sidebarOpen && <Sidebar onOpenSettings={() => openSettings("general")} />}

        <main className="main">
          {state.mode === "code" ? (
            <CodeView onOpenFolder={openFolder} />
          ) : (
            <>
              {state.view === "skills" && <SkillsView />}
              {state.view === "integrations" && <IntegrationsView />}
              {state.view === "chats" &&
                (activeSession && activeSession.messages.length > 0 ? (
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
                    onScreenToggle={handleScreenToggle}
                  />
                ) : (
                  <Home
                    onSend={handleSend}
                    onOpenSettings={() => openSettings("providers")}
                    onScreenToggle={handleScreenToggle}
                  />
                ))}
            </>
          )}
        </main>

        {state.panelOpen && (
          <ContextPanel session={activeSession} onOpenSettings={() => openSettings("providers")} />
        )}
      </div>

      {screenStream && (
        <div className="screen-dock">
          <video ref={screenRef} muted playsInline />
          <div className="screen-dock-bar">
            <span className="screen-dock-dot" />
            <span>Screen shared</span>
            <button type="button" className="text-button" onClick={stopScreen}>
              Stop
            </button>
          </div>
        </div>
      )}

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

      {helpOpen && (
        <div className="overlay" onMouseDown={() => setHelpOpen(false)}>
          <div className="help-sheet" onMouseDown={(event) => event.stopPropagation()}>
            <div className="help-head">
              <h2>Commands</h2>
              <button type="button" className="icon-button" onClick={() => setHelpOpen(false)}>
                ✕
              </button>
            </div>
            <div className="help-grid">
              {SLASH_COMMANDS.map((item) => (
                <div className="help-row" key={item.command}>
                  <code>{item.command}</code>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={cx("toast", toast.tone === "error" && "is-error")} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}
