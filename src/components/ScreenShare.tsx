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
import { captureFrame, currentScreen } from "../lib/screen";
import { canSeeImages, isConfigured, type ChatTurn } from "../lib/providers";
import { runToolLoop } from "../lib/agentRuntime";
import {
  hideScreenCursor,
  requestScreenControl,
  screenControlAllowed,
  screenSight,
} from "../lib/screenControl";
import type { ToolCall, ToolContext } from "../lib/tools";
import {
  askUser as askScreenUser,
  getActiveUserAsk,
  subscribeUserAsk,
} from "../lib/userAsk";
import { AgentQuestion } from "./AgentQuestion";
import { Icon } from "./Icons";
import { cx } from "../lib/util";

/**
 * The screen assistant, as a heads-up card that floats above every app —
 * including another app's full-screen Space.
 *
 * There is deliberately no live preview. The user does not need to watch their
 * own screen inside a card, and a preview costs a capture every second. What
 * the model gets is a private copy of the front window with a 16×10 grid and
 * every control boxed with a ref; that copy never appears in the UI. The only
 * thing drawn on the user's display is the blue pointer while a step runs.
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

function stepLabel(call: ToolCall): string {
  const args = call.args ?? {};
  const action = String(args.action ?? "snapshot").toLowerCase();
  const target =
    typeof args.ref === "string"
      ? args.ref
      : typeof args.cell === "string"
        ? `cell ${args.cell}`
        : typeof args.label === "string"
          ? args.label
          : "";
  switch (action) {
    case "snapshot":
      return "Read the window";
    case "zoom":
      return `Zoom${target ? ` on ${target}` : ""}`;
    case "click":
    case "double_click":
    case "right_click":
      return target ? `Press ${target}` : "Click the window";
    case "type":
    case "write":
      return `Type “${String(args.text ?? "").slice(0, 24)}”`;
    case "fill":
    case "set_value":
      return target ? `Fill ${target}` : "Fill the field";
    case "key":
    case "press":
      return `Press ${String(args.key ?? "a key")}`;
    case "scroll":
      return Number(args.dy ?? 3) < 0 ? "Scroll up" : "Scroll down";
    case "drag":
      return "Drag";
    case "focus":
    case "activate":
      return `Focus ${String(args.app ?? "an app")}`;
    case "move":
      return "Move the pointer";
    case "wait":
      return "Wait";
    default:
      return action;
  }
}

function systemPrompt(vision: boolean, control: boolean): string {
  return [
    "You are Lantas Screen, working on the user's Mac. Your card floats above every app, including full-screen apps.",
    vision
      ? "You get two views of the front window: an accessibility tree of its controls, and a private picture with a labelled grid and every control boxed with its ref. That picture is for you only; the user never sees it."
      : "You cannot see images. You read the screen as an accessibility tree: every control has a ref, a role, a label, a rectangle and a centre point.",
    control
      ? "You may control the real pointer and keyboard. Use one screen tool call per step, then read the fresh snapshot the result contains before the next step."
      : "Control is off. Read the screen and answer, but do not click, type, scroll, drag or switch windows.",
    "",
    "The target is the frontmost normal window behind this card; the card and its blue pointer are skipped, and Lantas Browser is a normal target too. The picture is captured from that window alone, so the card is never in it. To work in another app, focus it first.",
    "",
    "The screen tool:",
    '<tool_call>{"name":"screen","arguments":{"action":"snapshot"}}</tool_call>',
    '<tool_call>{"name":"screen","arguments":{"action":"click","ref":"s4"}}</tool_call>',
    '<tool_call>{"name":"screen","arguments":{"action":"click","cell":"G4"}}</tool_call>',
    '<tool_call>{"name":"screen","arguments":{"action":"type","ref":"s7","text":"hello","submit":true}}</tool_call>',
    '<tool_call>{"name":"screen","arguments":{"action":"fill","ref":"s7","text":"hello"}}</tool_call>',
    '<tool_call>{"name":"screen","arguments":{"action":"key","key":"Tab","modifiers":["cmd"]}}</tool_call>',
    '<tool_call>{"name":"screen","arguments":{"action":"scroll","dy":4}}</tool_call>',
    '<tool_call>{"name":"screen","arguments":{"action":"zoom","ref":"s4"}}</tool_call>',
    "",
    "Actions:",
    "  snapshot {} — read the front window and get the private grid picture",
    "  zoom {\"ref\":\"s4\"} or {\"cell\":\"G4\"} — a closer 8×6 grid on one region, for small text",
    "  windows {} — list the front app's windows",
    "  focus {\"app\":\"Safari\",\"window\":\"GitHub\"} — bring an app or window to the front",
    "  click {\"ref\":\"s4\"}, {\"cell\":\"G4\"} or {\"x\":0.5,\"y\":0.4} — Lantas presses an element itself when it can, otherwise clicks; button right/middle and count 2 also work",
    "  move {\"ref\":\"s4\"} — move the pointer without clicking",
    "  type {\"text\":\"...\",\"submit\":true} — type into the focused field; add ref to focus that field first",
    "  fill {\"ref\":\"s7\",\"text\":\"...\"} — set a field's value in one step, falling back to typing",
    "  key {\"key\":\"Tab\",\"modifiers\":[\"cmd\"]} — press a key; modifiers are cmd, shift, alt, ctrl",
    "  scroll {\"dy\":4} — positive scrolls down, negative scrolls up",
    "  drag {\"fromRef\":\"s2\",\"toRef\":\"s6\"} or cells — drag one control onto another",
    "  wait {\"ms\":800} — let the app settle",
    "",
    "Coordinates:",
    "- ref: a control from the latest snapshot. This is the first choice; it is exact.",
    "- cell: a grid cell from A1 to P10. Read the picture to choose one, then use its centre. Good for a canvas, a map or a blank part of a page.",
    "- x, y: fractions of the target window, 0 to 1. 0,0 is the window's top-left. A 0–1000 convention is also accepted.",
    "- screenX, screenY: absolute screen points, only when a global position is truly needed.",
    "- The attached picture's header shows the window size, and its boxes carry the same refs as the tree. Never mention the grid, the picture or the refs to the user.",
    "",
    "When a step needs a detail only the user has, call ask_user instead of guessing. One detail: {\"question\":\"Which email?\",\"kind\":\"email\"}. Several: {\"question\":\"Fill the applicant details\",\"fields\":[{\"label\":\"Full name\",\"type\":\"text\"},{\"label\":\"Age\",\"type\":\"number\"}]}. Known choices: {\"question\":\"Which plan?\",\"options\":[\"Basic\",\"Pro\"]}. The card renders titled boxes and clickable choices.",
    "",
    "After every action the result already contains a fresh snapshot and picture. Do not assume a click worked; read the result. Prefer one careful step over a burst of guesses. If a permission or password is needed, stop and explain what is blocked.",
    "Answer in one to three short sentences. Never mention the tool protocol, the grid, refs or raw JSON.",
  ].join("\n");
}

export function ScreenShare({ standalone = false }: { standalone?: boolean }) {
  const { state, notify, setSettings } = useStore();
  const [open, setOpen] = useState(standalone);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState("");
  const [steps, setSteps] = useState<string[]>([]);
  // One switch for the whole app: the browser's drive permission and the
  // floating card's pointer/keyboard permission cannot disagree.
  const [control, setControl] = useState(() => state.settings.computerControl);
  const [pendingAsk, setPendingAsk] = useState(getActiveUserAsk);
  // null means "not checked yet" (or an older build without the command).
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [axAllowed, setAxAllowed] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const history = useRef<ChatTurn[]>([]);
  const controller = useRef<AbortController | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const native = inTauri();

  useEffect(() => {
    setControl(state.settings.computerControl);
  }, [state.settings.computerControl]);

  const model =
    state.sessions.find((item) => item.id === state.activeId)?.model || state.settings.defaultModel;
  const provider =
    state.sessions.find((item) => item.id === state.activeId)?.provider ??
    state.settings.defaultProvider;
  const visionModel = canSeeImages(provider, model);

  useEffect(() => subscribeUserAsk(setPendingAsk), []);

  // Load the click-through pointer layer while the card opens, then take it
  // down. The first action then shows its pointer immediately instead of
  // waiting for a transparent window to finish loading.
  useEffect(() => {
    if (!native || !open) return;
    let alive = true;
    void (async () => {
      try {
        await overlayShow();
        await new Promise((resolve) => setTimeout(resolve, 450));
        if (alive) await overlayHide();
      } catch {
        /* the overlay is a visual aid */
      }
    })();
    return () => {
      alive = false;
    };
  }, [native, open]);

  // Screen Recording is only needed for the private picture. Ask macOS for the
  // switch while the card is open, so the banner can appear before a step
  // fails. A text-only model does not need this at all.
  useEffect(() => {
    if (!native || !open) return;
    let alive = true;
    const check = async () => {
      const value = await screenPermission();
      if (alive && value !== null) setAllowed(value);
    };
    void check();
    const timer = window.setInterval(check, 4000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [native, open]);

  // Accessibility is what lets Lantas read controls, capture the target window
  // and post real events.
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

  /** A point the model asked to mark, drawn by the click-through layer. */
  const draw = useCallback(
    async (point: ScreenPoint) => {
      if (!native) return;
      try {
        await overlayShow();
        const { emitTo } = await import("@tauri-apps/api/event");
        await emitTo("screen-overlay", "lantas:pointer", point);
        // The layer is only needed while the mark lasts; a hidden window is
        // one fewer thing above every other app.
        window.clearTimeout(hideTimer.current);
        hideTimer.current = window.setTimeout(async () => {
          try {
            const { overlayHide } = await import("../lib/native");
            await overlayHide();
          } catch {
            /* not in the desktop app */
          }
        }, 5400);
      } catch {
        /* the overlay is a visual aid */
      }
    },
    [native],
  );

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
    const config = state.settings.providers[provider];
    if (!isConfigured(provider, config)) {
      setProblem("Connect a model in Settings → Providers, then ask again.");
      notify("Connect a model in Settings to ask about your screen", "error");
      return;
    }
    // Vision is a bonus, not a requirement. A text-only model reads the
    // accessibility tree, which needs the desktop app.
    const vision = visionModel;
    if (native && allowed === false && vision) {
      setProblem("Allow Lantas in Screen Recording so it can see the window.");
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

    let context = "";
    let initialImage: { mime: string; data: string } | undefined;
    if (native) {
      const sight = await screenSight(vision);
      if (vision && !sight.shot) {
        setBusy(false);
        const message =
          "Screen capture failed. Allow Lantas in System Settings › Privacy & Security › Screen Recording.";
        setProblem(message);
        notify(message, "error");
        return;
      }
      context = `\n\nCurrent screen:\n${sight.content}`;
      initialImage = sight.images?.[0];
    } else {
      const stream = currentScreen();
      const frame = stream && vision ? await captureFrame(stream) : null;
      if (vision && !frame) {
        setBusy(false);
        const message = "No screen is shared. Press the screen button again and pick a window.";
        setProblem(message);
        notify(message, "error");
        return;
      }
      if (frame) {
        initialImage = { mime: "image/jpeg", data: frame.split(",")[1] ?? "" };
      }
    }

    const active = new AbortController();
    controller.current = active;
    let raw = "";
    const userTurn: ChatTurn = {
      role: "user",
      content: question + context,
      ...(initialImage ? { images: [initialImage] } : {}),
    };
    const ctx: ToolContext = {
      files: [],
      root: "",
      agent: "chat",
      skills: [],
      task: question,
      vision,
      screen: native && control ? "control" : "read",
      askUser: (askQuestion, kind, extra) =>
        askScreenUser({ question: askQuestion, kind, ...extra }, active.signal),
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
        maxSteps: 10,
        approve: async () => true,
        onText: (chunk) => {
          raw += chunk;
          const { clean, point } = splitPoint(visibleText(raw));
          setAnswer(clean);
          if (point) void draw(point);
        },
        onToolStart: (_id, call) => {
          setSteps((current) => [...current.slice(-5), stepLabel(call)]);
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
        {busy && (
          <button type="button" className="ss-takeover" onClick={stop} title="Pause and take over">
            Take over
          </button>
        )}
        <button
          type="button"
          className="ss-icon"
          onClick={() => {
            setAnswer("");
            setProblem("");
            setSteps([]);
          }}
          title="Clear this card"
          aria-label="Clear"
        >
          <Icon name="refresh" size={12} />
        </button>
        <button
          type="button"
          className="ss-icon"
          onClick={close}
          title="Close and stop"
          aria-label="Close"
        >
          <Icon name="close" size={12} />
        </button>
      </header>

      <div className="ss-context">
        <span className={cx("ss-chip", control && "is-on")}>
          <Icon name="cursor" size={11} />
          {control ? "Control on" : "Read only"}
        </span>
        <span className={cx("ss-chip", visionModel ? "is-on" : "is-quiet")}>
          <Icon name={visionModel ? "eye" : "frame"} size={11} />
          {visionModel ? "Private grid" : "Element map"}
        </span>
        <span className="ss-sp" />
        {busy ? (
          <span className="ss-working">
            <i />
            working
          </span>
        ) : (
          <span className="ss-working is-idle">above your apps</span>
        )}
      </div>

      {native && visionModel && allowed === false && (
        <div className="ss-gate">
          <Icon name="shield" size={13} />
          <span>Screen Recording is off, so the private picture can’t be taken.</span>
          <button type="button" onClick={() => void askAccess()} disabled={checking}>
            {checking ? "Asking…" : "Allow"}
          </button>
          <button type="button" onClick={() => void openPrivacySettings("screen")}>
            Settings
          </button>
        </div>
      )}

      {native && axAllowed === false && (
        <div className="ss-gate">
          <Icon name="shield" size={13} />
          <span>Accessibility is off, so Lantas can’t read controls or use the pointer.</span>
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
            <p className="ss-greeting">Point me at the screen.</p>
            <p className="ss-lead">
              I sit above your apps, even full screen. I read the front window as controls and
              a private grid; you only see the blue pointer. Nothing is recorded or uploaded.
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
          <ol className="ss-steps">
            {steps.map((step, index) => (
              <li
                key={`${step}-${index}`}
                className={cx(index === steps.length - 1 && busy && "is-now")}
              >
                <i />
                {step}
              </li>
            ))}
          </ol>
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
            onClick={() => {
              const next = !control;
              setControl(next);
              setSettings({ computerControl: next });
            }}
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
          ? "Lantas sees a private map, never a preview. Only the blue pointer is drawn on your screen."
          : "Control is off. Lantas reads the screen but does not act."}
      </div>
    </aside>
  );
}
