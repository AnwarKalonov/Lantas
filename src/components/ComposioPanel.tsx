import { useEffect, useMemo, useState } from "react";
import {
  TOOLKITS,
  connectToolkit,
  fetchInbox,
  getComposio,
  listConnections,
  revokeConnection,
  setComposio,
  verifyComposio,
  type Connection,
  type InboxItem,
} from "../lib/composio";
import { inTauri, openExternal } from "../lib/native";
import { useStore } from "../lib/store";
import { cx } from "../lib/util";
import { Icon } from "./Icons";

export function ComposioPanel() {
  const { notify } = useStore();
  const stored = getComposio();
  const [apiKey, setApiKey] = useState(stored?.apiKey ?? "");
  const [userId, setUserId] = useState(stored?.userId ?? "lantas-user");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const connected = Boolean(stored?.apiKey);

  const byToolkit = useMemo(() => {
    const map = new Map<string, Connection>();
    connections.forEach((item) => {
      if (item.status === "ACTIVE") map.set(item.toolkit, item);
    });
    return map;
  }, [connections]);

  const refresh = async () => {
    if (!getComposio()) return;
    setBusy("sync");
    setError("");
    try {
      setConnections(await listConnections());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (connected) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(async () => {
      try {
        const next = await listConnections();
        setConnections(next);
        if (next.some((item) => item.toolkit === pending && item.status === "ACTIVE")) {
          setPending(null);
          notify(`${pending} connected`);
        }
      } catch {
        /* keep polling */
      }
    }, 4000);
    const stop = window.setTimeout(() => setPending(null), 180_000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const save = async () => {
    setComposio({ apiKey: apiKey.trim(), userId: userId.trim() || "lantas-user" });
    if (!apiKey.trim()) return;
    setBusy("key");
    setError("");
    try {
      const count = await verifyComposio();
      notify(count ? `Composio connected · ${count} toolkits` : "Composio key accepted");
      await refresh();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(
        /failed to fetch|network/i.test(message) && !inTauri()
          ? "The web preview blocks Composio's API with CORS. The desktop build calls it through Rust, so this works in the .app — the key is saved and will verify there."
          : message,
      );
    } finally {
      setBusy(null);
    }
  };

  const connect = async (slug: string) => {
    setBusy(slug);
    setError("");
    try {
      const { url } = await connectToolkit(slug);
      openExternal(url);
      setPending(slug);
      notify("Finish the sign-in in your browser");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  };

  const readInbox = async () => {
    setBusy("inbox");
    setError("");
    try {
      const items = await fetchInbox(6);
      setInbox(items);
      if (!items.length) notify("No unread mail returned");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="gh-panel composio">
      <div className="gh-head">
        <div>
          <h2>Composio</h2>
          <p className="gh-lede">
            One key, real OAuth for Gmail, Slack, Notion, Calendar and the rest. Composio holds the
            app credentials; this machine only holds your project key.
          </p>
        </div>
        {connected ? (
          <div className="gh-account">
            <span className="status-dot is-ok" />
            <span>{byToolkit.size} connected</span>
            <button type="button" className="text-button" onClick={() => void refresh()}>
              {busy === "sync" ? "Syncing" : "Refresh"}
            </button>
          </div>
        ) : (
          <span className="tag">needs a key</span>
        )}
      </div>

      <div className="composio-key">
        <label className="field">
          <span>Composio API key</span>
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="comp_…"
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <label className="field">
          <span>User id</span>
          <input
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            placeholder="you@example.com"
            spellCheck={false}
          />
        </label>
        <button
          type="button"
          className="button-primary"
          onClick={() => void save()}
          disabled={busy === "key"}
        >
          {busy === "key" ? "Checking" : connected ? "Save key" : "Connect"}
        </button>
        <a
          className="text-button"
          href="https://platform.composio.dev"
          target="_blank"
          rel="noreferrer"
        >
          Get a key
        </a>
      </div>

      {error && <p className="status-line is-error">{error}</p>}

      {connected && (
        <>
          <div className="composio-grid">
            {TOOLKITS.map((toolkit) => {
              const account = byToolkit.get(toolkit.slug);
              const working = busy === toolkit.slug || pending === toolkit.slug;
              return (
                <div className={cx("composio-card", account && "is-on")} key={toolkit.slug}>
                  <div className="composio-card-text">
                    <span className="composio-name">{toolkit.name}</span>
                    <small>{toolkit.blurb}</small>
                  </div>
                  {account ? (
                    <button
                      type="button"
                      className="text-button"
                      onClick={async () => {
                        await revokeConnection(account.id);
                        notify(`${toolkit.name} disconnected`);
                        void refresh();
                      }}
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="button-quiet"
                      disabled={working}
                      onClick={() => void connect(toolkit.slug)}
                    >
                      {working ? "Waiting" : "Connect"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {pending && (
            <p className="page-note">
              Waiting for the OAuth window for <b>{pending}</b> to finish. This panel checks every
              few seconds.
            </p>
          )}

          {byToolkit.has("gmail") && (
            <div className="composio-inbox">
              <div className="section-head">
                <h3>Gmail through Composio</h3>
                <button
                  type="button"
                  className="button-quiet"
                  onClick={() => void readInbox()}
                  disabled={busy === "inbox"}
                >
                  {busy === "inbox" ? "Reading" : "Load unread"}
                </button>
              </div>
              {inbox.length === 0 ? (
                <p className="page-note">
                  Unread messages appear here, and the chat can read them with{" "}
                  <code>summarize my inbox</code>.
                </p>
              ) : (
                <ul className="composio-mail">
                  {inbox.map((item, index) => (
                    <li key={`${item.subject}-${index}`}>
                      <Icon name="message" size={12} />
                      <span className="composio-mail-subject">{item.subject}</span>
                      <small>{item.from}</small>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
