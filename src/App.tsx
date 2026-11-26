import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runAppAction } from "./lib/appActions";
import { aiDriving } from "./lib/el";
import { getComposio, listConnections } from "./lib/composio";
import { runToolLoop } from "./lib/agentRuntime";
import { defaultRules, describeAction } from "./lib/permissions";
import type { ToolCall, ToolContext } from "./lib/tools";
import { getElContext } from "./lib/el";
import { consumeGoogleHash, getGoogleToken } from "./lib/google";
import { inTauri } from "./lib/native";
import { openCliInTerminal } from "./lib/terminal";
import { agentClick, agentEnter, agentScroll, agentType } from "./lib/browserAgent";
import {
  buildBrowserSystemPrompt,
  buildHistory,
  buildRunningSummary,
  buildSystemPrompt,
  parseImage,
} from "./lib/chat";
import { isConfigured } from "./lib/providers";
import type { ChatTurn } from "./lib/providers";
import {
  chromeChatReply,
  chromeChatStatus,
  chromeSendRaw,
  chromeStatus,
  type ChromeCatalogProvider,
} from "./lib/chrome";
import { runBrowserTurn } from "./lib/browserTurn";
import {
  beginBrowserActivity,
  dismissBrowserActivity,
  finishBrowserActivity,
  updateBrowserActivity,
} from "./lib/browserActivity";
import { useStore } from "./lib/store";
import {
  acquireScreen,
  captureFrame,
  captureNativeScreen,
  currentScreen,
  releaseScreen,
} from "./lib/screen";
import {
  addWorkspaceFolder,
  clearExtraWorkspaceFolders,
  openWorkspaceFolder,
  readWorkspacePath,
  readWorkspaceWithExtras,
  watchWorkspaceTree,
  writeWorkspacePath,
} from "./lib/workspace";
import { looksLikePath } from "./lib/paths";
import { gitStatus } from "./lib/git";
import { recordAudit } from "./lib/audit";
import { askUser } from "./lib/userAsk";
import type { ChromeEvent } from "./lib/chrome";
import type {
  AgentId,
  Attachment,
  Message,
  Mode,
  Part,
  ProviderId,
  Session,
  Settings,
  WorkspaceFile,
} from "./lib/types";
import { cx, titleFrom, uid } from "./lib/util";
import { BrowserView } from "./components/BrowserView";
import { BrowserActivityDock } from "./components/BrowserActivityDock";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { IdeView } from "./components/IdeView";
import { setEngineModel } from "./lib/browserSidecar";
import { CommandPalette } from "./components/CommandPalette";
import { CompareView } from "./components/CompareView";
import { ContextPanel } from "./components/ContextPanel";
import { Home } from "./components/Home";
import { IntegrationsView } from "./components/IntegrationsView";
import { SessionView } from "./components/SessionView";
import { PermissionsSheet } from "./components/PermissionsSheet";
import { SettingsModal, type SettingsTab } from "./components/SettingsModal";
import { Sidebar } from "./components/Sidebar";
import { SkillsView } from "./components/SkillsView";
import { TitleBar } from "./components/TitleBar";
import { PROVIDERS, SLASH_COMMANDS } from "./lib/data";

const THEME_ORDER = ["dark", "light", "system"] as const;

/** Only configured providers are offered to the Chrome panel; the rest are shown as disconnected. */
function chromeCatalog(settings: Settings): ChromeCatalogProvider[] {
  return PROVIDERS.map((meta) => {
    const config = settings.providers[meta.id];
    return {
      id: meta.id,
      name: meta.name,
      configured: isConfigured(meta.id, config),
      models: Array.from(new Set([...config.models, ...meta.models])).filter(Boolean),
    };
  });
}

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
    stageChange,
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
  const [fileRequest, setFileRequest] = useState<{
    path: string;
    line?: number;
    nonce: number;
  } | null>(null);
  const [cliRequest, setCliRequest] = useState(0);
  const [compareOpen, setCompareOpen] = useState(false);
  const compareSeed = useMemo(() => {
    const lastUser = activeSession?.messages.filter((message) => message.role === "user").at(-1);
    const text = lastUser?.parts.find((part) => part.kind === "text");
    return text && text.kind === "text" ? text.text.slice(0, 4_000) : "";
  }, [activeSession]);
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
  const [limitAsk, setLimitAsk] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const limitResolve = useRef<((more: boolean) => void) | null>(null);
  /** The last time the user approved extra rounds, so the prompt is not spam. */
  const lastLimitGrant = useRef(0);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const runs = useRef<Record<string, AbortController>>({});
  const screenRef = useRef<HTMLVideoElement | null>(null);

  const streaming = Boolean(activeSession?.messages.at(-1)?.streaming);

  const openSettings = useCallback((tab: SettingsTab = "general") => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }, []);

  // Ask once, before a capability is used, instead of assuming consent.
  useEffect(() => {
    if (!state.settings.permissionsReviewed) setPermissionsOpen(true);
  }, [state.settings.permissionsReviewed]);

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

  // Reopen the project from the last session. Only the path is persisted, so
  // the tree is always read fresh from disk.
  // The watcher callback is long-lived; read the latest files through a ref so
  // it can tell an external edit from the agent's own write.
  const workspaceRef = useRef(state.workspace);
  workspaceRef.current = state.workspace;
  const restoredRoot = useRef("");
  useEffect(() => {
    if (!inTauri() || !state.workspaceRoot || state.workspace.length > 0) return;
    if (restoredRoot.current === state.workspaceRoot) return;
    restoredRoot.current = state.workspaceRoot;
    void readWorkspaceWithExtras(state.workspaceRoot)
      .then((next) => {
        if (next) setWorkspace(next.name, next.files, next.root);
        else notify(`Could not reopen ${state.workspaceRoot}`, "error");
      })
      .catch((error) =>
        notify(
          `Could not reopen ${state.workspaceRoot}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          "error",
        ),
      );
  }, [notify, setWorkspace, state.workspace.length, state.workspaceRoot]);

  // External edits (VS Code, git checkout) would otherwise leave the agent
  // reading a stale copy of the file.
  useEffect(() => {
    if (!inTauri() || !state.workspaceRoot) return;
    let alive = true;
    let unwatch: (() => void) | null = null;
    void watchWorkspaceTree(state.workspaceRoot, (path, text) => {
      const current = workspaceRef.current.find((file) => file.path === path);
      if (current?.text === text) return;
      patchWorkspaceFile(path, text);
      notify(`File changed on disk: ${path}`);
    })
      .then((stop) => {
        if (alive) unwatch = stop;
        else stop();
      })
      .catch((error) => {
        if (alive) {
          notify(
            `Could not watch the workspace: ${
              error instanceof Error ? error.message : String(error)
            }`,
            "error",
          );
        }
      });
    return () => {
      alive = false;
      unwatch?.();
    };
  }, [notify, patchWorkspaceFile, state.workspace.length, state.workspaceRoot]);

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

  // Push the model catalog to the Chrome side panel. The panel asks for it on
  // open; the timer covers a panel that opens while the list is changing.
  useEffect(() => {
    if (!inTauri()) return;
    const publish = () => {
      void chromeSendRaw({
        type: "catalog",
        catalog: chromeCatalog(settingsRef.current),
      });
    };
    publish();
    const timer = window.setInterval(publish, 15_000);
    return () => window.clearInterval(timer);
  }, [state.settings.providers, state.settings.defaultProvider, state.settings.defaultModel]);

  // The Chrome side panel runs a real browser tool loop, like the coding agent.
  useEffect(() => {
    if (!inTauri()) return;

    const seen = new Set<string>();
    const histories = new Map<string, ChatTurn[]>();
    let lastCatalogPush = 0;

    const publishCatalog = () => {
      void chromeSendRaw({
        type: "catalog",
        catalog: chromeCatalog(settingsRef.current),
      });
    };

    const answer = async (
      chatId: string,
      prompt: string,
      page: Parameters<typeof runBrowserTurn>[0]["page"],
      elements: Parameters<typeof runBrowserTurn>[0]["elements"],
      providerId: string,
      modelId: string,
      mode: "ask" | "act",
    ) => {
      const settings = settingsRef.current;
      const requested = PROVIDERS.find((item) => item.id === providerId);
      const configured = requested
        ? isConfigured(requested.id, settings.providers[requested.id])
        : false;
      const provider = configured && requested ? requested.id : settings.defaultProvider;
      const config = settings.providers[provider];
      const model =
        configured && requested && modelId ? modelId : settings.defaultModel;

      if (!isConfigured(provider, config)) {
        await chromeChatReply(
          chatId,
          "Connect a provider in Lantas → Settings → Providers, then ask again.",
        );
        return;
      }

      await chromeChatStatus(
        chatId,
        mode === "act" ? "Reading this tab" : "Reading this tab, staying read-only",
      );

      const controller = new AbortController();
      const result = await runBrowserTurn({
        provider,
        config,
        model,
        prompt,
        page,
        elements,
        mode,
        history: histories.get(chatId) ?? [],
        signal: controller.signal,
        onStatus: (text) => {
          void chromeChatStatus(chatId, text);
        },
      });

      if (result.error) {
        await chromeChatReply(chatId, `That request failed. ${result.error.slice(0, 240)}`);
        return;
      }

      histories.set(chatId, result.history);
      const note =
        mode === "act" && result.tools > 0
          ? `${result.tools} browser step${result.tools === 1 ? "" : "s"} in this tab`
          : undefined;
      const text =
        result.text || (result.tools > 0 ? "Done. Nothing else was needed." : "No answer came back.");
      await chromeChatReply(chatId, text, note);
    };

    const tick = async () => {
      const status = await chromeStatus();
      for (const event of status.events) {
        if (event.type === "catalog_request") {
          if (Date.now() - lastCatalogPush < 2500) continue;
          lastCatalogPush = Date.now();
          publishCatalog();
          continue;
        }
        if (event.type !== "chat" || !event.id || seen.has(event.id)) continue;
        seen.add(event.id);
        publishCatalog();
        void answer(
          event.id,
          event.text ?? "",
          event.page ?? null,
          event.elements ?? null,
          String(event.provider ?? ""),
          String(event.model ?? ""),
          event.mode === "ask" ? "ask" : "act",
        );
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), 800);
    return () => window.clearInterval(timer);
  }, []);

  const startScreen = useCallback(async () => {
    // A desktop window has no getDisplayMedia, so it captures natively instead
    // of asking for a screen-share picker that can never appear.
    if (inTauri()) {
      try {
        const frame = await captureNativeScreen();
        if (!frame) throw new Error("The screen capture came back empty.");
        setSettings({ screenAccess: true });
        notify("Screen access on — every turn includes a fresh frame");
      } catch (error) {
        setSettings({ screenAccess: false });
        notify(error instanceof Error ? error.message : "Screen capture failed", "error");
      }
      return;
    }
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
    // Native capture has no stream to inspect, so the setting is the truth.
    if (state.settings.screenAccess) stopScreen();
    else void startScreen();
  }, [startScreen, state.settings.screenAccess, stopScreen]);

  const openFolder = useCallback(async () => {
    try {
      const next = await openWorkspaceFolder();
      if (!next) return;
      clearExtraWorkspaceFolders();
      setWorkspace(next.name, next.files, next.root);
      // Choosing a folder is explicit consent to read it, even if the sheet was
      // skipped earlier.
      setSettings({ fileAccess: true });
      notify(`${next.files.filter((file) => !file.dir).length} files from ${next.name}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not open that folder", "error");
    }
  }, [notify, setSettings, setWorkspace]);

  const addFolder = useCallback(async () => {
    if (!state.workspaceRoot) {
      await openFolder();
      return;
    }
    try {
      const next = await addWorkspaceFolder(state.workspace);
      if (!next) return;
      setWorkspace(
        `${state.workspaceName || "Workspace"} + ${next.name}`,
        [...state.workspace, ...next.files],
        state.workspaceRoot,
      );
      notify(`Added ${next.name} (${next.files.filter((file) => !file.dir).length} files)`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not add that folder", "error");
    }
  }, [notify, openFolder, setWorkspace, state.workspace, state.workspaceName, state.workspaceRoot]);

  /** Resolves a pending tool approval, allowing the loop to continue. */
  const settleApproval = useCallback((allowed: boolean) => {
    approvalResolve.current?.(allowed);
    approvalResolve.current = null;
    setApproval(null);
  }, []);

  const requestMoreSteps = useCallback(() => {
    // Once the user says Continue, later six-round boundaries in the same
    // three-minute window keep going without showing the same dialog again.
    // A refusal is never remembered: the next run asks normally.
    if (Date.now() - lastLimitGrant.current < 3 * 60_000) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      limitResolve.current = resolve;
      setLimitAsk(true);
    });
  }, []);

  const settleLimit = useCallback((more: boolean) => {
    if (more) lastLimitGrant.current = Date.now();
    limitResolve.current?.(more);
    limitResolve.current = null;
    setLimitAsk(false);
  }, []);

  const requestApproval = useCallback(
    (call: ToolCall, resource: string) =>
      new Promise<boolean>((resolve) => {
        approvalResolve.current = (allowed) => {
          recordAudit({
            tool: call.name,
            resource,
            decision: allowed ? "allowed" : "denied",
          });
          resolve(allowed);
        };
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
    // Side panels send the same shape as the main composer: text plus any
    // files or images the user attached there.
    const onPrompt = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string; attachments?: Attachment[] }>).detail;
      if (!detail?.text && !detail?.attachments?.length) return;
      setMode("chat");
      setView("chats");
      void handleSendRef.current(detail?.text ?? "", detail?.attachments ?? []);
    };
    const onAsk = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string; attachments?: Attachment[] }>).detail;
      if (!detail?.text && !detail?.attachments?.length) return;
      void handleSendRef.current(detail?.text ?? "", detail?.attachments ?? []);
    };
    const onGmail = () => {
      setMode("chat");
      setView("integrations");
      notify("Connect Gmail or Composio in Integrations");
    };
    const onSettings = (event: Event) => {
      const detail = (event as CustomEvent<{ tab?: SettingsTab }>).detail;
      openSettings(detail?.tab ?? "general");
    };
    window.addEventListener("lantas:prompt", onPrompt);
    window.addEventListener("lantas:ask", onAsk);
    window.addEventListener("lantas:gmail", onGmail);
    window.addEventListener("lantas:settings", onSettings);
    return () => {
      window.removeEventListener("lantas:prompt", onPrompt);
      window.removeEventListener("lantas:ask", onAsk);
      window.removeEventListener("lantas:gmail", onGmail);
      window.removeEventListener("lantas:settings", onSettings);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A browser call can begin while the user is in Code, where BrowserView is
  // unmounted. Switch to the Browser tab and carry the address with it so the
  // page the agent is about to open is visible instead of orphaned.
  useEffect(() => {
    const onAgentNavigate = (event: Event) => {
      const url = (event as CustomEvent<{ url?: string }>).detail?.url;
      // Chat and Browser keep BrowserView mounted; only Code unmounts it.
      // Switching there is what makes an agent-opened page visible again.
      if (!url || state.mode !== "code") return;
      setBrowserUrl(url);
      setMode("browser");
    };
    window.addEventListener("lantas:navigate", onAgentNavigate);
    return () => window.removeEventListener("lantas:navigate", onAgentNavigate);
  }, [state.mode, setBrowserUrl, setMode]);

  const handleSendRef = useRef<(text: string, attachments?: Attachment[]) => Promise<void>>(
    async () => {},
  );
  const handleSend = useCallback(
    async (
      raw: string,
      attachments: Attachment[] = [],
      options: { agent?: AgentId } = {},
    ) => {
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
        // Theme, model, agent and the quiet toggles are one keystroke to undo,
        // so asking twice for them is friction. A permission grant still asks.
        if (action.immediate) {
          action.apply();
          addMessage(sessionId, {
            id: uid("msg"),
            role: "assistant",
            parts: [
              {
                id: uid("part"),
                kind: "note",
                text: `Done — ${action.message.charAt(0).toLowerCase()}${action.message.slice(1)}`,
              },
            ],
            created: Date.now(),
          });
          notify(action.message);
          return;
        }
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
      // The Code assistant answers with edits, so its turns run as Build even
      // when the thread was started in Chat or Plan; otherwise every write is
      // denied and the model falls back to pasting the file into the reply.
      const agent = options.agent ?? existing?.agent ?? state.settings.defaultAgent;
      const provider = existing?.provider ?? state.settings.defaultProvider;
      const model = existing?.model || state.settings.defaultModel;
      const providerConfig = state.settings.providers[provider];
      const live = isConfigured(provider, providerConfig);
      const snapshot: Session | null = existing ?? null;
      const assistantId = uid("msg");
      const isNew = !existing || existing.messages.length === 0;

      const screen = state.settings.screenAccess ? currentScreen() : null;
      let outgoing = attachments;
      let frame = screen ? await captureFrame(screen) : null;
      if (!frame && !screen && state.settings.screenAccess && inTauri()) {
        try {
          frame = await captureNativeScreen();
        } catch (error) {
          setSettings({ screenAccess: false });
          notify(error instanceof Error ? error.message : "Screen capture failed", "error");
        }
      }
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

      // Thinking arrives on its own provider channel. Keep it in one collapsed
      // part per stretch so it never crowds the answer or looks like output.
      let reasoningPartId: string | null = null;
      let reasoningStartedAt = 0;
      const closeReasoning = () => {
        if (!reasoningPartId) return;
        const id = reasoningPartId;
        const durationMs = reasoningStartedAt ? Date.now() - reasoningStartedAt : undefined;
        reasoningPartId = null;
        reasoningStartedAt = 0;
        patch((message) => ({
          ...message,
          parts: message.parts.map((part) =>
            part.id === id && part.kind === "reasoning"
              ? { ...part, state: "done" as const, durationMs }
              : part,
          ),
        }));
      };
      const appendReasoning = (chunk: string) => {
        if (!chunk) return;
        if (!reasoningPartId) {
          const id = uid("part");
          reasoningPartId = id;
          reasoningStartedAt = Date.now();
          patch((message) => ({
            ...message,
            parts: [
              ...message.parts,
              { id, kind: "reasoning", text: chunk, state: "run" as const },
            ],
          }));
          return;
        }
        const id = reasoningPartId;
        patch((message) => ({
          ...message,
          parts: message.parts.map((part) =>
            part.id === id && part.kind === "reasoning"
              ? { ...part, text: part.text + chunk }
              : part,
          ),
        }));
      };

      try {
        if (live) {
          let textPartId: string | null = null;
          let inputTokens = 0;
          let outputTokens = 0;
          let browserStarted = false;
          let browserToolRan = false;
          const browserToolIds = new Set<string>();

          const images = outgoing
            .filter((file) => file.kind === "image")
            .map((file) => parseImage(file.body))
            .filter((image): image is { mime: string; data: string } => Boolean(image))
            .slice(0, 4);
          const fileText = outgoing
            .filter((file) => file.kind === "text")
            .map((file) => `<file name="${file.name}">\n${file.body.slice(0, 24_000)}\n</file>`)
            .join("\n\n");
          // Cursor-style @ mentions put the file itself in the turn, not just
          // its name. The agent can still read more with its tools.
          const mentioned = Array.from(text.matchAll(/@([\w./-]+)/g))
            .map((match) => match[1])
            .filter((path, index, all) => all.indexOf(path) === index)
            .map((path) =>
              state.workspace.find(
                (file) => !file.dir && !file.binary && file.path === path,
              ),
            )
            .filter((file): file is WorkspaceFile => Boolean(file))
            .slice(0, 5);
          const mentionText = mentioned
            .map(
              (file) =>
                `<file name="${file.path}">\n${file.text.slice(0, 24_000)}\n</file>`,
            )
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
              [text, fileText, mentionText, pageText, connectionsText]
                .filter(Boolean)
                .join("\n\n") || "(attachment)",
            ...(images.length ? { images } : {}),
          };
          const history = snapshot ? [...buildHistory(snapshot), userTurn] : [userTurn];

          let gitContext = "";
          if (inTauri() && state.workspaceRoot) {
            try {
              const status = await gitStatus(state.workspaceRoot);
              if (status.repo) {
                const changes = status.files
                  .slice(0, 20)
                  .map((file) => `${file.staged ? "staged" : "unstaged"} ${file.status} ${file.path}`);
                const commits = status.commits
                  .slice(0, 5)
                  .map((commit) => `${commit.hash.slice(0, 7)} ${commit.subject}`);
                gitContext = [
                  `branch: ${status.branch}${status.upstream ? ` -> ${status.upstream}` : ""}`,
                  status.ahead || status.behind
                    ? `ahead ${status.ahead}, behind ${status.behind}`
                    : "",
                  changes.length ? `changed files:\n${changes.join("\n")}` : "working tree clean",
                  commits.length ? `recent commits:\n${commits.join("\n")}` : "",
                ]
                  .filter(Boolean)
                  .join("\n");
              }
            } catch (error) {
              gitContext = `git status unavailable: ${
                error instanceof Error ? error.message : String(error)
              }`;
            }
          }

          const runningSummary = snapshot ? buildRunningSummary(snapshot) : "";
          const browserMode = state.mode === "browser";
          const system = browserMode
            ? buildBrowserSystemPrompt(
                snapshot ?? ({ cwd: "~/dev/lantas", branch: "main", agent } as Session),
                page,
              )
            : snapshot
              ? buildSystemPrompt(
                  { ...snapshot, agent },
                  state.skills,
                  state.workspace,
                  gitContext,
                  runningSummary,
                  Boolean(state.workspaceRoot),
                )
              : buildSystemPrompt(
                  { cwd: "~/dev/lantas", branch: "main", agent } as Session,
                  state.skills,
                  state.workspace,
                  gitContext,
                  "",
                  Boolean(state.workspaceRoot),
                );

          const toolFiles: WorkspaceFile[] = [...state.workspace];
          const shellPart = { current: null as string | null };
          const toolCtx: ToolContext = {
            files: toolFiles,
            root: state.workspaceRoot,
            agent,
            skills: state.skills,
            task: text,
            // Only Browser mounts the reply bubble. Elsewhere the tool returns
            // its "ask in the answer instead" message rather than hanging.
            askUser:
              state.mode === "browser"
                ? (question, kind) => askUser({ question, kind }, controller.signal)
                : undefined,
            settings: {
              theme: state.settings.theme,
              reduceMotion: state.settings.reduceMotion,
              notifications: state.settings.notifications,
              sendOnEnter: state.settings.sendOnEnter,
              defaultAgent: state.settings.defaultAgent,
              provider,
              model,
            },
            updateSettings: (patch) => setSettings(patch as never),
            openSettings: (tab) => openSettings(tab as never),
            grants: {
              files: state.settings.fileAccess,
              terminal: state.settings.terminalAccess,
              control: state.settings.computerControl,
            },
            readFile: async (path) =>
              state.mode === "code"
                ? null
                : readWorkspacePath(state.workspaceRoot, path),
            onShellLine: (line) => {
              const partId = shellPart.current;
              if (!partId) return;
              patch((message) => ({
                ...message,
                parts: message.parts.map((part) =>
                  part.id === partId && part.kind === "shell"
                    ? { ...part, output: [...part.output, line].slice(-240) }
                    : part,
                ),
              }));
            },
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
              // In the IDE an assistant edit is a proposal until the user keeps
              // it, matching the review step in Cursor. Chat mode applies it.
              if (state.mode === "code") {
                stageChange(path, content);
                patchWorkspaceFile(path, content);
                return true;
              }
              patchWorkspaceFile(path, content);
              try {
                return await writeWorkspacePath(state.workspaceRoot, path, content);
              } catch (error) {
                notify(
                  `Could not write ${path}: ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                  "error",
                );
                return false;
              }
            },
          };

          const toolKind = (name: string): "read" | "grep" | "edit" | "terminal" | "web" | "plan" => {
            if (name === "read") return "read";
            if (name === "grep" || name === "glob" || name === "semantic_search") return "grep";
            if (name === "edit" || name === "write") return "edit";
            if (name === "terminal") return "terminal";
            if (name === "browser" || name === "integrations") return "web";
            return "plan";
          };

          const appendText = (chunk: string) => {
            closeReasoning();
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

          // The local browser engine runs browser-use with this session's own
          // provider and key, so a delegated browsing task needs no extra setup.
          setEngineModel({ provider, model, config: providerConfig });

          await runToolLoop({
            provider,
            config: providerConfig,
            model,
            system,
            messages: history,
            ctx: toolCtx,
            rules: browserMode
              ? [
                  ...defaultRules(state.settings.permissionMode, agent === "build"),
                  // The browser panel has its own Ask/Act switch. Respect it
                  // instead of the coding agent's read-only rules, so Act in a
                  // Chat thread can still click and type.
                  {
                    tool: "browser",
                    pattern: "*",
                    effect: aiDriving() ? "allow" : "deny",
                  },
                  { tool: "browser", pattern: "snapshot", effect: "allow" },
                  { tool: "browser", pattern: "extract", effect: "allow" },
                  // A question is a reply prompt, not a page action, so it does
                  // not need the computer-control approval sheet.
                  { tool: "ask_user", pattern: "*", effect: "allow" },
                ]
              : defaultRules(state.settings.permissionMode, agent === "build"),
            only: browserMode ? ["browser", "ask_user"] : undefined,
            maxSteps: browserMode ? 10 : 6,
            signal: controller.signal,
            approve: (call, resource) => requestApproval(call, resource),
            onText: appendText,
            onReasoning: appendReasoning,
            onToolStart: (id, call, label) => {
              closeReasoning();
              if (call.name === "browser") {
                browserToolRan = true;
                browserToolIds.add(id);
                const action = String(call.args.action ?? "browser step");
                const url = typeof call.args.url === "string" ? call.args.url : "";
                if (!browserStarted) {
                  browserStarted = true;
                  beginBrowserActivity(text, `${action}${url ? ` · ${url}` : ""}`);
                } else {
                  updateBrowserActivity({ action, status: label, url });
                }
              }
              const extra: Part[] = [];
              if (call.name === "terminal") {
                const partId = `${id}:shell`;
                shellPart.current = partId;
                extra.push({
                  id: partId,
                  kind: "shell",
                  command: String(call.args.command ?? ""),
                  output: [],
                  state: "run",
                });
              }
              patch((message) => {
                // A model that forgets the <tool_call> tags streams the raw JSON
                // before the parser recovers it. Do not leave that JSON in the
                // transcript once the tool card exists.
                const parts = message.parts.flatMap((part): Part[] => {
                  if (part.kind !== "text") return [part];
                  const text = part.text
                    .replace(/\s*\{\s*"(?:action|type|name)"[\s\S]*$/i, "")
                    .trimEnd();
                  return text ? [{ ...part, text }] : [];
                });
                return {
                  ...message,
                  parts: [
                    ...parts,
                    {
                      id,
                      kind: "tool",
                      tool: toolKind(call.name),
                      label,
                      state: "run",
                    },
                    ...extra,
                  ],
                };
              });
            },
            onToolDone: (id, outcome, stateOfTool) => {
              if (shellPart.current === `${id}:shell`) shellPart.current = null;
              if (browserToolIds.has(id)) {
                const page = getElContext();
                updateBrowserActivity({
                  status: outcome.summary,
                  url: page?.url,
                  title: page?.title,
                  error: !outcome.ok,
                });
              }
              patch((message) => ({
                ...message,
                parts: message.parts.flatMap((part): Part[] => {
                  if (part.kind === "shell" && part.id === `${id}:shell` && outcome.shell) {
                    return [
                      {
                        ...part,
                        output: outcome.shell.output,
                        state: outcome.shell.state,
                      },
                    ];
                  }
                  if (part.id !== id || part.kind !== "tool") return [part];
                  const next: Part = {
                    ...part,
                    detail: outcome.summary,
                    state: stateOfTool,
                  };
                  const additions: Part[] = [];
                  if (outcome.diff) {
                    additions.push({
                      id: uid("part"),
                      kind: "diff",
                      path: outcome.diff.path,
                      added: outcome.diff.added,
                      removed: outcome.diff.removed,
                      lines: outcome.diff.lines,
                    });
                  }
                  if (outcome.artifact) {
                    additions.push({
                      id: uid("part"),
                      kind: "artifact",
                      artifactId: outcome.artifact.id,
                      name: outcome.artifact.name,
                      format: outcome.artifact.format,
                      bytes: outcome.artifact.bytes,
                    });
                  }
                  if (
                    outcome.shell &&
                    !message.parts.some((item) => item.id === `${id}:shell`)
                  ) {
                    additions.push({
                      id: `${id}:shell`,
                      kind: "shell",
                      command: outcome.shell.command,
                      output: outcome.shell.output,
                      state: outcome.shell.state,
                    });
                  }
                  return [next, ...additions];
                }),
              }));
            },
            onNote: (note) =>
              patch((message) => ({
                ...message,
                parts: [...message.parts, { id: uid("part"), kind: "note", text: note }],
              })),
            onUsage: (usage) => {
              inputTokens = usage.input ?? inputTokens;
              outputTokens = usage.output ?? outputTokens;
            },
            onLimit: requestMoreSteps,
          }).finally(() => {
            closeReasoning();
            if (browserToolRan) finishBrowserActivity("Browser task finished");
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
          const providerName =
            PROVIDERS.find((item) => item.id === provider)?.name ?? provider;
          patch((message) => ({
            ...message,
            streaming: false,
            durationMs: Date.now() - started,
            parts: [
              ...message.parts,
              {
                id: uid("part"),
                kind: "note",
                text: `No ${providerName} model is connected. Open Settings → Providers, add a key or start a local model, then send again. Lantas does not simulate runs.`,
              },
            ],
          }));
        }

        if (state.settings.notifications && !document.hasFocus() && "Notification" in window) {
          if (Notification.permission === "granted") {
            new Notification("Lantas", { body: "The turn finished." });
          }
        }
      } catch (error) {
        closeReasoning();
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
      state.mode,
      notify,
      requestMoreSteps,
      patchWorkspaceFile,
      stageChange,
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

  // The browser side chat shares this thread and its run. Its stop control, and
  // Escape while it is streaming, reach the same AbortController as the main
  // composer.
  useEffect(() => {
    const stop = () => handleStop();
    window.addEventListener("lantas:stop", stop);
    return () => window.removeEventListener("lantas:stop", stop);
  }, [handleStop]);

  const approvePlan = useCallback(
    (sessionId: string) => {
      updateSession(sessionId, (session) => ({ ...session, agent: "build" }));
      window.setTimeout(() => {
        void handleSendRef.current(
          "The plan above is approved. Execute it now, verify the result, and report what changed.",
        );
      }, 60);
    },
    [updateSession],
  );

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
      // In Code the workspace owns plain Cmd+B for its own rail, so handling it
      // here as well toggled two panels on one keypress.
      if (event.key.toLowerCase() === "b" && (event.shiftKey || state.mode !== "code")) {
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
  }, [createSession, togglePanel, toggleSidebar, openSettings, state.mode]);

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
    if (state.mode === "code") return state.workspaceName || "Code";
    if (state.view === "skills") return "Skills";
    if (state.view === "integrations") return "Integrations";
    return activeSession?.title ?? "Home";
  }, [state.mode, state.view, activeSession, state.workspaceName]);

  const openFile = useCallback(
    async (path: string, line?: number) => {
      const clean = path.replace(/^\.\//, "").replace(/^\/+/, "");
      // A word in a sentence is not a file. Before switching the whole app to
      // the editor, make sure the path is real in this folder; otherwise the
      // click only explains why nothing opened.
      if (!looksLikePath(clean)) return;
      const root = state.workspaceRoot;
      if (root) {
        const text = await readWorkspacePath(root, clean).catch(() => null);
        if (text === null) {
          notify(`${clean} is not in this folder`);
          return;
        }
      }
      setMode("code");
      setFileRequest({ path: clean, line, nonce: Date.now() });
    },
    [notify, setMode, state.workspaceRoot],
  );

  const openCli = useCallback(() => {
    // Desktop: the terminal button opens the user's own Terminal.app, already
    // running `lantas` in the open folder. The web build has no Terminal.app,
    // so there the in-app CLI tab is the same surface.
    if (inTauri()) {
      void openCliInTerminal(state.workspaceRoot || "")
        .then(() => notify("Lantas CLI opened in Terminal"))
        .catch((error) => {
          setMode("code");
          setCliRequest((value) => value + 1);
          notify(
            error instanceof Error ? error.message : "Terminal did not open",
            "error",
          );
        });
      return;
    }
    setMode("code");
    setCliRequest((value) => value + 1);
  }, [notify, setMode, state.workspaceRoot]);

  // Compare is reachable from the composer, the thread header and the rail.
  // It lives in Chat, so open that surface first if the user came from another
  // view or from the browser.
  useEffect(() => {
    const open = () => {
      setView("chats");
      setMode("chat");
      setCompareOpen(true);
    };
    window.addEventListener("lantas:compare", open);
    return () => window.removeEventListener("lantas:compare", open);
  }, [setMode, setView]);

  // Compare lives inside the Chat surface, not on top of the app. Leaving Chat
  // still closes it so Code and Browser are never covered by an old comparison.
  useEffect(() => {
    if (state.mode !== "chat") setCompareOpen(false);
  }, [state.mode]);

  const overlayOpen =
    paletteOpen ||
    settingsOpen ||
    permissionsOpen ||
    helpOpen ||
    limitAsk ||
    Boolean(pendingAction) ||
    Boolean(approval);

  return (
    <div className="app">
      <TitleBar
        title={title}
        mode={state.mode}
        onModeChange={changeMode}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenSettings={() => openSettings("general")}
        onOpenCli={openCli}
      />

      {state.mode === "code" ? (
        <div className="code-shell">
          <ErrorBoundary label="Code">
          <IdeView
            onExit={() => changeMode("chat")}
            onOpenFolder={() => void openFolder()}
            onAddFolder={() => void addFolder()}
            onOpenSettings={() => openSettings("general")}
            onOpenSkills={() => {
              setMode("chat");
              setView("skills");
            }}
            onAsk={(text, files) => void handleSend(text, files ?? [], { agent: "build" })}
            session={activeSession}
            defaultModel={state.settings.defaultModel}
            streaming={streaming}
            onStop={handleStop}
            openRequest={fileRequest}
            cliRequest={cliRequest}
          />
          </ErrorBoundary>
        </div>
      ) : (
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
              <BrowserView
                visible={state.mode === "browser" && !overlayOpen}
                miniVisible={state.mode === "chat" && !overlayOpen && !compareOpen}
                onOpenFile={openFile}
              />
            </div>

            {state.mode === "chat" && (
              <>
                {state.view === "skills" && <SkillsView />}
                {state.view === "integrations" && <IntegrationsView />}
                {state.view === "chats" &&
                  (compareOpen ? (
                    <ErrorBoundary label="Compare">
                      <CompareView
                        session={activeSession}
                        seed={compareSeed}
                        onClose={() => setCompareOpen(false)}
                      />
                    </ErrorBoundary>
                  ) : activeSession && activeSession.messages.length > 0 ? (
                    <ErrorBoundary key={activeSession.id} label="Chat">
                      <SessionView
                        session={activeSession}
                        streaming={streaming}
                        onSend={handleSend}
                        onStop={handleStop}
                        onOpenFile={openFile}
                        onAgentChange={(agent: AgentId) =>
                          updateSession(activeSession.id, (session) => ({ ...session, agent }))
                        }
                        onModelChange={(provider, model) =>
                          changeModel(activeSession.id, provider, model)
                        }
                        onOpenProviders={() => openSettings("providers")}
                        onScreenToggle={handleScreenToggle}
                        onApprovePlan={() => approvePlan(activeSession.id)}
                      />
                    </ErrorBoundary>
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
              onOpenFile={openFile}
            />
          )}
        </div>
      )}

      {state.mode === "chat" && !compareOpen && (
        <BrowserActivityDock
          onOpen={(url) => {
            if (url) setBrowserUrl(url);
            setMode("browser");
            dismissBrowserActivity();
          }}
        />
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
        onReviewPermissions={() => {
          setSettingsOpen(false);
          setPermissionsOpen(true);
        }}
      />

      {permissionsOpen && <PermissionsSheet onClose={() => setPermissionsOpen(false)} />}

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

      {limitAsk && (
        <div className="overlay" onMouseDown={() => settleLimit(false)}>
          <div
            className="confirm-card"
            role="dialog"
            aria-modal="true"
            aria-label="Continue the run"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <p className="confirm-kicker">The agent used its budget</p>
            <h2>Continue with six more tool rounds?</h2>
            <p className="confirm-copy">
              The work so far is saved. Continuing lets the agent finish the verification or
              stop where it is. You will not be asked again for three minutes.
            </p>
            <div className="confirm-actions">
              <button type="button" className="button-quiet" onClick={() => settleLimit(false)}>
                Stop here
              </button>
              <button type="button" className="button-primary" onClick={() => settleLimit(true)}>
                Continue
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
