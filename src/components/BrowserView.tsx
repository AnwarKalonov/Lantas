import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { getGoogleToken, listMail, type MailItem } from "../lib/google";
import {
  elBounds,
  elClick,
  elClose,
  elHistory,
  elOpen,
  elReload,
  elVisible,
  inTauri,
  openExternal,
} from "../lib/native";
import {
  EL_HOME,
  getElContext,
  hostOf,
  loadEl,
  normalizeUrl,
  readPage,
  saveEl,
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

function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function BrowserView({ visible = true }: { visible?: boolean }) {
  const { state, setBrowserUrl, notify } = useStore();
  const [data, setData] = useState<ElData>(() => loadEl());
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"live" | "reader">("live");
  const [page, setPage] = useState<ElPage | null>(getElContext());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState({ name: "", email: "" });
  const [mail, setMail] = useState<MailItem[]>([]);
  const [reloadTick, setReloadTick] = useState(0);
  const [nativeReady, setNativeReady] = useState(false);
  const [clickTarget, setClickTarget] = useState("");
  const [controlsOpen, setControlsOpen] = useState(false);
  const frameKey = useRef(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const trail = useRef<string[]>([EL_HOME]);
  const trailIndex = useRef(0);
  const native = inTauri();

  const active = data.tabs.find((tab) => tab.id === data.active) ?? data.tabs[0];
  const atHome = active.url === EL_HOME;

  useEffect(() => saveEl(data), [data]);

  useEffect(() => {
    if (state.browserUrl && state.browserUrl !== active.url) navigate(state.browserUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.browserUrl]);

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
    if (!visible) {
      void elVisible(false);
      return;
    }
    if (mode === "live" && !atHome) {
      void elVisible(true);
      const frame = requestAnimationFrame(() => {
        const rect = box();
        if (!rect) return;
        void elOpen(active.url, rect).then((ok) => setNativeReady(ok));
      });
      return () => cancelAnimationFrame(frame);
    }
    setNativeReady(false);
    void elClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native, visible, active.url, mode, atHome, data.active]);

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
    setMode("live");
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
    if (native) {
      void elHistory(direction);
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
    if (native) void elReload();
    setReloadTick((tick) => tick + 1);
  };

  const reader = async () => {
    if (atHome) return;
    setBusy(true);
    setError("");
    try {
      const next = await readPage(active.url);
      setPage(next);
      setElContext(next);
      setMode("reader");
      patchTab(active.id, { title: next.title });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `${caught.message} — this site cannot be read from the web preview. The desktop build reads it through the native bridge.`
          : String(caught),
      );
    } finally {
      setBusy(false);
    }
  };

  const ask = () => {
    const current = page ?? getElContext();
    if (!current) {
      notify("Open the reader on a page first", "error");
      return;
    }
    window.dispatchEvent(
      new CustomEvent("lantas:prompt", {
        detail: {
          text: `Using the page I have open in El (${current.title} — ${current.url}), `,
        },
      }),
    );
  };

  const click = async (target = clickTarget) => {
    if (!target.trim()) return;
    if (!native) {
      notify("Clicking needs the desktop app — the web preview cannot script pages", "error");
      return;
    }
    const ok = await elClick(target.trim());
    notify(ok ? `Clicked “${target.trim()}” in El` : "El could not click that", ok ? "default" : "error");
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
    notify("El profile saved on this Mac");
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
    <section className={cx("el", mode === "reader" && "is-reader")}>
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
          <span className="el-mini-wordmark">El</span>
          <button
            type="button"
            className={cx("el-avatar", data.profile && "is-signed")}
            onClick={() => setProfileOpen((open) => !open)}
            aria-label="El profile"
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
                  <p className="el-pop-title">Sign in to El</p>
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
            aria-label="El address bar"
          />
          {draft && <span className="el-enter">↵</span>}
        </form>

        <div className="el-tools">
          <button
            type="button"
            className="el-round"
            onClick={() => void reader()}
            disabled={busy || atHome}
            title="Reader — extract the page for the model"
            aria-label="Reader"
          >
            <Icon name="book" size={13} />
          </button>
          <button
            type="button"
            className={cx("el-round", bookmarked && "is-on")}
            onClick={toggleBookmark}
            disabled={atHome}
            title={bookmarked ? "Remove bookmark" : "Bookmark"}
            aria-label="Bookmark"
          >
            <Icon name="sparkle" size={13} />
          </button>
          <button
            type="button"
            className="el-round"
            onClick={() => !atHome && openExternal(active.url)}
            disabled={atHome}
            title="Open in your default browser"
            aria-label="Open externally"
          >
            <Icon name="external" size={13} />
          </button>
        </div>
      </div>

      {error && <p className="status-line is-error el-error">{error}</p>}

      <div className="el-body">
        {atHome ? (
          <div className="el-home">
            <div className="el-home-inner">
              <div className="el-greeting">
                <span className="el-mark">El</span>
                <h1>
                  {greeting()}
                  {data.profile ? `, ${data.profile.name.split(" ")[0]}` : ""}
                </h1>
                <p>A browser with a brain. Ask the model to read, search and click.</p>
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
        ) : mode === "reader" && page ? (
          <div className="el-reader">
            <div className="el-reader-head">
              <div>
                <p className="el-kicker">{hostOf(page.url)}</p>
                <h2>{page.title}</h2>
                <p className="el-muted">
                  {page.words.toLocaleString()} words · extracted by El
                </p>
              </div>
              <div className="el-actions">
                <button type="button" className="button-quiet" onClick={() => setMode("live")}>
                  Live page
                </button>
                <button type="button" className="button-primary" onClick={ask}>
                  Ask the model
                </button>
              </div>
            </div>
            {page.description && <p className="el-reader-desc">{page.description}</p>}
            <div className="el-reader-body">{page.text}</div>
          </div>
        ) : (
          <div className="el-viewport" ref={viewportRef}>
            {native ? (
              <div className={cx("el-engine", nativeReady && "is-ready")}>
                <span className="el-engine-mark">El</span>
                <span className="el-muted">
                  {nativeReady ? "Native page" : "Starting El's browser engine…"}
                </span>
              </div>
            ) : (
              <iframe
                key={`${active.id}-${reloadTick}`}
                className="el-frame"
                src={active.url}
                title={active.title}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
              />
            )}
            {!native && (
              <div className="el-viewport-note">
                Web preview: embedded frame. The desktop app runs a native browser engine, so
                Google and frame-blocking sites load and the model can click.
              </div>
            )}
          </div>
        )}
      </div>

      <div className="el-foot">
        <span className={cx("el-dot", native && "is-native")} />
        <span className="el-foot-status">
          {page ? `“${page.title.slice(0, 40)}” ready for the model` : native ? "Native engine" : "Web preview"}
        </span>
        <button
          type="button"
          className="el-foot-toggle"
          onClick={() => setControlsOpen((open) => !open)}
        >
          {controlsOpen ? "Hide controls" : "Click controls"}
        </button>
        <span className="el-foot-spacer" />
        <button type="button" className="text-button" onClick={ask} disabled={!page}>
          Ask about this page
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
            The model triggers this with <code>/click &lt;text&gt;</code>
          </span>
        </div>
      )}
    </section>
  );
}
