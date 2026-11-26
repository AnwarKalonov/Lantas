import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { inTauri, overlayHide, overlayShow } from "../lib/native";
import { acquireScreen, captureFrame, captureNativeScreen, currentScreen } from "../lib/screen";
import { isConfigured, streamChat, type ChatTurn } from "../lib/providers";
import { Icon } from "./Icons";
import { cx } from "../lib/util";

/**
 * Screen share, in a card that sits over the conversation.
 *
 * The frame is captured here and handed to the model as an image; nothing is
 * recorded, uploaded or kept after the question. A [[point]] in the answer is
 * drawn on the transparent overlay, so the reply can point at the thing it
 * means instead of describing it.
 */

interface ScreenPoint {
  x: number;
  y: number;
  label?: string;
}

const SYSTEM = [
  "You are Lantas, looking at one screenshot of the user's Mac screen.",
  "Answer what is actually visible in the image in one to three short sentences. Never guess about content you cannot see.",
  'If the user asks where something is, find it in the image and end the reply with exactly <point x="0.42" y="0.63" label="Log in" /> where x and y are fractions of the image width and height, 0,0 being the top-left. Use at most one point, and only when you can see the control.',
  "If it is not on screen, say so and omit the point; the user may need to scroll.",
].join("\n");

const PHRASES = [
  "What's on my screen?",
  "Where is the search field?",
  "What should I click next?",
  "Read this error to me",
];

function splitPoint(text: string): { clean: string; point: ScreenPoint | null } {
  let point: ScreenPoint | null = null;
  const clean = text
    .replace(/<\s*point\s+([^>]*?)\/?>/gi, (_match, attrs: string) => {
      const x = Number(/(?:^|\s)x\s*=\s*["']?([\d.]+)/i.exec(attrs)?.[1]);
      const y = Number(/(?:^|\s)y\s*=\s*["']?([\d.]+)/i.exec(attrs)?.[1]);
      const label = /(?:^|\s)label\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1];
      if (Number.isFinite(x) && Number.isFinite(y)) point = { x, y, label };
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { clean, point };
}

export function ScreenShare() {
  const { state, notify } = useStore();
  const [open, setOpen] = useState(false);
  const [frame, setFrame] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [hint, setHint] = useState<ScreenPoint | null>(null);
  const history = useRef<ChatTurn[]>([]);
  const controller = useRef<AbortController | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const native = inTauri();

  const grab = useCallback(async (): Promise<string | null> => {
    if (native) return captureNativeScreen();
    const stream = currentScreen();
    return stream ? captureFrame(stream) : null;
  }, [native]);

  // Live preview: the app has no screen stream inside a WKWebView, so the
  // native side refreshes one still at a time. Slow enough to stay cheap,
  // fast enough to see the page you just moved to.
  useEffect(() => {
    if (!native || !open) return;
    let alive = true;
    let pending = false;
    const tick = async () => {
      if (pending) return;
      pending = true;
      try {
        const shot = await grab();
        if (alive && shot) setFrame(shot);
      } catch {
        /* permission is reported when the question is asked */
      } finally {
        pending = false;
      }
    };
    void tick();
    const timer = window.setInterval(tick, 1400);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [native, open, grab]);

  useEffect(() => {
    if (native || !open) return;
    const attach = () => {
      const stream = currentScreen();
      const node = videoRef.current;
      if (!stream || !node) return false;
      node.srcObject = stream;
      void node.play().catch(() => {});
      return true;
    };
    if (attach()) return;
    // Shared from the composer a moment ago: the picker may still be open.
    void acquireScreen()
      .then(() => window.setTimeout(attach, 120))
      .catch(() => undefined);
  }, [native, open]);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onClose = () => {
      controller.current?.abort();
      setOpen(false);
      setAnswer("");
    };
    window.addEventListener("lantas:screen-open", onOpen);
    window.addEventListener("lantas:screen-close", onClose);
    return () => {
      window.removeEventListener("lantas:screen-open", onOpen);
      window.removeEventListener("lantas:screen-close", onClose);
    };
  }, []);

  const draw = useCallback(
    async (point: ScreenPoint) => {
      setHint(point);
      window.setTimeout(() => setHint(null), 5000);
      if (!native) return;
      try {
        const { emitTo } = await import("@tauri-apps/api/event");
        await overlayShow();
        await emitTo("screen-overlay", "lantas:pointer", point);
        // The layer is only needed while the mark lasts; a hidden window is
        // one fewer thing above every other app.
        window.clearTimeout(hideTimer.current);
        hideTimer.current = window.setTimeout(() => void overlayHide(), 5400);
      } catch {
        /* the panel already shows the ring; the layer is a bonus */
      }
    },
    [native],
  );

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy || !open) return;
    const provider = state.settings.defaultProvider;
    const config = state.settings.providers[provider];
    const model = state.settings.defaultModel;
    if (!isConfigured(provider, config)) {
      notify("Connect a model in Settings to ask about your screen", "error");
      return;
    }

    setBusy(true);
    setAnswer("");
    setDraft("");
    const shot = await grab().catch(() => null);
    if (!shot) {
      setBusy(false);
      notify(
        native
          ? "Screen capture failed. Allow Lantas in System Settings › Privacy & Security › Screen Recording."
          : "No screen is shared. Press the screen button again and pick a window.",
        "error",
      );
      return;
    }

    const active = new AbortController();
    controller.current = active;
    let buffer = "";
    try {
      await streamChat({
        provider,
        config,
        model,
        system: SYSTEM,
        messages: [
          ...history.current.slice(-4),
          {
            role: "user",
            content: question,
            images: [{ mime: "image/jpeg", data: shot.split(",")[1] ?? "" }],
          },
        ],
        signal: active.signal,
        onDelta: (chunk) => {
          buffer += chunk;
          const { clean, point } = splitPoint(buffer);
          setAnswer(clean);
          if (point) void draw(point);
        },
      });
      const { clean, point } = splitPoint(buffer);
      setAnswer(clean);
      if (point) void draw(point);
      if (clean) {
        history.current = [
          ...history.current,
          { role: "user" as const, content: question },
          { role: "assistant" as const, content: clean },
        ].slice(-8);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      notify(error instanceof Error ? error.message : "The screen question failed", "error");
    } finally {
      setBusy(false);
      controller.current = null;
    }
  };

  if (!open) return null;

  return (
    <aside className="screen-share" aria-label="Lantas screen assistant">
      <header className="ss-head">
        <span className={cx("ss-dot", busy && "is-busy")} />
        <span className="ss-title">Lantas Screen</span>
        <span className="ss-beta">Beta</span>
        <span className="ss-sp" />
        <button
          type="button"
          className="ss-icon"
          onClick={() => setAnswer("")}
          title="Clear this card"
          aria-label="Clear"
        >
          <Icon name="refresh" size={12} />
        </button>
        <button
          type="button"
          className="ss-icon"
          onClick={() => window.dispatchEvent(new CustomEvent("lantas:screen-close"))}
          title="Close and stop sharing"
          aria-label="Close"
        >
          <Icon name="close" size={12} />
        </button>
      </header>

      <div className="ss-preview">
        {native ? (
          frame ? (
            <img src={frame} alt="Your screen" />
          ) : (
            <span className="ss-wait">Waiting for your screen…</span>
          )
        ) : (
          <video ref={videoRef} muted playsInline />
        )}
        {hint && (
          <span
            className="ss-ring"
            style={{ left: `${hint.x * 100}%`, top: `${hint.y * 100}%` }}
          >
            {hint.label && <span className="ss-ring-label">{hint.label}</span>}
          </span>
        )}
        <span className="ss-live">
          <i />
          live
        </span>
      </div>

      <div className="ss-log">
        {!answer && !busy && (
          <div className="ss-empty">
            <p className="ss-greeting">I can see your screen.</p>
            <p className="ss-lead">Ask about anything in it, or where to click.</p>
            <div className="ss-chips">
              {PHRASES.map((phrase) => (
                <button key={phrase} type="button" onClick={() => void send(phrase)}>
                  {phrase}
                  <Icon name="chevronRight" size={11} />
                </button>
              ))}
            </div>
          </div>
        )}
        {busy && !answer && <p className="ss-thinking">Looking at your screen…</p>}
        {answer && <p className="ss-answer">{answer}</p>}
      </div>

      <form
        className="ss-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(draft);
            }
          }}
          rows={1}
          placeholder="Ask about your screen"
          spellCheck={false}
          aria-label="Ask about your screen"
        />
        <div className="ss-bar">
          <button
            type="button"
            className="ss-plus"
            onClick={() => void send("Point at the thing I should click next.")}
            title="Ask Lantas to point at the next thing to click"
            aria-label="Point at the next thing"
          >
            <Icon name="cursor" size={13} />
          </button>
          <span className="ss-sp" />
          <button
            type="submit"
            className="ss-send"
            disabled={!draft.trim() || busy}
            aria-label="Send"
            title="Send"
          >
            <Icon name="arrowUp" size={13} />
          </button>
        </div>
      </form>
      <div className="ss-foot">Replies can be wrong. Check before acting.</div>
    </aside>
  );
}
