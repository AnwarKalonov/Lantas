import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useStore } from "../lib/store";
import { useBrowserActivity } from "../lib/browserActivity";
import { getGoogleToken, listMail, type MailItem } from "../lib/google";
import {
  elBounds,
  elClose,
  elLastError,
  elOpen,
  elVisible,
  elWindow,
  inTauri,
} from "../lib/native";
import {
  browserEngine,
  openChromeUrl,
  openInChrome,
  setBrowserEngine,
  useChromeBridge,
  type BrowserEngine,
} from "../lib/chrome";
import {
  agentClick,
  agentEnter,
  agentHistory,
  agentPage,
  agentReload,
  agentScroll,
  agentType,
} from "../lib/browserAgent";
import { engineHealth } from "../lib/browserSidecar";
import { flattenBookmarks, readBrowserBookmarks } from "../lib/bookmarks";
import { ChromeBridgePanel } from "./ChromeBridgePanel";
import { ModelPicker } from "./ModelPicker";
import { readAttachments } from "../lib/attachments";
import type { Attachment, ProviderId } from "../lib/types";
import {
  EL_HOME,
  aiDriving,
  getElContext,
  hostOf,
  loadEl,
  normalizeUrl,
  readPage,
  saveEl,
  setAiDriving,
  setElContext,
  type ElData,
  type ElPage,
  type ElTab,
} from "../lib/el";
import { cx, timeAgo, uid } from "../lib/util";
import { AppLogo } from "./AppLogo";
import { Icon } from "./Icons";
import { Transcript } from "./Transcript";
import { TrustPanelHead } from "./TrustPanelHead";

const SHORTCUTS = [
  { name: "GitHub", slug: "github", url: "https://github.com" },
  { name: "Gmail", slug: "gmail", url: "https://mail.google.com" },
  { name: "YouTube", slug: "youtube", url: "https://youtube.com" },
  { name: "Reddit", slug: "reddit", url: "https://reddit.com" },
  { name: "Notion", slug: "notion", url: "https://notion.so" },
  { name: "Figma", slug: "figma", url: "https://figma.com" },
  { name: "Drive", slug: "googledrive", url: "https://drive.google.com" },
  { name: "X", slug: "x", url: "https://x.com" },
];

export function BrowserView({
  visible = true,
  miniVisible = false,
  onOpenFile,
}: {
  visible?: boolean;
  /** Chat is on screen and no modal is covering it. */
  miniVisible?: boolean;
  onOpenFile?: (path: string, line?: number) => void;
}) {
  const { state, setBrowserUrl, setSettings, updateSession, createSession, notify, togglePanel } =
    useStore();
  const [data, setData] = useState<ElData>(() => loadEl());
  const lastBrowserUrl = useRef(state.browserUrl);
  const [draft, setDraft] = useState("");
  const [page, setPage] = useState<ElPage | null>(getElContext());
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState({ name: "", email: "" });
  const [mail, setMail] = useState<MailItem[]>([]);
  const [reloadTick, setReloadTick] = useState(0);
  const [nativeReady, setNativeReady] = useState(false);
  const [miniRect, setMiniRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [engineError, setEngineError] = useState("");
  const activity = useBrowserActivity();
  const [engineTick, setEngineTick] = useState(0);
  const [clickTarget, setClickTarget] = useState("");
  const [controlsOpen, setControlsOpen] = useState(false);
  // The assistant is part of the browser, not a mode you discover: it opens
  // beside the page on a wide window and remembers being closed.
  const [aiOpen, setAiOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const saved = window.localStorage.getItem("lantas.browser.ai");
    if (saved === "on") return true;
    if (saved === "off") return false;
    return window.innerWidth >= 1180;
  });
  const [aiDraft, setAiDraft] = useState("");
  const [aiFiles, setAiFiles] = useState<Attachment[]>([]);
  const aiFileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem("lantas.browser.ai", aiOpen ? "on" : "off");
    } catch {
      // Private mode: the default still applies for this session.
    }
  }, [aiOpen]);
  const [driving, setDriving] = useState(() => aiDriving());
  const aiLogRef = useRef<HTMLDivElement>(null);
  const frameKey = useRef(0);
  const openedUrl = useRef("");
  const viewportRef = useRef<HTMLDivElement>(null);
  const trail = useRef<string[]>([EL_HOME]);
  const trailIndex = useRef(0);
  const native = inTauri();
  const [engine, setEngine] = useState<BrowserEngine>(() => browserEngine());
  const [sidecar, setSidecar] = useState<{ ok: boolean; detail: string; version?: string } | null>(
    null,
  );
  const bridge = useChromeBridge(engine === "chrome" && visible);

  // The local browser engine (engine/run.sh) is optional; the chip only says
  // whether a delegated task would work right now.
  useEffect(() => {
    let alive = true;
    const check = () => {
      void engineHealth().then((next) => {
        if (alive) setSidecar(next);
      });
    };
    check();
    const timer = window.setInterval(check, 20_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const active = data.tabs.find((tab) => tab.id === data.active) ?? data.tabs[0];
  const atHome = active.url === EL_HOME;

  useEffect(() => saveEl(data), [data]);

  useEffect(() => {
    if (state.browserUrl === lastBrowserUrl.current) return;
    lastBrowserUrl.current = state.browserUrl;
    if (state.browserUrl && state.browserUrl !== active.url) navigate(state.browserUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.browserUrl]);

  // Code mode unmounts BrowserView. When the browser tab mounts for an agent
  // navigation, the request may already be in the store before this component
  // exists, so adopt it on the first visible frame.
  useEffect(() => {
    if (!visible) return;
    if (state.browserUrl && state.browserUrl !== active.url) {
      lastBrowserUrl.current = state.browserUrl;
      navigate(state.browserUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Tabs (and the active one) survive leaving the tab and quitting the app:
  // loadEl restores them, so this only clears a stale hand-off URL. Resetting
  // the tab strip on mount was why every return from Code lost your pages.
  useEffect(() => {
    setBrowserUrl("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setDraft(active.url === EL_HOME ? "" : active.url);
  }, [active.url]);

  // The activity dock publishes the exact rectangle of its mini window. The
  // native child webview moves there while the user is in chat, so the small
  // screen is the actual page the assistant is on.
  useEffect(() => {
    const onMini = (event: Event) => {
      const detail = (event as CustomEvent<{ x: number; y: number; width: number; height: number } | null>)
        .detail;
      setMiniRect(detail && detail.width > 2 && detail.height > 2 ? detail : null);
    };
    window.addEventListener("lantas:mini-screen", onMini);
    return () => window.removeEventListener("lantas:mini-screen", onMini);
  }, []);

  const box = () => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  };

  // Attach or detach the native engine as tabs, modes and URLs change.
  useEffect(() => {
    if (!native) return;
    // In Chrome mode the page lives in the user's browser, not in a child webview.
    if (engine !== "local") {
      setNativeReady(false);
      void elClose();
      return;
    }
    if (atHome) {
      setNativeReady(false);
      openedUrl.current = "";
      void elClose();
      return;
    }

    // A page the assistant opened from chat still needs a live webview. Keep
    // it alive just off-screen, then reveal the same page when the user opens
    // the Browser tab. This is what makes the mini agent view truthful.
    const visibleBox = box();
    const wantsMini =
      !visible && miniVisible && Boolean(miniRect) && activity.steps.length > 0;
    const targetBox =
      visible && visibleBox && visibleBox.width > 2 && visibleBox.height > 2
        ? visibleBox
        : wantsMini && miniRect
          ? miniRect
          : { x: -12000, y: -12000, width: 4, height: 4 };

    if (nativeReady && openedUrl.current === active.url) {
      if (visible) {
        void elVisible(true);
        if (visibleBox) void elBounds(visibleBox);
      } else if (wantsMini && miniRect) {
        void elBounds(miniRect);
        void elVisible(true);
      } else {
        void elVisible(false);
      }
      return;
    }

    const frame = requestAnimationFrame(() => {
      void elOpen(active.url, targetBox).then((ok) => {
        setNativeReady(ok);
        if (ok) openedUrl.current = active.url;
        if (ok && wantsMini && miniRect) {
          void elBounds(miniRect);
          void elVisible(true);
        } else if (ok && !visible) {
          void elVisible(false);
        }
        setEngineError(
          ok ? "" : elLastError() || "The native browser engine did not start on this build.",
        );
      });
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    native,
    visible,
    miniVisible,
    active.url,
    atHome,
    data.active,
    engineTick,
    engine,
    miniRect,
    activity.steps.length,
  ]);

  // The assistant reads and tags controls inside the child webview. Mirror the
  // page title back into the tab strip and the assistant's page context.
  useEffect(() => {
    const onPage = (event: Event) => {
      const detail = (event as CustomEvent<{ page?: ElPage }>).detail;
      const next = detail?.page;
      if (!next?.url) return;
      setPage(next);
      setData((current) => ({
        ...current,
        tabs: current.tabs.map((tab) =>
          tab.id === current.active ? { ...tab, title: next.title || tab.title, url: next.url } : tab,
        ),
      }));
    };
    window.addEventListener("lantas:page", onPage);
    return () => window.removeEventListener("lantas:page", onPage);
  }, []);

  useEffect(
    () => () => {
      if (native) void elClose();
    },
    [native],
  );

  useEffect(() => {
    if (!native || !visible) return;
    const node = viewportRef.current;
    if (!node) return;
    const sync = () => {
      const rect = node.getBoundingClientRect();
      void elBounds({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
    };
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    window.addEventListener("resize", sync);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [native, visible]);

  const patchTab = (id: string, patch: Partial<ElTab>) =>
    setData((current) => ({
      ...current,
      tabs: current.tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)),
    }));

  const navigate = (raw: string, tabId = active.id) => {
    const url = normalizeUrl(raw);
    frameKey.current += 1;
    setReloadTick((tick) => tick + 1);
    setError("");
    setPage(null);
    trail.current = [...trail.current.slice(0, trailIndex.current + 1), url];
    trailIndex.current = trail.current.length - 1;
    setData((current) => ({
      ...current,
      tabs: current.tabs.map((tab) =>
        tab.id === tabId
          ? { ...tab, url, title: url === EL_HOME ? "New tab" : hostOf(url) }
          : tab,
      ),
      history:
        url === EL_HOME
          ? current.history
          : [
              { url, title: hostOf(url), at: Date.now() },
              ...current.history.filter((visit) => visit.url !== url),
            ].slice(0, 60),
    }));
    if (url !== EL_HOME) setBrowserUrl(url);
    if (engine === "chrome" && url !== EL_HOME) {
      void openChromeUrl(url).catch((error) =>
        notify(error instanceof Error ? error.message : "Chrome did not answer", "error"),
      );
    }
  };

  // The assistant's browser tool navigates through this component so the URL,
  // tab title and history stay in sync with the page it changed.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  useEffect(() => {
    const onAgentNavigate = (event: Event) => {
      const detail = (event as CustomEvent<{ url?: string }>).detail;
      if (detail?.url) navigateRef.current(detail.url);
    };
    window.addEventListener("lantas:navigate", onAgentNavigate);
    return () => window.removeEventListener("lantas:navigate", onAgentNavigate);
  }, []);

  /** Text for the model, from the active Chrome tab or the embedded engine. */
  const pageFor = async (): Promise<ElPage> => {
    if (engine === "chrome") {
      const fromChrome = await agentPage();
      if (!fromChrome) {
        throw new Error("Chrome could not read that tab. Open a website in Chrome first.");
      }
      return fromChrome;
    }
    return readPage(active.url);
  };

  const newTab = (url = EL_HOME) => {
    const id = uid("tab");
    setData((current) => ({
      ...current,
      tabs: [...current.tabs, { id, url, title: url === EL_HOME ? "New tab" : hostOf(url) }],
      active: id,
    }));
  };

  const closeTab = (id: string) => {
    setData((current) => {
      const tabs = current.tabs.filter((tab) => tab.id !== id);
      if (tabs.length === 0) {
        const fresh = { id: uid("tab"), url: EL_HOME, title: "New tab" };
        return { ...current, tabs: [fresh], active: fresh.id };
      }
      return {
        ...current,
        tabs,
        active:
          current.active === id ? tabs[Math.max(0, tabs.length - 1)].id : current.active,
      };
    });
  };

  // Browser-tool tab actions use the same tab strip the user sees. Keeping
  // this in one place means an agent switch cannot silently point at a tab
  // that the UI has already closed.
  useEffect(() => {
    const onAgentTab = (event: Event) => {
      const detail = (
        event as CustomEvent<{ action?: string; id?: string; url?: string }>
      ).detail;
      if (!detail) return;
      if (detail.action === "activate" && detail.id) {
        setData((current) =>
          current.tabs.some((tab) => tab.id === detail.id)
            ? { ...current, active: detail.id as string }
            : current,
        );
      } else if (detail.action === "new") {
        newTab(detail.url || EL_HOME);
      } else if (detail.action === "close" && detail.id) {
        closeTab(detail.id);
      }
    };
    window.addEventListener("lantas:tab", onAgentTab);
    return () => window.removeEventListener("lantas:tab", onAgentTab);
    // The handlers only use state setters, so one listener is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const step = (direction: "back" | "forward") => {
    if (engine === "chrome") {
      void agentHistory(direction).then((ok) => {
        if (!ok) notify("Chrome did not move — is the extension connected?", "error");
      });
      return;
    }
    if (native) {
      void agentHistory(direction);
      return;
    }
    const next = trailIndex.current + (direction === "back" ? -1 : 1);
    if (next < 0 || next >= trail.current.length) return;
    trailIndex.current = next;
    const url = trail.current[next];
    setData((current) => ({
      ...current,
      tabs: current.tabs.map((tab) =>
        tab.id === current.active ? { ...tab, url, title: hostOf(url) } : tab,
      ),
    }));
    setBrowserUrl(url);
  };

  const reload = () => {
    setError("");
    setPage(null);
    if (engine === "chrome") {
      void agentReload().then((ok) => {
        if (!ok) notify("Chrome did not reload", "error");
      });
      return;
    }
    if (native) void agentReload();
    setReloadTick((tick) => tick + 1);
  };

  const openAssistant = () => {
    if (!aiOpen && state.panelOpen) togglePanel();
    setAiOpen(true);
  };

  const toggleAssistant = () => {
    if (!aiOpen && state.panelOpen) togglePanel();
    setAiOpen((open) => !open);
  };

  /** Give the model the page's text before it answers, without leaving the page. */
  const ensurePage = async () => {
    if (atHome || page) return;
    try {
      const next = await pageFor();
      setPage(next);
      setElContext(next);
      patchTab(active.id, { title: next.title });
    } catch {
      /* some sites block extraction; the model still gets the URL */
    }
  };

  const ask = async (prompt = "Summarize this page and tell me what matters.") => {
    openAssistant();
    await ensurePage();
    window.dispatchEvent(new CustomEvent("lantas:ask", { detail: { text: prompt } }));
  };

  const click = async (target = clickTarget) => {
    if (!target.trim()) return;
    if (!native) {
      notify("Clicking needs the desktop app — the web preview cannot script pages", "error");
      return;
    }
    const ok = await agentClick(target.trim());
    notify(ok ? `Clicked “${target.trim()}”` : "That click did not land", ok ? "default" : "error");
  };

  const toggleBookmark = () => {
    if (atHome) return;
    const exists = data.bookmarks.some((item) => item.url === active.url);
    setData((current) => ({
      ...current,
      bookmarks: exists
        ? current.bookmarks.filter((item) => item.url !== active.url)
        : [{ url: active.url, title: active.title }, ...current.bookmarks],
    }));
    // The star used to change state with no visible result until you went home.
    notify(exists ? "Removed from home" : `Saved “${active.title || hostOf(active.url)}” to home`);
  };

  const signIn = () => {
    const name = profile.name.trim() || profile.email.split("@")[0] || "You";
    if (!profile.email.includes("@")) {
      notify("Enter an email first", "error");
      return;
    }
    setData((current) => ({
      ...current,
      profile: { name, email: profile.email.trim(), joined: Date.now() },
    }));
    setProfileOpen(false);
    notify("Profile saved on this Mac");
  };

  const importBookmarks = async () => {
    setImporting(true);
    try {
      const browsers = await readBrowserBookmarks();
      const found = flattenBookmarks(browsers).slice(0, 600);
      if (!found.length) {
        notify("No Chrome or Chromium bookmarks found on this Mac", "error");
        return;
      }
      setData((current) => {
        const seen = new Set(current.bookmarks.map((item) => item.url));
        const fresh = found
          .filter((item) => !seen.has(item.url))
          .map((item) => ({ url: item.url, title: item.title || hostOf(item.url) }));
        return { ...current, bookmarks: [...fresh, ...current.bookmarks].slice(0, 800) };
      });
      notify(
        `Imported ${found.length} bookmark${found.length === 1 ? "" : "s"} from ${browsers
          .map((browser) => browser.name)
          .join(", ")}`,
      );
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "Could not read bookmarks", "error");
    } finally {
      setImporting(false);
    }
  };

  const importMail = async () => {
    if (!getGoogleToken()) {
      notify("Connect Gmail in Integrations first", "error");
      return;
    }
    setBusy(true);
    try {
      const inbox = await listMail(6);
      setMail(inbox);
      notify(`${inbox.length} unread messages imported`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const activeSession = state.sessions.find((item) => item.id === state.activeId) ?? null;
  const aiMessages = (activeSession?.messages ?? []).slice(-12);
  const aiModel = activeSession?.model ?? state.settings.defaultModel;
  const aiProvider = activeSession?.provider ?? state.settings.defaultProvider;
  const aiStreaming = Boolean(activeSession?.messages.at(-1)?.streaming);

  const pickAiModel = (nextProvider: ProviderId, nextModel: string) => {
    if (activeSession) {
      updateSession(activeSession.id, (session) => ({
        ...session,
        provider: nextProvider,
        model: nextModel,
      }));
    }
    setSettings({ defaultProvider: nextProvider, defaultModel: nextModel });
  };

  const setAiMode = (mode: "ask" | "act") => {
    const on = mode === "act";
    if (on === driving) return;
    setDriving(on);
    setAiDriving(on);
  };

  useEffect(() => {
    if (!aiOpen) return;
    aiLogRef.current?.scrollTo({ top: aiLogRef.current.scrollHeight, behavior: "smooth" });
  }, [aiOpen, aiMessages.length, activeSession?.messages.at(-1)?.parts]);

  const typeInto = async (value: string, selector?: string) => {
    if (!native) {
      notify("Typing needs the desktop app", "error");
      return;
    }
    const ok = await agentType(value, selector);
    notify(ok ? "Typed into the page" : "That field was not found", ok ? "default" : "error");
  };

  const pressEnter = async () => {
    if (!native) {
      notify("That needs the desktop app", "error");
      return;
    }
    const ok = await agentEnter();
    if (!ok) notify("Could not press Enter in Chrome", "error");
  };

  const scrollPage = async (pixels: number) => {
    await agentScroll(pixels);
  };

  const attachAiFiles = async (list: FileList | null) => {
    const { files, rejected } = await readAttachments(list);
    if (rejected.length) notify(rejected[0], "error");
    if (files.length) setAiFiles((current) => [...current, ...files]);
  };

  /**
   * The panel has no local command layer.
   *
   * "open desmos" used to be read by a regex here and sent to the address bar,
   * which meant the app chose the page (or searched the word) without the
   * model. Every sentence now goes to the assistant, which picks the address
   * and drives the page through the browser tool.
   */
  const submitAsk = async (event: FormEvent) => {
    event.preventDefault();
    const text = aiDraft.trim();
    if ((!text && aiFiles.length === 0) || aiStreaming) return;
    const files = aiFiles;
    setAiDraft("");
    setAiFiles([]);
    openAssistant();
    await ensurePage();
    window.dispatchEvent(
      new CustomEvent("lantas:ask", { detail: { text, attachments: files } }),
    );
  };

  const toggleControl = () => {
    const next = !driving;
    setDriving(next);
    setAiDriving(next);
    notify(next ? "Agent can drive the browser" : "You have control of the browser");
  };

  const switchEngine = (next: BrowserEngine) => {
    if (next === engine) return;
    setEngine(next);
    setBrowserEngine(next);
    setEngineError("");
    setPage(null);
    if (next === "chrome") {
      notify("Chrome engine — connect the extension if this is the first time");
      void bridge.refresh();
    } else {
      notify("Lantas Browser engine");
    }
  };

  /** Opens the page in the user's Chrome (via the extension), or their default browser. */
  const openOutside = async () => {
    if (atHome) return;
    if (engine === "chrome" || bridge.status.connected) {
      try {
        await openChromeUrl(active.url);
        notify("Opened in Chrome");
      } catch (error) {
        notify(error instanceof Error ? error.message : "Chrome did not answer", "error");
      }
      return;
    }
    void openInChrome(active.url);
  };

  const bookmarked = data.bookmarks.some((item) => item.url === active.url);
  const recent = useMemo(
    () =>
      data.history
        .filter(
          (visit, index, all) => all.findIndex((item) => item.url === visit.url) === index,
        )
        .slice(0, 5),
    [data.history],
  );

  return (
    <section className="el">
      <div className="el-chrome">
        <div className="el-tabstrip">
          {data.tabs.map((tab) => (
            <div
              key={tab.id}
              className={cx("el-tab", tab.id === active.id && "is-active")}
              onClick={() => setData((current) => ({ ...current, active: tab.id }))}
              role="tab"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter")
                  setData((current) => ({ ...current, active: tab.id }));
              }}
            >
              <span className="el-tab-mark">
                {tab.url === EL_HOME ? "⌘" : hostOf(tab.url).charAt(0).toUpperCase()}
              </span>
              <span className="el-tab-title">
                {tab.url === EL_HOME ? "New tab" : tab.title || hostOf(tab.url)}
              </span>
              <button
                type="button"
                className="el-tab-close"
                aria-label="Close tab"
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                <Icon name="close" size={10} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="el-tab-new"
            onClick={() => newTab()}
            aria-label="New tab"
          >
            <Icon name="plus" size={12} />
          </button>
        </div>

        <div className="el-identity">
          <span className="el-mini-wordmark">Lantas Browser</span>
          <button
            type="button"
            className={cx("el-avatar", data.profile && "is-signed")}
            onClick={() => setProfileOpen((open) => !open)}
            aria-label="Profile"
          >
            {data.profile ? data.profile.name.charAt(0).toUpperCase() : "?"}
          </button>
          {profileOpen && (
            <div className="el-profile-pop">
              {data.profile ? (
                <>
                  <p className="el-profile-name">{data.profile.name}</p>
                  <p className="el-muted">{data.profile.email}</p>
                  <div className="el-actions">
                    <button
                      type="button"
                      className="button-quiet"
                      onClick={() => void importBookmarks()}
                      disabled={importing}
                    >
                      {importing ? "Importing…" : "Import bookmarks"}
                    </button>
                    <button type="button" className="button-quiet" onClick={() => void importMail()}>
                      Import Gmail
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        setData((current) => ({ ...current, profile: null }));
                        setMail([]);
                        setProfileOpen(false);
                      }}
                    >
                      Sign out
                    </button>
                  </div>
                  {mail.length > 0 && (
                    <ul className="el-mail">
                      {mail.slice(0, 3).map((item) => (
                        <li key={item.id}>
                          <span>{item.subject}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <>
                  <p className="el-pop-title">Sign in to Lantas Browser</p>
                  <p className="el-muted">
                    Bookmarks, history and imported mail stay under one local profile. No account
                    server.
                  </p>
                  <div className="el-signin">
                    <input
                      placeholder="Name"
                      value={profile.name}
                      onChange={(event) =>
                        setProfile((current) => ({ ...current, name: event.target.value }))
                      }
                    />
                    <input
                      placeholder="you@example.com"
                      value={profile.email}
                      onChange={(event) =>
                        setProfile((current) => ({ ...current, email: event.target.value }))
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") signIn();
                      }}
                    />
                    <button type="button" className="button-primary" onClick={signIn}>
                      Continue
                    </button>
                  </div>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => window.dispatchEvent(new CustomEvent("lantas:gmail"))}
                  >
                    Use Gmail data instead
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="el-toolbar">
        <div className="el-nav">
          <button
            type="button"
            className="el-round"
            onClick={() => step("back")}
            aria-label="Back"
          >
            <Icon name="chevronRight" size={13} className="flip-x" />
          </button>
          <button
            type="button"
            className="el-round"
            onClick={() => step("forward")}
            aria-label="Forward"
          >
            <Icon name="chevronRight" size={13} />
          </button>
          <button type="button" className="el-round" onClick={reload} aria-label="Reload">
            <Icon name="refresh" size={13} />
          </button>
        </div>

        <form
          className={cx("el-address", atHome && "is-empty")}
          onSubmit={(event) => {
            event.preventDefault();
            navigate(draft);
          }}
        >
          <AppLogo slug="google" name="Google" size={14} />
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Search Google or type a URL"
            spellCheck={false}
            aria-label="Address bar"
          />
          {draft && <span className="el-enter">↵</span>}
        </form>

        <div className="el-tools">
          {native && (
          <div className="el-engine-switch" role="group" aria-label="Browser engine">
            <button
              type="button"
              className={cx(engine === "local" && "is-on")}
              onClick={() => switchEngine("local")}
              title="Lantas Browser engine"
            >
              Lantas
            </button>
            <button
              type="button"
              className={cx(engine === "chrome" && "is-on")}
              onClick={() => switchEngine("chrome")}
              title="Drive Chrome through the Lantas extension"
            >
              Chrome
            </button>
          </div>
          )}
          <button
            type="button"
            className={cx("el-round", bookmarked && "is-on")}
            onClick={toggleBookmark}
            disabled={atHome}
            title={bookmarked ? "Remove from home" : "Add to home"}
            aria-label={bookmarked ? "Remove bookmark" : "Bookmark"}
          >
            <Icon name="star" size={13} />
          </button>
          <button
            type="button"
            className="el-round"
            onClick={() => void openOutside()}
            disabled={atHome}
            title="Open in Chrome"
            aria-label="Open in Chrome"
          >
            <Icon name="external" size={13} />
          </button>
          <button
            type="button"
            className={cx("el-ai-button", aiOpen && "is-on")}
            onClick={toggleAssistant}
            aria-label="Lantas AI"
            title="Ask Lantas AI about this page"
          >
            <Icon name="sparkle" size={13} />
            <span>Ask AI</span>
          </button>
        </div>
      </div>

      {error && <p className="status-line is-error el-error">{error}</p>}

      <div className={cx("el-body", aiOpen && "has-ai")}>
        <div className="el-main">
        {engine === "chrome" ? (
          <ChromeBridgePanel
            status={bridge.status}
            onRefresh={bridge.refresh}
            onAsk={(text) => {
              void ask(text);
            }}
          />
        ) : atHome ? (
          <div className="el-home">
            <div className="el-home-inner">
              <div className="el-greeting">
                <h1>Search the web, or let the agent drive it</h1>
                <p>
                  Pages open in Lantas Browser's own engine, or in your Chrome through the
                  extension, so the model can read them, click what matters and type where you
                  ask.
                </p>
              </div>

              <form
                className="el-big-search"
                onSubmit={(event) => {
                  event.preventDefault();
                  const input = new FormData(event.currentTarget).get("q");
                  if (typeof input === "string" && input.trim()) navigate(input);
                }}
              >
                <Icon name="search" size={17} />
                <input
                  name="q"
                  placeholder="Search Google or enter an address"
                  spellCheck={false}
                  autoFocus
                />
                <kbd>↵</kbd>
              </form>

              <div className="el-shortcut-row">
                {SHORTCUTS.map((item) => (
                  <button
                    key={item.url}
                    type="button"
                    className="el-shortcut"
                    onClick={() => navigate(item.url)}
                    title={item.name}
                  >
                    <span className="el-shortcut-logo">
                      <AppLogo slug={item.slug} name={item.name} size={20} />
                    </span>
                    <span>{item.name}</span>
                  </button>
                ))}
              </div>

              <div className="el-recents">
                <div className="el-recents-head">
                  <span>Recent</span>
                  <span className="el-recents-actions">
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => void importBookmarks()}
                      disabled={importing}
                    >
                      {importing ? "Importing…" : "Import from Chrome"}
                    </button>
                    {data.history.length > 0 && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setData((current) => ({ ...current, history: [] }))}
                      >
                        Clear
                      </button>
                    )}
                  </span>
                </div>
                {recent.length === 0 ? (
                  <p className="el-muted">
                    Nothing yet. Search above, or open a bookmark from the sidebar.
                  </p>
                ) : (
                  <div className="el-recent-list">
                    {recent.map((visit) => (
                      <button
                        key={visit.url}
                        type="button"
                        className="el-recent-row"
                        onClick={() => navigate(visit.url)}
                      >
                        <span className="el-recent-logo">
                          {hostOf(visit.url).charAt(0).toUpperCase()}
                        </span>
                        <span className="el-recent-text">
                          <span>{visit.title || hostOf(visit.url)}</span>
                          <small>{hostOf(visit.url)}</small>
                        </span>
                        <span className="el-recent-time">{timeAgo(visit.at)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {data.bookmarks.length > 0 && (
                <div className="el-bookmarks">
                  {data.bookmarks.slice(0, 4).map((item) => (
                    <button
                      key={item.url}
                      type="button"
                      className="el-bookmark"
                      onClick={() => navigate(item.url)}
                    >
                      <span>{item.title || hostOf(item.url)}</span>
                      <small>{hostOf(item.url)}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className={cx("el-viewport", !native && "is-preview")} ref={viewportRef}>
            {native ? (
              <div className={cx("el-engine", nativeReady && !engineError && "is-ready")}>
                <span className="el-engine-mark">Lantas Browser</span>
                {engineError ? (
                  <>
                    <span className="el-muted">{engineError}</span>
                    <div className="el-actions">
                      <button
                        type="button"
                        className="button-primary"
                        onClick={() => switchEngine("chrome")}
                      >
                        Use Chrome engine
                      </button>
                      <button
                        type="button"
                        className="button-quiet"
                        onClick={() => {
                          setEngineError("");
                          setNativeReady(false);
                          void elClose();
                          setEngineTick((tick) => tick + 1);
                        }}
                      >
                        Try again
                      </button>
                      <button
                        type="button"
                        className="button-quiet"
                        onClick={() => void openOutside()}
                      >
                        Open in Chrome
                      </button>
                    </div>
                  </>
                ) : (
                  <span className="el-muted">
                    {nativeReady ? "Native page" : "Starting the browser engine…"}
                  </span>
                )}
              </div>
            ) : (
              <div className="el-preview-block">
                <span className="el-preview-icon">
                  <AppLogo
                    slug={hostOf(active.url).replace(/^www\./, "").split(".")[0]}
                    name={hostOf(active.url)}
                    size={22}
                    domain={hostOf(active.url)}
                  />
                </span>
                <h2>{hostOf(active.url)}</h2>
                <p>
                  {native
                    ? "Sites like Notion and Google refuse to load inside a web frame. Use Lantas Browser's own engine, or the Chrome engine where Lantas drives the tab you already have open."
                    : "This browser preview cannot display external pages. Use the desktop app's native engine, or connect the Chrome extension and switch engines."}
                </p>
                <div className="el-actions">
                  <button
                    type="button"
                    className="button-primary"
                    onClick={() => switchEngine("chrome")}
                  >
                    Use Chrome engine
                  </button>
                  <button type="button" className="button-quiet" onClick={() => void openOutside()}>
                    Open in Chrome
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        </div>

        {aiOpen && (
          <aside className="el-ai" aria-label="Lantas">
            <TrustPanelHead
              onNewChat={() => {
                createSession();
                notify("Started a new browser chat");
              }}
              onSettings={() =>
                window.dispatchEvent(
                  new CustomEvent("lantas:settings", { detail: { tab: "providers" } }),
                )
              }
              onClose={() => setAiOpen(false)}
            />

            <div className="el-ai-log" ref={aiLogRef}>
              <Transcript
                messages={aiMessages}
                compact
                onOpenFile={onOpenFile}
                empty={
                  <div className="el-ai-empty">
                    <p className="el-ai-eyebrow">This page</p>
                    <h2 className="el-ai-lead">Ask the page.</h2>
                    <p className="el-ai-copy">
                      Lantas reads what you are looking at. In Act mode it can click, type and
                      navigate, one step at a time.
                    </p>
                    <div className="el-ai-prompts">
                      <button type="button" onClick={() => ask()}>
                        <span>Summarize this page</span>
                        <span className="el-ai-arrow">→</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => ask("What are the main actions available on this page?")}
                      >
                        <span>Find what I can do here</span>
                        <span className="el-ai-arrow">→</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => ask("Find the main action on this page and click it.")}
                      >
                        <span>Do the main action</span>
                        <span className="el-ai-arrow">→</span>
                      </button>
                    </div>
                  </div>
                }
              />
            </div>

            <form className="el-ai-form" onSubmit={submitAsk}>
              {aiFiles.length > 0 && (
                <div className="attach-row">
                  {aiFiles.map((file) => (
                    <span className={cx("attach-chip", file.kind === "image" && "is-image")} key={file.id}>
                      {file.kind === "image" ? <img src={file.body} alt="" /> : <Icon name="file" size={12} />}
                      <span className="attach-name">{file.name}</span>
                      <button
                        type="button"
                        className="attach-remove"
                        aria-label={`Remove ${file.name}`}
                        onClick={() =>
                          setAiFiles((current) => current.filter((item) => item.id !== file.id))
                        }
                      >
                        <Icon name="close" size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <textarea
                value={aiDraft}
                onChange={(event) => setAiDraft(event.target.value)}
                onPaste={(event) => {
                  const pasted = event.clipboardData?.files;
                  if (pasted?.length) {
                    event.preventDefault();
                    void attachAiFiles(pasted);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                rows={2}
                placeholder={driving ? "Ask AI anything, or say what to do" : "Ask AI anything"}
                spellCheck={false}
                aria-label="Ask Lantas"
              />
              <div className="el-ai-tools">
                <div className="el-ai-modes" role="group" aria-label="Browser access">
                  <button
                    type="button"
                    className={cx(!driving && "is-on")}
                    onClick={() => setAiMode("ask")}
                    title="Read the page, change nothing"
                  >
                    Ask
                  </button>
                  <button
                    type="button"
                    className={cx(driving && "is-on")}
                    onClick={() => setAiMode("act")}
                    title="Let Lantas click, type and navigate"
                  >
                    Act
                  </button>
                </div>
                <ModelPicker
                  provider={aiProvider}
                  model={aiModel}
                  onPick={pickAiModel}
                  onConnect={() =>
                    window.dispatchEvent(
                      new CustomEvent("lantas:settings", { detail: { tab: "providers" } }),
                    )
                  }
                  className="el-ai-model"
                />
                <button
                  type="button"
                  className="el-ai-attach"
                  onClick={() => aiFileInput.current?.click()}
                  aria-label="Attach files or images"
                  title="Attach files or images"
                >
                  <Icon name="paperclip" size={12} />
                </button>
                <input
                  ref={aiFileInput}
                  type="file"
                  multiple
                  hidden
                  onChange={(event) => {
                    void attachAiFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
                <button
                  type="submit"
                  className="el-ai-send"
                  disabled={!aiDraft.trim() && aiFiles.length === 0}
                  aria-label="Send"
                >
                  <Icon name="arrowUp" size={13} />
                </button>
              </div>
            </form>

            <div className="el-ai-foot">
              <span>Lantas can browse the web. Check important info.</span>
              <span className="el-ai-hint">
                {aiStreaming ? "Working" : driving ? "Step by step" : "Read only"}
              </span>
            </div>
          </aside>
        )}
      </div>

      <div className="el-foot">
        <span
          className={cx(
            "el-dot",
            (engine === "chrome" ? bridge.status.connected : native) && "is-native",
          )}
        />
        <span className="el-foot-status">
          {page
            ? `“${page.title.slice(0, 40)}” ready for the model`
            : engine === "chrome"
              ? bridge.status.connected
                ? "Chrome connected"
                : "Chrome extension offline"
              : native
                ? "Native engine"
                : "Web preview"}
        </span>
        <button
          type="button"
          className="el-foot-toggle"
          onClick={() => setControlsOpen((open) => !open)}
        >
          {controlsOpen ? "Hide page tools" : "Page tools"}
        </button>
        <span className="el-foot-spacer" />
        <button
          type="button"
          className={cx("el-engine", sidecar?.ok && "is-on")}
          title={
            sidecar?.ok
              ? "browser-use is running; the agent can delegate a whole task to it"
              : "Optional: run bash engine/run.sh to let the agent delegate whole browsing tasks"
          }
          onClick={() => {
            if (sidecar?.ok) {
              notify(`Browser engine ready · ${sidecar.detail}`);
              return;
            }
            void navigator.clipboard?.writeText("bash engine/run.sh");
            notify("Copied: bash engine/run.sh — run it once to enable delegated tasks");
          }}
        >
          <span className="el-engine-dot" />
          {sidecar?.ok ? "browser-use" : "engine off"}
        </button>
        <button
          type="button"
          className={cx("el-switch is-compact", driving && "is-on")}
          role="switch"
          aria-checked={driving}
          onClick={toggleControl}
        >
          <span className="el-switch-track">
            <span className="el-switch-thumb" />
          </span>
          {driving ? "Agent can drive" : "You have control"}
        </button>

      </div>

      {controlsOpen && (
        <div className="el-controls">
          <input
            value={clickTarget}
            onChange={(event) => setClickTarget(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void click();
            }}
            placeholder="Click by selector or visible text"
            spellCheck={false}
          />
          <button type="button" className="button-primary" onClick={() => void click()}>
            Click in page
          </button>
          <span className="el-controls-hint">
            The model drives the page with <code>/click</code>, <code>/type</code>,{" "}
            <code>/scroll</code> and <code>/enter</code>
          </span>
        </div>
      )}
    </section>
  );
}
