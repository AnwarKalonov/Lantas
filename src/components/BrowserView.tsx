import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { getGoogleToken, listMail, type MailItem } from "../lib/google";
import { openExternal } from "../lib/native";
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
import { cx, uid } from "../lib/util";
import { Icon } from "./Icons";

const QUICK = [
  { label: "GitHub", url: "https://github.com", note: "Repos, issues, PRs" },
  { label: "MDN", url: "https://developer.mozilla.org", note: "Web reference" },
  { label: "Hacker News", url: "https://news.ycombinator.com", note: "What shipped" },
  { label: "Google", url: "https://www.google.com", note: "Search" },
];

export function BrowserView() {
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
  const frameKey = useRef(0);

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
      notify("Read the page first, then ask about it", "error");
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
        .slice(0, 6),
    [data.history],
  );

  return (
    <section className={cx("el", mode === "reader" && "is-reader")}>
      <div className="el-tabs">
        <div className="el-tab-strip">
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
              <span className="el-tab-dot" />
              <span className="el-tab-title">{tab.title || hostOf(tab.url)}</span>
              <button
                type="button"
                className="el-tab-close"
                aria-label="Close tab"
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                <Icon name="close" size={11} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="el-tab-new"
            onClick={() => newTab()}
            aria-label="New tab"
          >
            <Icon name="plus" size={13} />
          </button>
        </div>
        <div className="el-brand">
          <span className="el-wordmark">El</span>
          <span className="el-tag">browser</span>
        </div>
      </div>

      <div className="el-bar">
        <button
          type="button"
          className="bar-icon"
          onClick={() => navigate(EL_HOME)}
          aria-label="Home"
          title="Start page"
        >
          <Icon name="panelLeft" size={14} />
        </button>
        <form
          className="el-url"
          onSubmit={(event) => {
            event.preventDefault();
            navigate(draft);
          }}
        >
          <Icon name="compass" size={13} />
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Search or enter an address"
            spellCheck={false}
            aria-label="El address bar"
          />
        </form>
        <button
          type="button"
          className="bar-icon"
          onClick={() => void reader()}
          disabled={busy || atHome}
          title="Read this page as text and hand it to the model"
          aria-label="Reader"
        >
          <Icon name="book" size={14} />
        </button>
        <button
          type="button"
          className={cx("bar-icon", bookmarked && "is-on")}
          onClick={toggleBookmark}
          disabled={atHome}
          title={bookmarked ? "Remove bookmark" : "Bookmark"}
          aria-label="Bookmark"
        >
          <Icon name="book" size={14} />
        </button>
        <button
          type="button"
          className="bar-icon"
          onClick={() => setReloadTick((tick) => tick + 1)}
          title="Reload"
          aria-label="Reload"
        >
          <Icon name="refresh" size={14} />
        </button>
        <button
          type="button"
          className="bar-icon"
          onClick={() => !atHome && openExternal(active.url)}
          disabled={atHome}
          title="Open in your default browser"
          aria-label="Open externally"
        >
          <Icon name="external" size={14} />
        </button>
      </div>

      {error && <p className="status-line is-error el-error">{error}</p>}

      <div className="el-body">
        {atHome ? (
          <div className="el-home">
            <div className="el-hero">
              <span className="el-hero-word">El</span>
              <p>Your own browser. Ask the model about any page it reads here.</p>
            </div>

            <form
              className="el-search"
              onSubmit={(event) => {
                event.preventDefault();
                const input = new FormData(event.currentTarget).get("q");
                if (typeof input === "string" && input.trim()) navigate(input);
              }}
            >
              <Icon name="search" size={15} />
              <input name="q" placeholder="Search the web or enter a URL" spellCheck={false} />
              <button type="submit" className="button-primary">
                Go
              </button>
            </form>

            <div className="el-quick">
              {QUICK.map((item) => (
                <button
                  key={item.url}
                  type="button"
                  className="el-quick-card"
                  onClick={() => navigate(item.url)}
                >
                  <span>{item.label}</span>
                  <small>{item.note}</small>
                </button>
              ))}
            </div>

            <div className="el-home-grid">
              <section className="el-card">
                <div className="el-card-head">
                  <h3>Profile</h3>
                  <span className="tag">local</span>
                </div>
                {data.profile ? (
                  <>
                    <p className="el-profile-name">{data.profile.name}</p>
                    <p className="el-muted">{data.profile.email}</p>
                    <div className="el-actions">
                      <button
                        type="button"
                        className="button-quiet"
                        onClick={() => void importMail()}
                      >
                        Import Gmail inbox
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => {
                          setData((current) => ({ ...current, profile: null }));
                          setMail([]);
                        }}
                      >
                        Sign out
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="el-muted">
                      Sign in with an email to keep bookmarks, history and imported mail under one
                      profile. It lives on this Mac — El has no account server.
                    </p>
                    {profileOpen ? (
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
                        <div className="el-actions">
                          <button type="button" className="button-primary" onClick={signIn}>
                            Save profile
                          </button>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => setProfileOpen(false)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="el-actions">
                        <button
                          type="button"
                          className="button-primary"
                          onClick={() => setProfileOpen(true)}
                        >
                          Sign in with email
                        </button>
                        <button
                          type="button"
                          className="button-quiet"
                          onClick={() => window.dispatchEvent(new CustomEvent("lantas:gmail"))}
                        >
                          Continue with Gmail
                        </button>
                      </div>
                    )}
                  </>
                )}
                {mail.length > 0 && (
                  <ul className="el-mail">
                    {mail.slice(0, 4).map((item) => (
                      <li key={item.id}>
                        <span>{item.subject}</span>
                        <small>{item.from.replace(/<.*>/, "").trim()}</small>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="el-card">
                <div className="el-card-head">
                  <h3>Bookmarks</h3>
                  <span className="tag">{data.bookmarks.length}</span>
                </div>
                {data.bookmarks.length === 0 && <p className="el-muted">Nothing saved yet.</p>}
                <ul className="el-links">
                  {data.bookmarks.slice(0, 5).map((item) => (
                    <li key={item.url}>
                      <button type="button" onClick={() => navigate(item.url)}>
                        <span>{item.title || hostOf(item.url)}</span>
                        <small>{hostOf(item.url)}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="el-card">
                <div className="el-card-head">
                  <h3>Recent</h3>
                  <span className="tag">{data.history.length}</span>
                </div>
                {recent.length === 0 && <p className="el-muted">Pages you open show up here.</p>}
                <ul className="el-links">
                  {recent.map((visit) => (
                    <li key={visit.url}>
                      <button type="button" onClick={() => navigate(visit.url)}>
                        <span>{visit.title}</span>
                        <small>{hostOf(visit.url)}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        ) : mode === "reader" && page ? (
          <div className="el-reader">
            <div className="el-reader-head">
              <div>
                <h2>{page.title}</h2>
                <p className="el-muted">
                  {hostOf(page.url)} · {page.words.toLocaleString()} words · read through El
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
          <div className="el-frame-wrap">
            <iframe
              key={`${active.id}-${reloadTick}`}
              className="el-frame"
              src={active.url}
              title={active.title}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
            />
            <div className="el-frame-foot">
              <span className="el-muted">{hostOf(active.url)} · embedded page</span>
              <div className="el-actions">
                <button type="button" className="button-quiet" onClick={() => void reader()}>
                  {busy ? "Reading" : "Reader + AI"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="el-foot">
        <span className="status-dot is-ok" />
        <span>{page ? `El has “${page.title.slice(0, 48)}” ready for the model` : "El is idle"}</span>
        <span className="el-foot-spacer" />
        <button type="button" className="text-button" onClick={ask} disabled={!page}>
          Ask the model about this page
        </button>
      </div>
    </section>
  );
}
