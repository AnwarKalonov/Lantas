import { useEffect, useMemo, useState } from "react";
import {
  CATALOG,
  appKeyPresent,
  connectToolkit,
  fetchInbox,
  listConnections,
  revokeConnection,
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
  const ready = appKeyPresent();

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
    if (ready) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const readInbox = async () => {
    setBusy("inbox");
    try {
      setInbox(await fetchInbox(6));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
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
            Connect the apps you already use. Authorization runs through Composio; Lantas holds the
            app key so you never configure one.
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
            </>
          ) : (
            <span className="tag">app key required</span>
          )}
        </div>
      </div>

      {!ready && (
        <div className="market-notice">
          <Icon name="settings" size={14} />
          <span>
            This build has no Composio key baked in. The maintainer adds{" "}
            <code>COMPOSIO_API_KEY</code> as a repository secret and the macOS workflow injects it
            at build time — nobody using the app enters a key.
          </span>
        </div>
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
              <div className="market-logo">
                <AppLogo slug={app.icon} name={app.name} size={22} eager />
              </div>
              <div className="market-card-text">
                <h3>{app.name}</h3>
                <p>{app.blurb}</p>
                <span className="market-cat">{app.category}</span>
              </div>
              {account ? (
                <div className="market-card-foot">
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
                </div>
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
            </article>
          );
        })}
        {visible.length === 0 && <p className="market-empty">No integrations match that search.</p>}
      </div>

      {active.has("gmail") && (
        <div className="market-inbox">
          <div className="section-head">
            <h3>Gmail</h3>
            <button
              type="button"
              className="button-quiet"
              onClick={() => void readInbox()}
              disabled={busy === "inbox"}
            >
              {busy === "inbox" ? "Reading" : "Read unread"}
            </button>
          </div>
          {inbox.length === 0 ? (
            <p className="page-note">
              Ask the chat <code>summarize my inbox</code> and it reads through this connection.
            </p>
          ) : (
            <ul className="market-mail">
              {inbox.map((item, index) => (
                <li key={`${item.subject}-${index}`}>
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
