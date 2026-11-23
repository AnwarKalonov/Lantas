import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useStore } from "../lib/store";
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
import { ChromeBridgePanel } from "./ChromeBridgePanel";
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

export function BrowserView({ visible = true }: { visible?: boolean }) {
  const { state, setBrowserUrl, notify, togglePanel } = useStore();
  const [data, setData] = useState<ElData>(() => loadEl());
  const lastBrowserUrl = useRef(state.browserUrl);
  const [draft, setDraft] = useState("");
  const [page, setPage] = useState<ElPage | null>(getElContext());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState({ name: "", email: "" });
  const [mail, setMail] = useState<MailItem[]>([]);
  const [reloadTick, setReloadTick] = useState(0);
  const [nativeReady, setNativeReady] = useState(false);
  const [engineError, setEngineError] = useState("");
  const [engineTick, setEngineTick] = useState(0);
  const [clickTarget, setClickTarget] = useState("");
  const [controlsOpen, setControlsOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiDraft, setAiDraft] = useState("");
  const [driving, setDriving] = useState(() => aiDriving());
  const aiLogRef = useRef<HTMLDivElement>(null);
  const frameKey = useRef(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const trail = useRef<string[]>([EL_HOME]);
  const trailIndex = useRef(0);
  const native = inTauri();
  const [engine, setEngine] = useState<BrowserEngine>(() => browserEngine());
  const bridge = useChromeBridge(engine === "chrome" && visible);

  const active = data.tabs.find((tab) => tab.id === data.active) ?? data.tabs[0];
  const atHome = active.url === EL_HOME;

  useEffect(() => saveEl(data), [data]);

  useEffect(() => {
    if (state.browserUrl === lastBrowserUrl.current) return;
    lastBrowserUrl.current = state.browserUrl;
    if (state.browserUrl && state.browserUrl !== active.url) navigate(state.browserUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.browserUrl]);

  // The browser opens on its own home page every launch; bookmarks and history stay.
  useEffect(() => {
    setData((current) => {
      if (current.tabs.length === 1 && current.tabs[0].url === EL_HOME) return current;
      const id = uid("tab");
      return { ...current, tabs: [{ id, url: EL_HOME, title: "New tab" }], active: id };
    });
    setBrowserUrl("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setDraft(active.url === EL_HOME ? "" : active.url);
  }, [active.url]);

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
    if (!visible) {
      void elVisible(false);
      return;
    }
    if (!atHome) {
      void elVisible(true);
      const frame = requestAnimationFrame(() => {
        const rect = box();
        if (!rect) return;
        void elOpen(active.url, rect).then((ok) => {
          setNativeReady(ok);
          setEngineError(
            ok ? "" : elLastError() || "The native browser engine did not start on this build.",
          );
        });
      });
      return () => cancelAnimationFrame(frame);
    }
    setNativeReady(false);
    void elClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native, visible, active.url, atHome, data.active, engineTick, engine]);

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
    setData((current) => {
      const exists = current.bookmarks.some((item) => item.url === active.url);
      return {
        ...current,
        bookmarks: exists
          ? current.bookmarks.filter((item) => item.url !== active.url)
          : [{ url: active.url, title: active.title }, ...current.bookmarks],
      };
    });
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
  const aiMessages = (activeSession?.messages ?? []).slice(-10);
  const aiModel = activeSession?.model ?? state.settings.defaultModel;

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

  /** Natural commands the agent (or you) can run without a round trip to a model. */
  const agentStep = async (raw: string): Promise<boolean> => {
    const text = raw.trim();
    const lower = text.toLowerCase();
    if (!text) return true;
    if (!aiDriving()) {
      notify("You have control — turn the agent back on first", "error");
      return true;
    }

    const open = text.match(/^(?:open|go to|navigate to)\s+(.+)$/i);
    if (open) {
      navigate(open[1]);
      return true;
    }
    const clickMatch = text.match(/^(?:click|tap|press)\s+(?:on\s+)?(.+)$/i);
    if (clickMatch) {
      await click(clickMatch[1]);
      return true;
    }
    const typeMatch = text.match(/^type\s+["“]?(.+?)["”]?(?:\s+(?:into|in)\s+(.+))?$/i);
    if (typeMatch) {
      await typeInto(typeMatch[1], typeMatch[2]?.trim());
      return true;
    }
    if (/^(enter|submit|search now)$/i.test(text)) {
      await pressEnter();
      return true;
    }
    if (/^(scroll down|page down)$/i.test(text)) {
      await scrollPage(600);
      return true;
    }
    if (/^(scroll up|page up)$/i.test(text)) {
      await scrollPage(-600);
      return true;
    }
    if (lower === "back") {
      step("back");
      return true;
    }
    if (lower === "forward") {
      step("forward");
      return true;
    }
    if (lower === "reload" || lower === "refresh") {
      reload();
      return true;
    }
    return false;
  };

  const submitAsk = async (event: FormEvent) => {
    event.preventDefault();
    const text = aiDraft.trim();
    if (!text) return;
    setAiDraft("");
    openAssistant();
    if (await agentStep(text)) return;
    await ensurePage();
    window.dispatchEvent(new CustomEvent("lantas:ask", { detail: { text } }));
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
                  {data.history.length > 0 && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setData((current) => ({ ...current, history: [] }))}
                    >
                      Clear
                    </button>
                  )}
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
                  Sites like Notion and Google refuse to load inside a web frame. Use Lantas
                  Browser's own engine, or the Chrome engine where Lantas drives the tab you
                  already have open.
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
            <header className="el-ai-head">
              <div className="el-ai-id">
                <img className="el-ai-mark" src="/mark.png" alt="" />
                <div className="el-ai-who">
                  <span className="el-ai-title">Lantas</span>
                  <small>{aiModel}</small>
                </div>
              </div>
              <button
                type="button"
                className="el-round"
                onClick={() => setAiOpen(false)}
                aria-label="Close assistant"
              >
                <Icon name="close" size={12} />
              </button>
            </header>

            <div className="el-ai-log" ref={aiLogRef}>
              {aiMessages.length === 0 ? (
                <div className="el-ai-empty">
                  <p className="el-ai-lead">Ask about this page, or say what to click.</p>
                  <div className="el-ai-chips">
                    <button type="button" onClick={() => ask()}>
                      Summarize this page
                    </button>
                    <button type="button" onClick={() => ask("What can I do on this page?")}>
                      What can I do here
                    </button>
                    <button
                      type="button"
                      onClick={() => ask("Find the main action on this page and click it.")}
                    >
                      Do the main action
                    </button>
                  </div>
                </div>
              ) : (
                aiMessages.map((message) => (
                  <div key={message.id} className={cx("el-ai-msg", message.role)}>
                    <span className="el-ai-role">
                      {message.role === "user" ? "You" : "Lantas"}
                    </span>
                    {message.parts.map((part) =>
                      part.kind === "text" || part.kind === "note" ? (
                        <p key={part.id}>{part.text}</p>
                      ) : null,
                    )}
                    {message.streaming && (
                      <span className="el-ai-typing">
                        <i />
                        <i />
                        <i />
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>

            <form className="el-ai-form" onSubmit={submitAsk}>
              <input
                value={aiDraft}
                onChange={(event) => setAiDraft(event.target.value)}
                placeholder={driving ? "Ask, or tell it what to do" : "You have control"}
                spellCheck={false}
                aria-label="Ask Lantas"
              />
              <button
                type="submit"
                className="el-ai-send"
                disabled={!aiDraft.trim()}
                aria-label="Send"
              >
                <Icon name="arrowUp" size={13} />
              </button>
            </form>

            <div className="el-ai-foot">
              <button
                type="button"
                className={cx("el-switch", driving && "is-on")}
                role="switch"
                aria-checked={driving}
                onClick={toggleControl}
              >
                <span className="el-switch-track">
                  <span className="el-switch-thumb" />
                </span>
                {driving ? "Agent can drive" : "You have control"}
              </button>
              <span className="el-ai-hint">“open …”, “click …”, “type …”, “scroll down”</span>
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
