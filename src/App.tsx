import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runAgent, type Emit } from "./lib/agent";
import { runAppAction } from "./lib/appActions";
import { aiDriving } from "./lib/el";
import { getComposio, listConnections } from "./lib/composio";
import { runToolLoop } from "./lib/agentRuntime";
import { defaultRules, describeAction } from "./lib/permissions";
import type { ToolCall, ToolContext } from "./lib/tools";
import { getElContext } from "./lib/el";
import { consumeGoogleHash, getGoogleToken } from "./lib/google";
import { inTauri } from "./lib/native";
import { agentClick, agentEnter, agentScroll, agentType } from "./lib/browserAgent";
import { buildHistory, buildSystemPrompt, parseImage } from "./lib/chat";
import { isConfigured, streamChat } from "./lib/providers";
import { chromeChatReply, chromeChatStatus, chromeStatus } from "./lib/chrome";
import { runBrowserAction, takeAction } from "./lib/chromeChat";
import { useStore } from "./lib/store";
import { acquireScreen, captureFrame, currentScreen, releaseScreen } from "./lib/screen";
import { openWorkspaceFolder, writeWorkspaceFile } from "./lib/workspace";
import type { ChromeEvent } from "./lib/chrome";
import type {
  AgentId,
  Attachment,
  Message,
  Mode,
  Part,
  ProviderId,
  Session,
  WorkspaceFile,
} from "./lib/types";
import { cx, titleFrom, uid } from "./lib/util";
import { BrowserView } from "./components/BrowserView";
import { IdeView } from "./components/IdeView";
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

const THEME_ORDER = ["dark", "light", "system"] as const;

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
    setBrowserUrl,
    setView,
    setWorkspace,
    patchWorkspaceFile,
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
  const [pendingAction, setPendingAction] = useState<{
    message: string;
    apply: () => void;
    sessionId: string;
  } | null>(null);
  const [approval, setApproval] = useState<{
    call: ToolCall;
    resource: string;
    label: string;
  } | null>(null);
  const approvalResolve = useRef<((allowed: boolean) => void) | null>(null);
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

  const settingsRef = useRef(state.settings);
  useEffect(() => {
    settingsRef.current = state.settings;
  }, [state.settings]);

  // The Chrome side panel asks Lantas questions; answers come back over the bridge.
  useEffect(() => {
    if (!inTauri()) return;

    type Turn = Parameters<typeof streamChat>[0]["messages"][number];
    const seen = new Set<string>();
    const history = new Map<string, Turn[]>();

    const answer = async (
      chatId: string,
      prompt: string,
      page: ChromeEvent["page"] | null,
      elements: ChromeEvent["elements"] | null,
    ) => {
      const settings = settingsRef.current;
      const provider = settings.defaultProvider;
      const config = settings.providers[provider];
      const model = settings.defaultModel;

      if (!isConfigured(provider, config)) {
        await chromeChatReply(chatId, "Connect a provider in Settings → Providers, then ask again.");
        return;
      }

      await chromeChatStatus(chatId, "Reading the page");

      const pageBlock = page
        ? `<page url="${page.url}" title="${page.title}">\n${page.text.slice(0, 12000)}\n</page>`
        : "";
      const controlsBlock = elements?.length
        ? `<controls>\n${elements
            .slice(0, 120)
            .map((el) => `${el.i}. [${el.kind}] ${el.label}`)
            .join("\n")}\n</controls>`
        : "";
      const system = [
        "You answer inside the Chrome side panel, next to the tab the user is reading.",
        "Use short, specific sentences. No headings, no emoji, no markdown.",
        "You can act in the open tab: click, type, press a key, select an option, scroll, open a URL, go back, forward or reload.",
        'When the user asks you to act, write one short sentence and then exactly one tag on its own line: <action>{"action":"click","target":"Sign in"}</action>',
        "Prefer the control number from <controls> when it is present: {\"action\":\"click\",\"ref\":12}. Otherwise use the visible label.",
        "Actions: click (ref or target), type (text, optional selector, optional submit), press (key), select (ref/target, value), enter, scroll (dy), open (url, optional newTab), snapshot, extract, back, forward, reload.",
        "Take a snapshot when the controls list is missing or stale. Never claim an action unless it ran; the result is reported to the user.",
      ].join(" ");

      const userTurn: Turn = {
        role: "user",
        content: [prompt, pageBlock, controlsBlock].filter(Boolean).join("\n\n"),
      };
      const turns = [...(history.get(chatId) ?? []).slice(-8), userTurn];

      let reply = "";
      try {
        await streamChat({
          provider,
          config,
          model,
          system,
          messages: turns,
          signal: new AbortController().signal,
          onDelta: (chunk) => {
            reply += chunk;
          },
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message.slice(0, 200) : String(error);
        await chromeChatReply(chatId, `That request failed. ${detail}`);
        return;
      }

      const { text, action } = takeAction(reply);
      let note = "";
      if (action) {
        note = aiDriving()
          ? await runBrowserAction(action)
          : "You paused Lantas, so nothing in the tab was changed.";
      }

      const answerText = text.trim() || (action ? "On it." : "No answer came back.");
      await chromeChatReply(chatId, answerText, note || undefined);
      const assistantTurn: Turn = {
        role: "assistant",
        content: note ? `${answerText}\n[${note}]` : answerText,
      };
      history.set(chatId, [...turns, assistantTurn].slice(-10));
    };

    const tick = async () => {
      const status = await chromeStatus();
      for (const event of status.events) {
        if (event.type !== "chat" || !event.id || seen.has(event.id)) continue;
        seen.add(event.id);
        void answer(event.id, event.text ?? "", event.page ?? null, event.elements ?? null);
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), 800);
    return () => window.clearInterval(timer);
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
      setWorkspace(next.name, next.files, next.root);
      notify(`${next.files.length} files from ${next.name}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not open that folder", "error");
    }
  }, [notify, setWorkspace]);

  /** Resolves a pending tool approval, allowing the loop to continue. */
  const settleApproval = useCallback((allowed: boolean) => {
    approvalResolve.current?.(allowed);
    approvalResolve.current = null;
    setApproval(null);
  }, []);

  const requestApproval = useCallback(
    (call: ToolCall, resource: string) =>
      new Promise<boolean>((resolve) => {
        approvalResolve.current = resolve;
        setApproval({ call, resource, label: describeAction(call.name, resource) });
      }),
    [],
  );

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
        case "/click": {
          const target = raw.slice(6).trim();
          if (!target) {
            notify("Usage: /click <selector or visible text>", "error");
            return true;
          }
          if (!aiDriving()) {
            notify("You have control — the agent is paused", "error");
            return true;
          }
          void agentClick(target).then((ok) =>
            notify(
              ok ? `Clicked “${target}” in the browser` : "Open a page in Lantas Browser or Chrome first",
              ok ? "default" : "error",
            ),
          );
          return true;
        }
        case "/type": {
          const body = raw.slice(5).trim();
          if (!body) {
            notify("Usage: /type <text> into <selector>", "error");
            return true;
          }
          if (!aiDriving()) {
            notify("You have control — the agent is paused", "error");
            return true;
          }
          const split = body.match(/^(.*?)\s+into\s+(\S+)$/i);
          const field = split ? split[1] : body;
          const selector = split ? split[2] : undefined;
          void agentType(field, selector).then((ok) =>
            notify(ok ? "Typed into the page" : "That field was not found", ok ? "default" : "error"),
          );
          return true;
        }
        case "/scroll": {
          if (!aiDriving()) {
            notify("You have control — the agent is paused", "error");
            return true;
          }
          const up = raw.slice(7).trim().toLowerCase() === "up";
          void agentScroll(up ? -600 : 600).then((ok) => {
            if (!ok) notify("Open a page in Lantas Browser or Chrome first", "error");
          });
          return true;
        }
        case "/enter": {
          if (!aiDriving()) {
            notify("You have control — the agent is paused", "error");
            return true;
          }
          void agentEnter().then((ok) => {
            if (!ok) notify("That field was not found", "error");
          });
          return true;
        }
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
      setBrowserUrl,
      setSettings,
      startScreen,
      state.settings.favoriteModels,
      state.settings.providers,
      state.skills,
      setView,
      state.settings.theme,
      togglePanel,
      undo,
      updateSession,
    ],
  );

  useEffect(() => {
    if (inTauri()) document.documentElement.classList.add("tauri");
  }, []);

  useEffect(() => {
    if (consumeGoogleHash()) notify("Gmail connected");
    const onPrompt = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string }>).detail;
      if (!detail?.text) return;
      setMode("chat");
      setView("chats");
      void handleSendRef.current(detail.text);
    };
    const onAsk = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string }>).detail;
      if (!detail?.text) return;
      void handleSendRef.current(detail.text);
    };
    const onGmail = () => {
      setMode("chat");
      setView("integrations");
      notify("Connect Gmail or Composio in Integrations");
    };
    window.addEventListener("lantas:prompt", onPrompt);
    window.addEventListener("lantas:ask", onAsk);
    window.addEventListener("lantas:gmail", onGmail);
    return () => {
      window.removeEventListener("lantas:prompt", onPrompt);
      window.removeEventListener("lantas:ask", onAsk);
      window.removeEventListener("lantas:gmail", onGmail);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSendRef = useRef<(text: string) => Promise<void>>(async () => {});
  const handleSend = useCallback(
    async (raw: string, attachments: Attachment[] = []) => {
      let text = raw.trim();
      if (!text && attachments.length === 0) return;

      const existing = activeSession;
      if (existing?.messages.some((message) => message.streaming)) return;

      if (text.startsWith("/") && runCommand(text)) return;

      const [head, ...rest] = text.split(/\s+/);
      let args = rest.join(" ");
      let skill = state.skills.find((item) => `/${item.name}` === head.toLowerCase());
      if (!skill && head.toLowerCase() === "/skill" && rest.length > 0) {
        const [skillName, ...task] = rest;
        skill = state.skills.find(
          (item) => item.name.toLowerCase() === skillName.toLowerCase(),
        );
        if (skill) args = task.join(" ");
      }
      const custom = state.commands.find(
        (item) => `/${item.name}` === head.toLowerCase(),
      );
      const expansion = PROMPT_COMMANDS[head.toLowerCase()];
      const action =
        !text.startsWith("/") && !skill
          ? runAppAction(text, {
              theme: state.settings.theme,
              providers: PROVIDERS.map((meta) => ({
                id: meta.id,
                name: meta.name,
                models: Array.from(
                  new Set([...state.settings.providers[meta.id].models, ...meta.models]),
                ),
              })),
              models: Array.from(
                new Set(
                  PROVIDERS.flatMap((meta) => [
                    ...state.settings.providers[meta.id].models,
                    ...meta.models,
                  ]),
                ),
              ),
              setTheme: (theme) => setSettings({ theme }),
              setMode: (mode) => setMode(mode),
              setView: (view) => setView(view),
              setBrowserUrl: (url) => {
                setBrowserUrl(url);
                setMode("browser");
              },
              openSettings: (tab) => openSettings(tab),
              setDefaultAgent: (agent) => setSettings({ defaultAgent: agent }),
              setModel: (targetProvider, targetModel) => {
                setSettings({ defaultProvider: targetProvider, defaultModel: targetModel });
                if (existing) {
                  updateSession(existing.id, (session) => ({
                    ...session,
                    provider: targetProvider,
                    model: targetModel,
                  }));
                }
              },
              toggleFavorite: (favoriteModel) => {
                const owner = PROVIDERS.find((meta) =>
                  Array.from(
                    new Set([...state.settings.providers[meta.id].models, ...meta.models]),
                  ).includes(favoriteModel),
                );
                if (!owner) return;
                const key = `${owner.id}/${favoriteModel}`;
                const favorites = state.settings.favoriteModels;
                setSettings({
                  favoriteModels: favorites.includes(key)
                    ? favorites.filter((entry) => entry !== key)
                    : [...favorites, key],
                });
              },
              setFlag: (flag, value) => setSettings({ [flag]: value } as never),
            })
          : null;

      if (action) {
        const sessionId = existing ? existing.id : createSession();
        addMessage(sessionId, {
          id: uid("msg"),
          role: "user",
          parts: [{ id: uid("part"), kind: "text", text }],
          created: Date.now(),
        });
        addMessage(sessionId, {
          id: uid("msg"),
          role: "assistant",
          parts: [
            {
              id: uid("part"),
              kind: "note",
              text: `I can ${action.message.charAt(0).toLowerCase()}${action.message.slice(1)} Nothing changes until you approve it.`,
            },
          ],
          created: Date.now(),
        });
        setPendingAction({ message: action.message, apply: action.apply, sessionId });
        return;
      }

      if (skill) {
        text = `${skill.instructions}\n\n${args ? `Task: ${args}` : "Apply this skill to the current workspace."}`;
      } else if (custom) {
        text = custom.template.includes("$ARGUMENTS")
          ? custom.template.replaceAll("$ARGUMENTS", args)
          : args
            ? `${custom.template}\n\n${args}`
            : custom.template;
      } else if (expansion) {
        text = args ? `${expansion}\n\nSpecifically: ${args}` : expansion;
      }

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
          const page = getElContext();
          const wantsPage =
            Boolean(page) &&
            (state.mode === "browser" ||
              /this page|the page|article|website|site|el\b/i.test(text));
          const pageText =
            wantsPage && page
              ? `<el_page url="${page.url}" title="${page.title}">\n${page.text.slice(0, 12_000)}\n</el_page>`
              : "";
          const asksAboutAccess =
            /access|connect|integrat|composio|gmail|slack|notion|inbox|email|e-mail|mail/i.test(
              text,
            );
          let connectionsText = "";
          if (asksAboutAccess) {
            const lines = [
              `gmail: ${getGoogleToken() ? "connected, read-only inbox access" : "not connected"}`,
            ];
            const composio = getComposio();
            lines.push(`composio_key: ${composio ? "saved on this Mac" : "not saved"}`);
            if (composio) {
              try {
                const accounts = await listConnections();
                const active = accounts
                  .filter((item) => item.status === "ACTIVE")
                  .map((item) => item.toolkit);
                lines.push(`composio_accounts: ${active.join(", ") || "none"}`);
              } catch {
                lines.push("composio_accounts: could not be listed just now");
              }
            }
            connectionsText = `<connections>\n${lines.join("\n")}\n</connections>`;
          }

          // Mail is read on demand through the integrations tool, with
          // pagination. Dumping a truncated inbox here made the assistant
          // believe the mailbox only held six messages.
          const userTurn = {
            role: "user" as const,
            content:
              [text, fileText, pageText, connectionsText].filter(Boolean).join("\n\n") ||
              "(attachment)",
            ...(images.length ? { images } : {}),
          };
          const history = snapshot ? [...buildHistory(snapshot), userTurn] : [userTurn];

          const system = snapshot
            ? buildSystemPrompt(snapshot, state.skills)
            : buildSystemPrompt(
                { cwd: "~/dev/lantas", branch: "main", agent } as Session,
                state.skills,
              );

          const toolFiles: WorkspaceFile[] = [...state.workspace];
          const toolCtx: ToolContext = {
            files: toolFiles,
            root: state.workspaceRoot,
            agent,
            skills: state.skills,
            saveFile: async (path, content) => {
              const index = toolFiles.findIndex((file) => file.path === path);
              const entry: WorkspaceFile = {
                id: index >= 0 ? toolFiles[index].id : path,
                name: path.split("/").pop() ?? path,
                path,
                size: content.length,
                text: content,
                added: Date.now(),
              };
              if (index >= 0) toolFiles[index] = entry;
              else toolFiles.push(entry);
              patchWorkspaceFile(path, content);
              try {
                return await writeWorkspaceFile(state.workspaceRoot, path, content);
              } catch {
                return false;
              }
            },
          };

          const toolKind = (name: string): "read" | "grep" | "edit" | "web" | "plan" => {
            if (name === "read") return "read";
            if (name === "grep" || name === "glob") return "grep";
            if (name === "edit" || name === "write") return "edit";
            if (name === "browser" || name === "integrations") return "web";
            return "plan";
          };

          const appendText = (chunk: string) => {
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
          };

          await runToolLoop({
            provider,
            config: providerConfig,
            model,
            system,
            messages: history,
            ctx: toolCtx,
            rules: defaultRules(state.settings.permissionMode, agent === "build"),
            signal: controller.signal,
            approve: (call, resource) => requestApproval(call, resource),
            onText: appendText,
            onToolStart: (id, call, label) =>
              patch((message) => ({
                ...message,
                parts: [
                  ...message.parts,
                  {
                    id,
                    kind: "tool",
                    tool: toolKind(call.name),
                    label,
                    state: "run",
                  },
                ],
              })),
            onToolDone: (id, outcome, stateOfTool) =>
              patch((message) => ({
                ...message,
                parts: message.parts.flatMap((part): Part[] => {
                  if (part.id !== id || part.kind !== "tool") return [part];
                  const next: Part = {
                    ...part,
                    detail: outcome.summary,
                    state: stateOfTool,
                  };
                  if (!outcome.diff) return [next];
                  return [
                    next,
                    {
                      id: uid("part"),
                      kind: "diff",
                      path: outcome.diff.path,
                      added: outcome.diff.added,
                      removed: outcome.diff.removed,
                      lines: outcome.diff.lines,
                    },
                  ];
                }),
              })),
            onNote: (note) =>
              patch((message) => ({
                ...message,
                parts: [...message.parts, { id: uid("part"), kind: "note", text: note }],
              })),
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
      state.settings.permissionMode,
      state.commands,
      state.skills,
      state.workspace,
      state.workspaceRoot,
      patchWorkspaceFile,
      requestApproval,
      updateSession,
    ],
  );

  useEffect(() => {
    handleSendRef.current = handleSend;
  }, [handleSend]);

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
    if (state.mode === "browser") return "Lantas Browser";
    if (state.mode === "code") return "Code";
    if (state.view === "skills") return "Skills";
    if (state.view === "integrations") return "Integrations";
    return activeSession?.title ?? "Home";
  }, [state.mode, state.view, activeSession]);

  return (
    <div className="app">
      {state.mode === "code" ? (
        <IdeView
          onExit={() => changeMode("chat")}
          onOpenFolder={() => void openFolder()}
          onOpenSettings={() => openSettings("general")}
          onOpenSkills={() => {
            setMode("chat");
            setView("skills");
          }}
          onAsk={(text) => void handleSend(text)}
          session={activeSession}
          streaming={streaming}
        />
      ) : (
        <>
          <TitleBar
            title={title}
            mode={state.mode}
            onModeChange={changeMode}
            onOpenPalette={() => setPaletteOpen(true)}
            onOpenSettings={() => openSettings("general")}
          />

          <div className="workspace">
            <Sidebar
              onOpenSettings={() => openSettings("general")}
              historyCollapsed={!state.sidebarOpen}
            />

            <main className="main">
              <div
                className={`browser-holder${state.mode === "browser" ? "" : " is-hidden"}`}
                aria-hidden={state.mode !== "browser"}
              >
                <BrowserView visible={state.mode === "browser"} />
              </div>

              {state.mode === "chat" && (
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
              <ContextPanel
                session={activeSession}
                onOpenSettings={() => openSettings("providers")}
              />
            )}
          </div>
        </>
      )}

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

      {pendingAction && (
        <div className="overlay" onMouseDown={() => setPendingAction(null)}>
          <div
            className="confirm-card"
            role="dialog"
            aria-modal="true"
            aria-label="Confirm change"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <p className="confirm-kicker">Needs your approval</p>
            <h2>{pendingAction.message}</h2>
            <p className="confirm-copy">Nothing changes until you allow it.</p>
            <div className="confirm-actions">
              <button
                type="button"
                className="button-quiet"
                onClick={() => {
                  const target = pendingAction.sessionId;
                  addMessage(target, {
                    id: uid("msg"),
                    role: "assistant",
                    parts: [{ id: uid("part"), kind: "note", text: "Cancelled — nothing changed." }],
                    created: Date.now(),
                  });
                  setPendingAction(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button-primary"
                onClick={() => {
                  const target = pendingAction.sessionId;
                  pendingAction.apply();
                  addMessage(target, {
                    id: uid("msg"),
                    role: "assistant",
                    parts: [{ id: uid("part"), kind: "note", text: "Done." }],
                    created: Date.now(),
                  });
                  notify(pendingAction.message);
                  setPendingAction(null);
                }}
              >
                Allow
              </button>
            </div>
          </div>
        </div>
      )}

      {approval && (
        <div className="overlay" onMouseDown={() => settleApproval(false)}>
          <div
            className="confirm-card tool-approval"
            role="dialog"
            aria-modal="true"
            aria-label="Tool approval"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <p className="confirm-kicker">Lantas wants to act</p>
            <h2>{approval.label}</h2>
            <pre className="tool-approval-args">
              {JSON.stringify(approval.call.args, null, 2).slice(0, 1400)}
            </pre>
            <div className="confirm-actions">
              <button type="button" className="button-quiet" onClick={() => settleApproval(false)}>
                Decline
              </button>
              <button type="button" className="button-primary" onClick={() => settleApproval(true)}>
                Allow once
              </button>
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
