import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import {
  hideScreenAssistant,
  inTauri,
  openPrivacySettings,
  overlayHide,
  overlayShow,
  requestScreenPermission,
  revealApp,
  screenPermission,
} from "../lib/native";
import { acquireScreen, captureFrame, captureNativeScreen, currentScreen } from "../lib/screen";
import { canSeeImages, isConfigured, type ChatTurn } from "../lib/providers";
import { runToolLoop } from "../lib/agentRuntime";
import {
  hideScreenCursor,
  readScreenTree,
  requestScreenControl,
  screenControlAllowed,
  type ScreenTree,
} from "../lib/screenControl";
import type { ToolContext } from "../lib/tools";
import {
  askUser as askScreenUser,
  getActiveUserAsk,
  subscribeUserAsk,
} from "../lib/userAsk";
import { AgentQuestion } from "./AgentQuestion";
import { Icon } from "./Icons";
import { cx } from "../lib/util";

/**
 * Screen share, in a card that sits over the conversation.
 *
 * A vision model gets a frame; a text-only model gets the front window as an
 * accessibility tree, so it can still read and operate the screen. With
 * Control on, the card drives the real pointer, keyboard, scroll, drag and
 * window focus, and draws a blue Lantas cursor over the display while it does.
 * Nothing is recorded or uploaded; the card asks about the screen, it does not
 * keep it.
 */

interface ScreenPoint {
  x: number;
  y: number;
  label?: string;
}

const PHRASES = [
  "What's on my screen?",
  "Where is the search field?",
  "What should I click next?",
  "Open Safari and search for the weather",
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

/** Removes the tool protocol from the text the model is streaming. */
function visibleText(raw: string): string {
  return raw
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, " ")
    .replace(/<tool_call>[\s\S]*$/i, " ")
    .replace(/<tool_result[\s\S]*?<\/tool_result>/gi, " ")
    .replace(/^\s*\{[\s\S]*"name"\s*:\s*"screen"[\s\S]*\}\s*$/i, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function describeScreenTree(tree: ScreenTree): string {
  const head = `App: ${tree.app || "unknown"}${tree.window ? ` — window: ${tree.window}` : ""}`;
  if (!tree.elements?.length) return `${head}\nNo labelled controls were exposed by this window.`;
  const lines = tree.elements.slice(0, 120).map((element) => {
    const name = element.title || element.value || element.role;
    const value =
      element.value && element.value !== name ? `, value “${element.value.slice(0, 80)}”` : "";
    return `${element.ref} ${element.role.replace(/^AX/, "")} “${name.slice(0, 100)}”${value} — centre ${Math.round(
      element.x + element.w / 2,
    )},${Math.round(element.y + element.h / 2)} (${Math.round(element.w)}×${Math.round(element.h)})`;
  });
  return [head, `${tree.elements.length} controls:`, ...lines].join("\n");
}

function systemPrompt(vision: boolean, control: boolean): string {
  return [
    "You are Lantas Screen, working on the user's Mac.",
    vision
      ? "You can see one screenshot of the screen and the front window as an accessibility tree."
      : "You cannot see images. You read the screen as an accessibility tree: every control has a ref, a role, a label and a centre point.",
    control
      ? "You may control the real pointer and keyboard. Use one screen tool call per step, then read the snapshot it returns before the next step."
      : "Control is off. Read the screen and answer, but do not click, type, scroll, drag or switch windows.",
    "",
    "The target is the frontmost normal window behind this card; the card and its blue pointer are skipped, and Lantas Browser is a normal target too. To work in another app, focus it first. Click a text field before typing so the keystrokes go to that field instead of this card.",
    "",
    "The screen tool:",
    '<tool_call>{"name":"screen","arguments":{"action":"snapshot"}}</tool_call>',
    '<tool_call>{"name":"screen","arguments":{"action":"click","ref":"s4"}}</tool_call>',
    '<tool_call>{"name":"screen","arguments":{"action":"type","text":"hello","submit":true}}</tool_call>',
    '<tool_call>{"name":"screen","arguments":{"action":"key","key":"Tab","modifiers":["cmd"]}}</tool_call>',
    '<tool_call>{"name":"screen","arguments":{"action":"scroll","dy":4}}</tool_call>',
    '<tool_call>{"name":"screen","arguments":{"action":"focus","app":"Safari"}}</tool_call>',
    "",
    "Actions:",
    "  snapshot {} — read the front window; every control gets a ref and centre point",
    "  windows {} — list the front app's windows",
    "  focus {\"app\":\"Safari\",\"window\":\"GitHub\"} — bring an app or window to the front",
    "  click {\"ref\":\"s4\"} or {\"x\":0.5,\"y\":0.4} — left click; button right/middle and count 2 also work",
    "  move {\"ref\":\"s4\"} — move the pointer without clicking",
    "  type {\"text\":\"...\",\"submit\":true} — type into the focused field; submit presses Return",
    "  key {\"key\":\"Tab\",\"modifiers\":[\"cmd\"]} — press a key; modifiers are cmd, shift, alt, ctrl",
    "  scroll {\"dy\":4} — positive scrolls down, negative scrolls up",
    "  drag {\"fromRef\":\"s2\",\"toRef\":\"s6\"} — drag one control onto another",
    "  wait {\"ms\":800} — let the app settle",
    "",
    "When a step needs a detail only the user has, call ask_user instead of guessing. One detail: {\"question\":\"Which email?\",\"kind\":\"email\"}. Several: {\"question\":\"Fill the applicant details\",\"fields\":[{\"label\":\"Full name\",\"type\":\"text\"},{\"label\":\"Age\",\"type\":\"number\"}]}. Known choices: {\"question\":\"Which plan?\",\"options\":[\"Basic\",\"Pro\"]}. The card renders titled boxes and clickable choices.",
    "",
    "Coordinates for x and y are fractions of the main display (0,0 is top-left). Prefer a ref from the latest snapshot.",
    "After every action the result already contains a fresh snapshot. Do not assume a click worked; read the result.",
    "If the user asks for a task, do it step by step. If a permission or password is needed, stop and explain what is blocked.",
    "Answer in one to three short sentences. Never mention the tool protocol or show raw JSON.",
  ].join("\n");
}

export function ScreenShare({ standalone = false }: { standalone?: boolean }) {
  const { state, notify, setSettings } = useStore();
  const [open, setOpen] = useState(standalone);
  const [frame, setFrame] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState("");
  const [hint, setHint] = useState<ScreenPoint | null>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const [control, setControl] = useState(true);
  const [pendingAsk, setPendingAsk] = useState(getActiveUserAsk);
  // null means "not checked yet" (or an older build without the command).
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [axAllowed, setAxAllowed] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const history = useRef<ChatTurn[]>([]);
  const controller = useRef<AbortController | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const native = inTauri();

  useEffect(() => subscribeUserAsk(setPendingAsk), []);

  // macOS keeps Screen Recording behind a switch the user owns. Ask whether
  // the switch is on while the card is open, so it can show the one action
  // that works instead of failing every preview frame.
  useEffect(() => {
    if (!native || !open) return;
    let alive = true;
    const check = async () => {
      const value = await screenPermission();
      if (alive && value !== null) setAllowed(value);
    };
    void check();
    const timer = window.setInterval(check, 2500);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [native, open]);

  // Accessibility is what lets Lantas read controls and post real events.
  useEffect(() => {
    if (!native || !open) return;
    let alive = true;
    const check = async () => {
      const value = await screenControlAllowed();
      if (alive) setAxAllowed(value);
    };
    void check();
    const timer = window.setInterval(check, 3500);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [native, open]);

  const grab = useCallback(async (): Promise<string | null> => {
    if (native) return captureNativeScreen();
    const stream = currentScreen();
    return stream ? captureFrame(stream) : null;
  }, [native]);

  // Live preview: the app has no screen stream inside a WKWebView, so the
  // native side refreshes one still at a time. Slow enough to stay cheap,
  // fast enough to see the page you just moved to.
  useEffect(() => {
    if (!native || !open || allowed === false) return;
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
  }, [native, open, allowed, grab]);

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
    if (standalone) return;
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
  }, [standalone]);

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

  /** Registers Lantas with the macOS list and opens the switch for the user. */
  const askAccess = async () => {
    setChecking(true);
    try {
      const granted = await requestScreenPermission();
      if (granted !== null) setAllowed(granted);
      if (!granted) await openPrivacySettings("screen");
    } finally {
      setChecking(false);
    }
  };

  const askControlAccess = async () => {
    const granted = await requestScreenControl();
    setAxAllowed(granted);
    if (!granted) await openPrivacySettings("accessibility");
  };

  const stop = () => {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    void hideScreenCursor();
  };

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy || !open) return;
    const session = state.sessions.find((item) => item.id === state.activeId);
    const provider = session?.provider ?? state.settings.defaultProvider;
    const config = state.settings.providers[provider];
    const model = session?.model || state.settings.defaultModel;
    if (!isConfigured(provider, config)) {
      setProblem("Connect a model in Settings → Providers, then ask again.");
      notify("Connect a model in Settings to ask about your screen", "error");
      return;
    }
    // Vision is a bonus, not a requirement. A text-only model reads the
    // accessibility tree, which needs the desktop app.
    const vision = canSeeImages(provider, model);
    // Screen Recording is only needed for pixels. A text-only model reads the
    // accessibility tree, which is a separate permission.
    if (native && allowed === false && vision) {
      setProblem("Allow Lantas in Screen Recording first.");
      notify("Allow Lantas in Screen Recording first", "error");
      return;
    }
    if (!native && !vision) {
      setProblem(
        "This web preview can only send a picture. Open the Lantas desktop app to read the screen as elements and control it.",
      );
      return;
    }
    if (native && !vision && axAllowed === false) {
      setProblem(
        "This model reads the screen as elements. Allow Lantas in System Settings › Privacy & Security › Accessibility first.",
      );
      return;
    }

    setBusy(true);
    setProblem("");
    setAnswer("");
    setSteps([]);
    setDraft("");

    const shot = vision ? await grab().catch(() => null) : null;
    if (vision && !shot) {
      setBusy(false);
      const message = native
        ? "Screen capture failed. Allow Lantas in System Settings › Privacy & Security › Screen Recording."
        : "No screen is shared. Press the screen button again and pick a window.";
      setProblem(message);
      notify(message, "error");
      return;
    }

    let context = "";
    if (native) {
      try {
        const tree = await readScreenTree();
        context = `\n\nCurrent screen:\n${describeScreenTree(tree)}`;
      } catch (error) {
        if (!vision) {
          setBusy(false);
          const message =
            error instanceof Error
              ? error.message
              : "Lantas could not read this window. Allow Accessibility and try again.";
          setProblem(message);
          return;
        }
      }
    }

    const active = new AbortController();
    controller.current = active;
    let raw = "";
    const userTurn: ChatTurn = {
      role: "user",
      content: question + context,
      ...(vision && shot
        ? { images: [{ mime: "image/jpeg", data: shot.split(",")[1] ?? "" }] }
        : {}),
    };
    const ctx: ToolContext = {
      files: [],
      root: "",
      agent: "chat",
      skills: [],
      task: question,
      vision,
      screen: native && control ? "control" : "read",
      askUser: (question, kind, extra) =>
        askScreenUser({ question, kind, ...extra }, active.signal),
      saveFile: async () => false,
    };

    try {
      await runToolLoop({
        provider,
        config,
        model,
        system: systemPrompt(vision, native && control),
        messages: [...history.current.slice(-6), userTurn],
        ctx,
        rules: [{ tool: "screen", pattern: "*", effect: "allow" }],
        signal: active.signal,
        only: ["screen", "ask_user"],
        maxSteps: 8,
        approve: async () => true,
        onText: (chunk) => {
          raw += chunk;
          const { clean, point } = splitPoint(visibleText(raw));
          setAnswer(clean);
          if (point) void draw(point);
        },
        onToolStart: (_id, call) => {
          const action = String(call.args.action ?? "snapshot");
          setSteps((current) => [...current.slice(-5), action]);
        },
        onToolDone: (_id, outcome) => {
          if (!outcome.ok) setProblem(outcome.summary);
        },
        onNote: (note) => setProblem(note),
      });
      if (active.signal.aborted) return;
      const { clean, point } = splitPoint(visibleText(raw));
      setAnswer(clean || "I finished the steps I could take. Tell me what to do next.");
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
      const message = error instanceof Error ? error.message : "The screen question failed";
      setProblem(message);
      notify(message, "error");
    } finally {
      setBusy(false);
      controller.current = null;
      void hideScreenCursor();
    }
  };

  /** Closing the floating card is also stopping the share, not just hiding it. */
  const close = () => {
    controller.current?.abort();
    setAnswer("");
    void hideScreenCursor();
    if (standalone) {
      setSettings({ screenAccess: false });
      void hideScreenAssistant();
    } else {
      window.dispatchEvent(new CustomEvent("lantas:screen-close"));
    }
  };

  if (!open) return null;

  const model = state.sessions.find((item) => item.id === state.activeId)?.model || state.settings.defaultModel;
  const provider = state.sessions.find((item) => item.id === state.activeId)?.provider ?? state.settings.defaultProvider;
  const visionModel = canSeeImages(provider, model);

  return (
    <aside
      className={cx("screen-share", standalone && "is-standalone")}
      aria-label="Lantas screen assistant"
    >
      <header className="ss-head" data-tauri-drag-region>
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
          onClick={close}
          title="Close and stop sharing"
          aria-label="Close"
        >
          <Icon name="close" size={12} />
        </button>
      </header>

      <div className="ss-preview">
        {native && allowed === false ? (
          <div className="ss-perm">
            <Icon name="shield" size={19} />
            <strong>Allow screen access</strong>
            <p>
              macOS keeps this switch with you. Lantas asks macOS now and opens the right
              settings pane; turn Lantas on there. If it was already on, quit and reopen
              Lantas so the permission takes effect.
            </p>
            <div className="ss-perm-actions">
              <button
                type="button"
                className="ss-perm-primary"
                onClick={() => void askAccess()}
                disabled={checking}
              >
                {checking ? "Asking macOS…" : "Allow screen access"}
              </button>
              <button
                type="button"
                className="ss-perm-secondary"
                onClick={() => void openPrivacySettings("screen")}
              >
                Open System Settings
              </button>
              <button
                type="button"
                className="ss-perm-link"
                onClick={() => void revealApp()}
              >
                Show Lantas in Finder
              </button>
            </div>
          </div>
        ) : native ? (
          frame ? (
            <img src={frame} alt="Your screen" />
          ) : (
            <span className="ss-wait">Waiting for your screen…</span>
          )
        ) : (
          <video ref={videoRef} muted playsInline />
        )}
        {hint && allowed !== false && (
          <span
            className="ss-ring"
            style={{ left: `${hint.x * 100}%`, top: `${hint.y * 100}%` }}
          >
            {hint.label && <span className="ss-ring-label">{hint.label}</span>}
          </span>
        )}
        {allowed !== false && (
          <span className="ss-live">
            <i />
            live
          </span>
        )}
        {native && control && axAllowed === false && allowed !== false && (
          <span className="ss-live ss-live-control">control needs Accessibility</span>
        )}
      </div>

      {native && axAllowed === false && (
        <div className="ss-control-note">
          <Icon name="shield" size={12} />
          <span>
            Accessibility is off. Turn Lantas on in System Settings › Privacy & Security ›
            Accessibility so it can read controls and use the pointer. If it is not listed,
            add it from Finder.
          </span>
          <button type="button" onClick={() => void askControlAccess()}>
            Enable
          </button>
          <button type="button" onClick={() => void revealApp()} title="Show Lantas in Finder">
            Finder
          </button>
        </div>
      )}

      <div className="ss-log">
        {!answer && !busy && (
          <div className="ss-empty">
            <p className="ss-greeting">
              {native && control ? "I can see and control your screen." : "I can see your screen."}
            </p>
            <p className="ss-lead">
              {visionModel
                ? "Ask about anything in it, or tell me what to do. With Control on I click, type and scroll the real window."
                : "This model reads the screen as elements, not pixels — still enough to read it and, with Control on, operate it."}
            </p>
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
        {busy && !answer && <p className="ss-thinking">Working on your screen…</p>}
        {steps.length > 0 && (
          <div className="ss-steps">
            {steps.map((step, index) => (
              <span key={`${step}-${index}`}>{step}</span>
            ))}
          </div>
        )}
        {answer && <p className="ss-answer">{answer}</p>}
        {problem && <p className="ss-problem">{problem}</p>}
      </div>

      {pendingAsk && (
        <div className="ss-ask">
          <AgentQuestion key={pendingAsk.id} inline />
        </div>
      )}

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
          placeholder="Ask about your screen, or tell me what to do"
          spellCheck={false}
          aria-label="Ask about your screen"
        />
        <div className="ss-bar">
          <button
            type="button"
            className={cx("ss-control", control && "is-on")}
            onClick={() => setControl((value) => !value)}
            title={
              control
                ? "Control is on: Lantas can use the pointer and keyboard"
                : "Control is off: Lantas can read the screen but not act"
            }
            aria-pressed={control}
          >
            <Icon name="cursor" size={12} />
            {control ? "Control on" : "Control off"}
          </button>
          <span className="ss-sp" />
          {busy ? (
            <button
              type="button"
              className="ss-send is-stop"
              onClick={stop}
              aria-label="Stop"
              title="Stop"
            >
              <Icon name="stop" size={13} />
            </button>
          ) : (
            <button
              type="submit"
              className="ss-send"
              disabled={!draft.trim()}
              aria-label="Send"
              title="Send"
            >
              <Icon name="arrowUp" size={13} />
            </button>
          )}
        </div>
      </form>
      <div className="ss-foot">
        {control
          ? "Lantas moves the real pointer and keyboard for the steps you ask for. Replies can be wrong; check before acting."
          : "Control is off. Lantas reads the screen but does not act."}
      </div>
    </aside>
  );
}
