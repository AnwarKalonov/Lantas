import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { Icon } from "./Icons";

const QUICK = [
  { label: "GitHub", url: "https://github.com" },
  { label: "MDN", url: "https://developer.mozilla.org" },
  { label: "Google", url: "https://www.google.com" },
  { label: "Hacker News", url: "https://news.ycombinator.com" },
];

export function BrowserView() {
  const { state, setBrowserUrl, notify } = useStore();
  const [draft, setDraft] = useState(state.browserUrl);
  const [frameKey, setFrameKey] = useState(0);
  const history = useRef<string[]>([state.browserUrl]);
  const index = useRef(0);

  useEffect(() => setDraft(state.browserUrl), [state.browserUrl]);

  const go = (raw: string) => {
    const url = /^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
    if (!/^https?:\/\/\S+\.\S+/.test(url)) {
      notify("That does not look like a URL", "error");
      return;
    }
    setBrowserUrl(url);
    setDraft(url);
    history.current = [...history.current.slice(0, index.current + 1), url];
    index.current = history.current.length - 1;
    setFrameKey((key) => key + 1);
  };

  const step = (delta: number) => {
    const next = index.current + delta;
    if (next < 0 || next >= history.current.length) return;
    index.current = next;
    setBrowserUrl(history.current[next]);
    setDraft(history.current[next]);
    setFrameKey((key) => key + 1);
  };

  return (
    <section className="browser-view">
      <div className="browser-bar">
        <button
          type="button"
          className="bar-icon"
          onClick={() => step(-1)}
          disabled={index.current === 0}
          aria-label="Back"
        >
          <Icon name="chevronRight" size={14} className="flip-x" />
        </button>
        <button
          type="button"
          className="bar-icon"
          onClick={() => step(1)}
          disabled={index.current >= history.current.length - 1}
          aria-label="Forward"
        >
          <Icon name="chevronRight" size={14} />
        </button>
        <button
          type="button"
          className="bar-icon"
          onClick={() => setFrameKey((key) => key + 1)}
          aria-label="Reload"
        >
          <Icon name="refresh" size={14} />
        </button>

        <form
          className="browser-url"
          onSubmit={(event) => {
            event.preventDefault();
            go(draft);
          }}
        >
          <Icon name="compass" size={13} />
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Enter a URL for the agent to open"
            spellCheck={false}
            aria-label="Browser address"
          />
        </form>

        <a
          className="bar-icon"
          href={state.browserUrl}
          target="_blank"
          rel="noreferrer"
          title="Open in your browser"
          aria-label="Open externally"
        >
          <Icon name="external" size={14} />
        </a>
      </div>

      <div className="browser-frame-wrap">
        <iframe
          key={frameKey}
          className="browser-frame"
          src={state.browserUrl}
          title="Built-in browser"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
          referrerPolicy="no-referrer"
        />
        <div className="browser-hint">
          Some sites refuse to be embedded. Use the arrow to open them in your browser, or ask
          Lantas to <code>browse to …</code>
          and it will load here.
        </div>
      </div>

      <div className="browser-quick">
        {QUICK.map((item) => (
          <button key={item.url} type="button" className="chip" onClick={() => go(item.url)}>
            {item.label}
          </button>
        ))}
      </div>
    </section>
  );
}
