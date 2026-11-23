import { useEffect, useMemo, useState } from "react";
import {
  CATALOG,
  keyPresent,
  connectToolkit,
  fetchInboxPage,
  listConnections,
  revokeConnection,
  setComposioKey,
  type Connection,
  type InboxItem,
  type IntegrationCategory,
} from "../lib/composio";
import { inTauri, openExternal } from "../lib/native";
import { useStore } from "../lib/store";
import { cx } from "../lib/util";
import { AppLogo } from "./AppLogo";
import { Icon } from "./Icons";

const CATEGORIES: Array<IntegrationCategory | "All"> = [
  "All",
  "Communication",
  "Productivity",
  "Developer",
  "CRM",
  "Storage",
  "Social",
];

export function ComposioPanel() {
  const { notify } = useStore();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<IntegrationCategory | "All">("All");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [inboxCursor, setInboxCursor] = useState<string | null>(null);
  const [inboxError, setInboxError] = useState("");
  const [hasKey, setHasKey] = useState(() => keyPresent());
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [keyError, setKeyError] = useState("");
  const ready = hasKey;

  const active = useMemo(() => {
    const map = new Map<string, Connection>();
    connections.forEach((item) => {
      if (item.status === "ACTIVE") map.set(item.toolkit, item);
    });
    return map;
  }, [connections]);

  const refresh = async () => {
    if (!ready) return;
    setBusy("sync");
    setError("");
    try {
      setConnections(await listConnections());
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(
        /failed to fetch|network/i.test(message) && !inTauri()
          ? "The web preview blocks Composio's API. The app calls it through Rust, so connections work in the desktop build."
          : message,
      );
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (hasKey) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasKey]);

  useEffect(() => {
    if (!pending) return;
    const poll = window.setInterval(async () => {
      try {
        const next = await listConnections();
        setConnections(next);
        if (next.some((item) => item.toolkit === pending && item.status === "ACTIVE")) {
          setPending(null);
          notify(`${pending} connected`);
        }
      } catch {
        /* keep waiting */
      }
    }, 4000);
    const stop = window.setTimeout(() => setPending(null), 180_000);
    return () => {
      window.clearInterval(poll);
      window.clearTimeout(stop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const saveKey = (event: React.FormEvent) => {
    event.preventDefault();
    const value = keyDraft.trim();
    if (!value) return;
    if (!/^ak_/.test(value)) {
      setKeyError("Composio project keys start with ak_");
      return;
    }
    setComposioKey(value);
    setHasKey(true);
    setKeyOpen(false);
    setKeyDraft("");
    setKeyError("");
    notify("Composio key saved on this Mac");
    void refresh();
  };

  const connect = async (app: string, name: string) => {
    setBusy(app);
    setError("");
    try {
      const url = await connectToolkit(app);
      openExternal(url);
      setPending(app);
      notify(`Finish connecting ${name} in your browser`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  };

  const readInbox = async (more = false) => {
    setBusy("inbox");
    setInboxError("");
    try {
      const page = await fetchInboxPage({
        limit: 25,
        cursor: more ? inboxCursor : null,
        query: "is:unread",
      });
      setInbox((current) => {
        const base = more ? current : [];
        const seen = new Set(base.map((item) => item.id));
        return [...base, ...page.items.filter((item) => !seen.has(item.id))];
      });
      setInboxCursor(page.nextCursor);
    } catch (caught) {
      setInboxError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  };

  const visible = CATALOG.filter(
    (app) =>
      (category === "All" || app.category === category) &&
      (query.trim()
        ? `${app.name} ${app.blurb} ${app.category}`
            .toLowerCase()
            .includes(query.trim().toLowerCase())
        : true),
  );

  return (
    <section className="market">
      <div className="market-head">
        <div>
          <h2>Marketplace</h2>
          <p className="market-lede">
            Connect the apps you already use. Each person adds their own Composio key once, and
            Lantas keeps it on this Mac.
          </p>
        </div>
        <div className="market-status">
          {ready ? (
            <>
              <span className="status-dot is-ok" />
              <span>{active.size} connected</span>
              <button type="button" className="text-button" onClick={() => void refresh()}>
                {busy === "sync" ? "Syncing" : "Refresh"}
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => setKeyOpen((open) => !open)}
              >
                Key
              </button>
            </>
          ) : (
            <span className="tag">Your key</span>
          )}
        </div>
      </div>

      {(!ready || keyOpen) && (
        <form className="market-key" onSubmit={saveKey}>
          <div>
            <h3>{ready ? "Replace your Composio key" : "Connect Composio"}</h3>
            <p>
              Paste your project API key from the Composio dashboard. It stays on this Mac and is
              only sent to Composio.
            </p>
          </div>
          <div className="market-key-row">
            <input
              type="password"
              value={keyDraft}
              onChange={(event) => setKeyDraft(event.target.value)}
              placeholder="ak_…"
              autoComplete="off"
              spellCheck={false}
              aria-label="Composio API key"
            />
            <button type="submit" className="button-primary" disabled={!keyDraft.trim()}>
              Save key
            </button>
            <a
              className="text-button"
              href="https://dashboard.composio.dev"
              target="_blank"
              rel="noreferrer"
            >
              Get a key
            </a>
          </div>
          {keyError && <p className="status-line is-error">{keyError}</p>}
        </form>
      )}

      <div className="market-toolbar">
        <label className="market-search">
          <Icon name="search" size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search integrations"
            spellCheck={false}
          />
        </label>
        <div className="market-tabs">
          {CATEGORIES.map((item) => (
            <button
              key={item}
              type="button"
              className={cx("market-tab", category === item && "is-active")}
              onClick={() => setCategory(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="status-line is-error">{error}</p>}
      {pending && (
        <p className="market-pending">
          Waiting for <b>{pending}</b> authorization… This updates automatically.
        </p>
      )}

      <div className="market-grid">
        {visible.map((app) => {
          const account = active.get(app.slug);
          const working = busy === app.slug || pending === app.slug;
          return (
            <article className={cx("market-card", account && "is-connected")} key={app.slug}>
              <div className="market-card-top">
                <div className="market-logo">
                  <AppLogo slug={app.icon} name={app.name} size={20} eager domain={app.domain} />
                </div>
                <div className="market-card-text">
                  <h3>{app.name}</h3>
                  <p>{app.blurb}</p>
                </div>
              </div>
              <div className="market-card-foot">
                <span className="market-cat">{app.category}</span>
                {account ? (
                  <span className="market-card-actions">
                    <span className="market-connected">
                      <Icon name="check" size={11} /> Connected
                    </span>
                    <button
                      type="button"
                      className="text-button"
                      onClick={async () => {
                        await revokeConnection(account.id);
                        notify(`${app.name} disconnected`);
                        void refresh();
                      }}
                    >
                      Disconnect
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="market-connect"
                    disabled={!ready || working}
                    onClick={() => void connect(app.slug, app.name)}
                  >
                    {working ? "Waiting…" : ready ? "Connect" : "Unavailable"}
                  </button>
                )}
              </div>
            </article>
          );
        })}
        {visible.length === 0 && <p className="market-empty">No integrations match that search.</p>}
      </div>

      {active.has("gmail") && (
        <div className="market-inbox">
          <div className="section-head">
            <h3>Gmail</h3>
            <span className="market-inbox-meta">
              {inbox.length > 0
                ? `${inbox.length} loaded${inboxCursor ? " · more available" : ""}`
                : "Unread, 25 at a time"}
            </span>
            <button
              type="button"
              className="button-quiet"
              onClick={() => void readInbox(inbox.length > 0)}
              disabled={busy === "inbox"}
            >
              {busy === "inbox"
                ? "Reading"
                : inbox.length > 0 && inboxCursor
                  ? "Load more"
                  : "Read unread"}
            </button>
          </div>
          {inboxError && <p className="status-line is-error">{inboxError}</p>}
          {inbox.length === 0 && !inboxError ? (
            <p className="page-note">
              Ask the chat <code>summarize my inbox</code> and it reads through this connection with
              pagination, not a fixed six-message sample.
            </p>
          ) : (
            <ul className="market-mail">
              {inbox.map((item) => (
                <li key={item.id}>
                  <Icon name="message" size={12} />
                  <span>{item.subject}</span>
                  <small>{item.from}</small>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
