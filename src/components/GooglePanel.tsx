import { inTauri } from "../lib/native";
import { useEffect, useState } from "react";
import {
  clearGoogleToken,
  consumeGoogleHash,
  getGoogleClient,
  getGoogleToken,
  listMail,
  setGoogleClient,
  startGoogleAuth,
  type MailItem,
} from "../lib/google";
import { useStore } from "../lib/store";
import { Icon } from "./Icons";

export function GooglePanel() {
  const { notify } = useStore();
  const [client, setClient] = useState(getGoogleClient());
  const [connected, setConnected] = useState(Boolean(getGoogleToken()));
  const [mail, setMail] = useState<MailItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setBusy(true);
    setError("");
    try {
      setMail(await listMail());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (consumeGoogleHash()) {
      setConnected(true);
      notify("Gmail connected");
    }
    if (getGoogleToken()) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="gh-panel">
      <div className="gh-head">
        <div>
          <h2>Google · Gmail</h2>
          <p className="gh-lede">
            Read-only inbox access through your own OAuth client. The token stays on this machine.
          </p>
        </div>
        {connected ? (
          <div className="gh-account">
            <span className="status-dot is-ok" />
            <span>gmail</span>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                clearGoogleToken();
                setConnected(false);
                setMail([]);
              }}
            >
              Disconnect
            </button>
          </div>
        ) : (
          <span className="tag">not connected</span>
        )}
      </div>

      {!connected && (
        <div className="gh-connect">
          <label className="field">
            <span>OAuth client ID (Web application)</span>
            <input
              value={client}
              onChange={(event) => setClient(event.target.value)}
              placeholder="1234567890-abc.apps.googleusercontent.com"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <div className="gh-connect-actions">
            <button
              type="button"
              className="button-quiet"
              onClick={() => {
                setGoogleClient(client);
                notify("Client ID saved");
              }}
            >
              Save
            </button>
            <button
              type="button"
              className="button-primary"
              onClick={() => {
                setGoogleClient(client);
                const problem = startGoogleAuth();
                if (problem) notify(problem, "error");
              }}
            >
              Connect Gmail
            </button>
            <a
              className="text-button"
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noreferrer"
            >
              Create a client
            </a>
          </div>
          <p className="page-note">
            Add <code>{window.location.origin}{window.location.pathname}</code> as an authorised
            redirect URI, and enable the Gmail API.
          </p>
          {inTauri() && (
            <p className="page-note">
              In the desktop app, use the Composio Gmail card instead. Google sign-in needs a
              hosted redirect, which the packaged app does not have.
            </p>
          )}
        </div>
      )}

      {error && <p className="status-line is-error">{error}</p>}

      {connected && (
        <div className="mail-list">
          {busy && <p className="page-note">Reading inbox…</p>}
          {!busy && mail.length === 0 && <p className="page-note">No unread mail.</p>}
          {mail.map((item) => (
            <div className="mail-item" key={item.id}>
              <div className="mail-top">
                <Icon name="message" size={13} />
                <span className="mail-subject">{item.subject}</span>
                <span className="mail-date">{item.date.slice(5, 16)}</span>
              </div>
              <div className="mail-from">{item.from}</div>
              <div className="mail-snippet">{item.snippet}</div>
            </div>
          ))}
          <button type="button" className="button-quiet" onClick={() => void load()}>
            Refresh inbox
          </button>
        </div>
      )}
    </section>
  );
}
