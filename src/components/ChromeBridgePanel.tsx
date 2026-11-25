import { useEffect, useRef, useState } from "react";
import {
  chromeCommand,
  chromeExtensionPath,
  revealChromeExtension,
  type ChromeElement,
  type ChromeStatus,
} from "../lib/chrome";
import { hostOf } from "../lib/el";
import { inTauri } from "../lib/native";
import { cx } from "../lib/util";
import { Icon } from "./Icons";

function shortUrl(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname === "/" ? "" : parsed.pathname}`.slice(
      0,
      72,
    );
  } catch {
    return url;
  }
}

/**
 * The Chrome engine: when the extension is connected the panel mirrors the
 * tab Lantas is driving; before that it walks through loading the extension.
 */
export function ChromeBridgePanel({
  status,
  onRefresh,
  onAsk,
}: {
  status: ChromeStatus;
  onRefresh: () => void | Promise<void>;
  onAsk: (text: string) => void;
}) {
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const attempted = useRef("");

  useEffect(() => {
    if (!path) void chromeExtensionPath().then(setPath);
  }, [path]);

  const run = async (label: string, task: () => Promise<unknown>) => {
    setBusy(label);
    setNote("");
    try {
      await task();
      await onRefresh();
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  };

  const read = () =>
    run("read", async () => {
      const result = await chromeCommand("read");
      setNote(result.detail ? `${result.detail}` : "Page ready for the model");
    });

  // Read the tab once when the panel first sees it, so the model has context.
  useEffect(() => {
    const url = status.active?.url || "";
    if (!status.connected || !/^https?:/i.test(url)) return;
    if (status.page?.url === url) return;
    if (attempted.current === url) return;
    attempted.current = url;
    void run("read", async () => {
      await chromeCommand("read");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.connected, status.active?.url, status.page?.url]);

  const clickElement = (element: ChromeElement) =>
    run(`click-${element.i}`, async () => {
      const result = await chromeCommand("act", {
        action: "click",
        selector: element.selector,
        index: element.i,
      });
      setNote(result.detail || `Clicked ${element.label}`);
    });

  const reveal = () =>
    run("reveal", async () => {
      const target = await revealChromeExtension();
      if (target) setPath(target);
      else setNote("The extension folder was not found next to the app.");
    });

  const copyPath = async () => {
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      setNote("Extension folder copied");
    } catch {
      setNote("Could not copy — open the folder instead.");
    }
  };

  const active = status.active;
  const connected = status.connected;

  // The web build has no native bridge; the desktop app is the real thing.
  if (!inTauri()) {
    return (
      <div className="el-chrome-panel">
        <div className="el-chrome-statusbar">
          <span className="el-chrome-dot" />
          <span className="el-chrome-status-text">Desktop app required</span>
        </div>
        <div className="el-chrome-card">
          <h2>Drive Chrome from the Lantas app</h2>
          <p>
            This is the browser preview. Install Lantas.app, open Browser → Chrome, and load the
            extension once from the folder that panel shows. Chrome keeps your logins, and the
            agent works in the tab you already have open.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="el-chrome-panel">
      <div className="el-chrome-statusbar">
        <span className={cx("el-chrome-dot", connected && "is-on")} />
        <span className="el-chrome-status-text">
          {connected
            ? `Chrome connected · ${status.tabs.length} tabs`
            : status.running
              ? "Chrome extension not connected"
              : "Chrome bridge is not running"}
        </span>
        <button
          type="button"
          className="el-round"
          onClick={() => void onRefresh()}
          title="Refresh Chrome state"
          aria-label="Refresh Chrome state"
        >
          <Icon name="refresh" size={12} />
        </button>
      </div>

      {!status.running && (
        <div className="el-chrome-card">
          <h2>The bridge did not start</h2>
          <p>
            {status.error ||
              "Lantas listens on 127.0.0.1 for the Chrome extension but could not open the port."}
          </p>
        </div>
      )}

      {status.running && !connected && (
        <div className="el-chrome-card">
          <div className="el-chrome-intro">
            <span className="el-chrome-glyph">
              <Icon name="plug" size={16} />
            </span>
            <div>
              <h2>Drive your own Chrome</h2>
              <p>
                Load the Lantas extension once. After that the agent reads the tab you are on and
                can click, type and scroll in it, with your logins and tabs intact.
              </p>
            </div>
          </div>

          <ol className="el-chrome-steps">
            <li>
              <span>1</span>
              <div>
                <strong>Open Chrome&apos;s extensions page</strong>
                <small>
                  Paste <code>chrome://extensions</code> into Chrome&apos;s address bar.
                </small>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Turn on Developer mode</strong>
                <small>The switch sits in the top right corner.</small>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Load the Lantas extension</strong>
                <small>Click “Load unpacked”, then choose the folder below.</small>
              </div>
            </li>
            <li>
              <span>4</span>
              <div>
                <strong>Keep Chrome open</strong>
                <small>
                  The extension connects on its own; this panel turns green. Tabs it opens go in a
                  blue “agents” tab group, and the panel’s Agents button starts that workspace.
                </small>
              </div>
            </li>
          </ol>

          <div className="el-chrome-path">
            <code>{path || "Locating the extension folder…"}</code>
            <div className="el-actions">
              <button
                type="button"
                className="button-quiet"
                onClick={() => void reveal()}
                disabled={busy === "reveal"}
              >
                Show folder
              </button>
              <button type="button" className="button-quiet" onClick={() => void copyPath()}>
                Copy path
              </button>
            </div>
          </div>

          <div className="el-chrome-foot">
            <button type="button" className="button-primary" onClick={() => void onRefresh()}>
              Check again
            </button>
            <span className="el-chrome-muted">Listening on 127.0.0.1:{status.port}</span>
          </div>
        </div>
      )}

      {connected && (
        <>
          <div className="el-chrome-card">
            <div className="el-chrome-tabrow">
              <span className="el-chrome-favicon">
                {active ? hostOf(active.url).charAt(0).toUpperCase() : "?"}
              </span>
              <div className="el-chrome-tabtext">
                <strong>{active?.title || "No website open"}</strong>
                <small>{active ? shortUrl(active.url) : "Open a page in Chrome"}</small>
              </div>
              <div className="el-actions">
                <button
                  type="button"
                  className="button-quiet"
                  disabled={!active || busy === "focus"}
                  onClick={() =>
                    active &&
                    void run("focus", () => chromeCommand("activate", { tabId: active.id }))
                  }
                >
                  Focus
                </button>
                <button
                  type="button"
                  className="button-quiet"
                  disabled={!active || busy === "reload"}
                  onClick={() =>
                    active &&
                    void run("reload", () => chromeCommand("reload", { tabId: active.id }))
                  }
                >
                  Reload
                </button>
              </div>
            </div>
          </div>

          {status.page ? (
            <>
              <div className="el-chrome-card">
                <div className="el-chrome-section-head">
                  <span>Page for the model</span>
                  <small>
                    {status.page.words.toLocaleString()} words · {status.elements.length} controls
                  </small>
                </div>
                <p className="el-chrome-snippet">{status.page.text.slice(0, 420)}</p>
                <div className="el-chrome-foot">
                  <button
                    type="button"
                    className="button-quiet"
                    onClick={() => void read()}
                    disabled={busy === "read"}
                  >
                    Read again
                  </button>
                  <button
                    type="button"
                    className="button-quiet"
                    onClick={() => onAsk("Summarize this page and tell me what matters.")}
                  >
                    Ask AI about it
                  </button>
                </div>
              </div>

              {status.elements.length > 0 && (
                <div className="el-chrome-card">
                  <div className="el-chrome-section-head">
                    <span>Clickable on this page</span>
                    <small>click to act</small>
                  </div>
                  <div className="el-chrome-targets">
                    {status.elements.slice(0, 10).map((element) => (
                      <button
                        key={`${element.i}-${element.selector}`}
                        type="button"
                        className="el-chrome-target"
                        onClick={() => void clickElement(element)}
                        disabled={busy === `click-${element.i}`}
                      >
                        <span>{element.label || element.tag}</span>
                        <small>{element.kind}</small>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="el-chrome-card el-chrome-empty">
              <p>Lantas has not read this tab yet.</p>
              <button
                type="button"
                className="button-primary"
                onClick={() => void read()}
                disabled={busy === "read"}
              >
                {busy === "read" ? "Reading…" : "Read page"}
              </button>
            </div>
          )}

          {status.events.length > 0 && (
            <div className="el-chrome-log">
              {status.events
                .filter((event) => event.type !== "ping")
                .slice(-4)
                .reverse()
                .map((event, index) => (
                  <div className={cx("el-chrome-logrow", event.ok === false && "is-error")} key={index}>
                    <span>{event.ok === false ? "Failed" : event.detail || event.type}</span>
                    {event.detail && event.ok === false && <small>{event.detail}</small>}
                    {event.error && <small>{event.error}</small>}
                  </div>
                ))}
            </div>
          )}

          <p className="el-chrome-hint">
            In Ask AI: “click Sign in”, “type hello into the search box”, “scroll down”, “open
            notion.so”.
          </p>
        </>
      )}

      {note && (
        <p className={cx("el-chrome-note", /could not|not found|no answer|failed/i.test(note) && "is-error")}>
          {note}
        </p>
      )}
    </div>
  );
}
