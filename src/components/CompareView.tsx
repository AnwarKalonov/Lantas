import { useEffect, useMemo, useRef, useState } from "react";
import { PROVIDERS } from "../lib/data";
import { buildHistory } from "../lib/chat";
import {
  isConfigured,
  prettyModel,
  streamChat,
  type ChatTurn,
  type StreamUsage,
} from "../lib/providers";
import { useStore } from "../lib/store";
import type { CompareSide, ProviderId, Session } from "../lib/types";
import { cx, uid } from "../lib/util";
import { playChime } from "../lib/chime";
import { Icon } from "./Icons";
import { Markdown, Transcript } from "./Transcript";
import { ModelPicker } from "./ModelPicker";

/**
 * Two chats, one question.
 *
 * This is not a separate screen. It is the chat you were already reading,
 * split into two conversations that keep the same thread context: the recent
 * turns sit above, each question opens a pair of answers below, and either
 * model can be swapped in the bar. Both columns share a scroll, so a row of
 * answers lines up while you read it.
 */

type Side = CompareSide;

interface Answer {
  text: string;
  ms: number;
  input: number;
  output: number;
  done: boolean;
  error: string;
}

interface Turn {
  id: string;
  question: string;
  answers: [Answer, Answer];
  /** The models this turn was asked of, so a later switch does not relabel it. */
  sides: [Side, Side];
}

const EMPTY_ANSWER: Answer = {
  text: "",
  ms: 0,
  input: 0,
  output: 0,
  done: false,
  error: "",
};

function modelsOf(id: ProviderId, settings: ReturnType<typeof useStore>["state"]["settings"]) {
  const config = settings.providers[id];
  const meta = PROVIDERS.find((item) => item.id === id);
  return Array.from(new Set([...(config?.models ?? []), ...(meta?.models ?? [])]));
}

function defaultSides(
  session: Session | null,
  settings: ReturnType<typeof useStore>["state"]["settings"],
): [Side, Side] {
  const connected = PROVIDERS.filter((meta) =>
    isConfigured(meta.id, settings.providers[meta.id]),
  );

  const leftProvider = session?.provider ?? settings.defaultProvider;
  const leftModel =
    session?.model ||
    settings.defaultModel ||
    modelsOf(leftProvider, settings)[0] ||
    "claude-sonnet-4-5";
  const left: Side = { provider: leftProvider, model: leftModel };

  // A second model from the same provider is the most likely one to be
  // connected too, so it is the default; another provider is the fallback.
  const alternate = modelsOf(left.provider, settings).find((entry) => entry !== left.model);
  if (alternate) return [left, { provider: left.provider, model: alternate }];

  for (const meta of connected) {
    const model = modelsOf(meta.id, settings).find(
      (entry) => !(meta.id === left.provider && entry === left.model),
    );
    if (model) return [left, { provider: meta.id, model }];
  }

  return [left, { provider: left.provider, model: left.model }];
}

function estimateTokens(text: string) {
  return Math.max(0, Math.round(text.length / 4));
}

/** The slowest minus the fastest, in seconds, when both finished cleanly. */
function gap(a: Answer, b: Answer) {
  if (!a.done || !b.done || a.error || b.error) return 0;
  return Math.abs(a.ms - b.ms) / 1000;
}

export function CompareView({
  session,
  seed = "",
  initialSides,
  autoAsk = false,
  onClose,
}: {
  session: Session | null;
  seed?: string;
  initialSides?: [CompareSide, CompareSide];
  autoAsk?: boolean;
  onClose: () => void;
}) {
  const { state, notify } = useStore();
  const settings = state.settings;
  const [sides, setSides] = useState<[Side, Side]>(
    () => initialSides ?? defaultSides(session, settings),
  );
  const [question, setQuestion] = useState(seed);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [running, setRunning] = useState(false);
  const [preference, setPreference] = useState<Record<string, 0 | 1>>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !running) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, running]);

  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  // Follow the answer as it streams, unless the user scrolled up to read.
  useEffect(() => {
    const el = streamRef.current;
    if (!el || !stick.current) return;
    el.scrollTop = el.scrollHeight;
  }, [turns]);

  const recent = useMemo(
    () => (session?.messages.length ? session.messages.slice(-4) : []),
    [session],
  );

  const system = useMemo(() => {
    const files = state.workspace
      .slice(0, 40)
      .map((file) => `${file.dir ? "dir " : "    "}${file.path}`)
      .join("\n");
    const project = state.workspaceName || session?.cwd || "no folder";
    return [
      "You are Lantas, answering one question side by side with another model.",
      `Workspace: ${project}${session?.branch ? ` on ${session.branch}` : ""}.`,
      "Answer directly and concretely for this workspace. Do not call tools, do not describe tool use, and never claim you edited or ran something.",
      "Short paragraphs, sentence case. Use a short code block only when code is the answer. Two models will answer the same question, so make the answer specific rather than balanced.",
      files ? `Workspace files:\n${files}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }, [session?.branch, session?.cwd, state.workspace, state.workspaceName]);

  const history = useMemo<ChatTurn[]>(
    () => (session ? buildHistory(session, 6) : []),
    [session],
  );

  const patchAnswer = (turnId: string, index: 0 | 1, patch: (answer: Answer) => Answer) => {
    setTurns((previous) =>
      previous.map((turn) =>
        turn.id === turnId
          ? {
              ...turn,
              answers: turn.answers.map((answer, spot) =>
                spot === index ? patch(answer) : answer,
              ) as [Answer, Answer],
            }
          : turn,
      ),
    );
  };

  const stop = () => {
    controller.current?.abort();
    controller.current = null;
    setRunning(false);
  };

  const ask = async (text: string) => {
    const prompt = text.trim();
    if (!prompt || running) return;

    const id = uid("compare");
    const controllerForRound = new AbortController();
    controller.current = controllerForRound;
    setRunning(true);
    setQuestion("");
    stick.current = true;
    const askedOf: [Side, Side] = [{ ...sides[0] }, { ...sides[1] }];
    setTurns((previous) => [
      ...previous,
      {
        id,
        question: prompt,
        answers: [{ ...EMPTY_ANSWER }, { ...EMPTY_ANSWER }],
        sides: askedOf,
      },
    ]);

    // Each column is its own conversation: it carries the thread so far plus
    // that side's own earlier answers, never the other model's.
    const messagesFor = (side: number): ChatTurn[] => {
      const prior: ChatTurn[] = turns.flatMap((turn) => {
        // A model only carries its own earlier answers; after a switch, the
        // previous model's replies are not this conversation.
        if (turn.sides[side].model !== sides[side].model) return [];
        const answer = turn.answers[side];
        return [
          { role: "user" as const, content: turn.question },
          ...(answer.text ? [{ role: "assistant" as const, content: answer.text }] : []),
        ];
      });
      return [...history, ...prior, { role: "user", content: prompt }];
    };

    await Promise.all(
      sides.map(async (side, index) => {
        const spot = index as 0 | 1;
        const begun = performance.now();
        let usage: StreamUsage = {};
        if (!isConfigured(side.provider, settings.providers[side.provider])) {
          patchAnswer(id, spot, () => ({
            ...EMPTY_ANSWER,
            done: true,
            error:
              "This provider is not connected yet. Choose another model or add a key in Settings → Providers.",
          }));
          return;
        }
        try {
          await streamChat({
            provider: side.provider,
            config: settings.providers[side.provider],
            model: side.model,
            system,
            messages: messagesFor(spot),
            signal: controllerForRound.signal,
            onDelta: (chunk) => {
              patchAnswer(id, spot, (answer) => ({ ...answer, text: answer.text + chunk }));
            },
            onUsage: (next) => {
              usage = { ...usage, ...next };
              patchAnswer(id, spot, (answer) => ({
                ...answer,
                input: usage.input ?? answer.input,
                output: usage.output ?? answer.output,
              }));
            },
          });
          patchAnswer(id, spot, (answer) => ({
            ...answer,
            done: true,
            ms: performance.now() - begun,
            input: usage.input ?? answer.input,
            output: usage.output ?? answer.output,
          }));
        } catch (error) {
          const aborted =
            controllerForRound.signal.aborted ||
            (error instanceof Error && error.name === "AbortError");
          patchAnswer(id, spot, (answer) => ({
            ...answer,
            done: true,
            ms: performance.now() - begun,
            error: aborted
              ? ""
              : error instanceof Error
                ? error.message
                : String(error),
          }));
        }
      }),
    );

    // The round is over even when it was aborted (closing the view, restarting
    // the effect in development, or the Stop button). Only clear the state if
    // this is still the active round, so a newer round is never marked idle.
    if (controller.current === controllerForRound) {
      controller.current = null;
      setRunning(false);
      if (!controllerForRound.signal.aborted && settings.sound) {
        playChime(settings.chimeDone, "done");
      }
    }
  };

  // A comparison started from the setup card already has its question and
  // models, so it opens straight into two answering chats. The ref keeps
  // React's double-invoked development effects from asking twice.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoAsk || autoStarted.current) return;
    const prompt = seed.trim();
    if (!prompt) return;
    // Deferring by a frame lets a development remount cancel the first timer
    // instead of starting two rounds and aborting one of them. In production
    // this is one frame, not a visible delay.
    const timer = window.setTimeout(() => {
      if (autoStarted.current) return;
      autoStarted.current = true;
      void ask(prompt);
    }, 40);
    return () => window.clearTimeout(timer);
    // ask is intentionally read once, with the initial sides and question.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAsk, seed]);

  const tokens = (answer: Answer) =>
    answer.input + answer.output || estimateTokens(answer.text);

  return (
    <section className="chat-compare" aria-label="Compare models">
      <header className="compare-top">
        <span className="compare-top-label">
          <Icon name="diff" size={13} />
          Two chats
        </span>
        <div className="compare-top-models">
          {sides.map((side, index) => (
            <span className="compare-top-model" key={index}>
              {index === 1 && <span className="compare-vs">vs</span>}
              <ModelPicker
                provider={side.provider}
                model={side.model}
                placement="down"
                onPick={(provider, model) => {
                  const next: [Side, Side] = [{ ...sides[0] }, { ...sides[1] }];
                  next[index as 0 | 1] = { provider, model };
                  setSides(next);
                }}
                onConnect={() => notify("Open Settings → Providers to connect this model", "error")}
              />
            </span>
          ))}
        </div>
        <div className="compare-top-actions">
          {turns.length > 0 && (
            <button
              type="button"
              className="compare-clear"
              onClick={() => {
                setTurns([]);
                setPreference({});
                inputRef.current?.focus();
              }}
            >
              Clear
            </button>
          )}
          <button
            type="button"
            className="compare-exit"
            onClick={onClose}
            title="Back to the single chat"
          >
            Exit
          </button>
        </div>
      </header>

      <div
        className="compare-stream"
        ref={streamRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
      >
        <div className="compare-inner">
          {recent.length > 0 && (
            <div className={cx("compare-history", historyOpen && "is-open")}>
              <button
                type="button"
                className="compare-history-toggle"
                onClick={() => setHistoryOpen((open) => !open)}
                aria-expanded={historyOpen}
              >
                <Icon name={historyOpen ? "chevronDown" : "chevronRight"} size={11} />
                <span>Earlier in this thread</span>
                <span className="compare-history-count">
                  {recent.length} message{recent.length === 1 ? "" : "s"}
                </span>
                <span className="compare-history-hint">Context for both chats</span>
              </button>
              {historyOpen && <Transcript messages={recent} compact />}
            </div>
          )}

          {turns.length === 0 ? (
            <div className="compare-welcome">
              <span className="compare-welcome-mark" aria-hidden="true">
                <Icon name="diff" size={18} />
              </span>
              <h2>Two chats, one question</h2>
              <p>
                Both models answer from this thread's context in their own conversation.
                Ask once and read the answers side by side.
              </p>
            </div>
          ) : (
            turns.map((turn, turnIndex) => {
              const bothDone = turn.answers.every((answer) => answer.done);
              const clean = turn.answers.filter((answer) => answer.done && !answer.error);
              const faster =
                clean.length === 2
                  ? clean[0].ms <= clean[1].ms
                    ? turn.answers.indexOf(clean[0])
                    : turn.answers.indexOf(clean[1])
                  : -1;
              const chosen = preference[turn.id];
              const fasterSide = faster === 0 || faster === 1 ? turn.sides[faster] : null;

              return (
                <div className="compare-turn" key={turn.id}>
                  <div className="msg msg-user compare-question">
                    <div className="user-card">
                      <p>{turn.question}</p>
                    </div>
                  </div>

                  <div className="compare-pair">
                    {sides.map((side, index) => {
                      const answer = turn.answers[index as 0 | 1];
                      const isFast = bothDone && faster === index;
                      return (
                        <article
                          className={cx("compare-pane", isFast && "is-fast")}
                          key={index}
                          style={{ animationDelay: `${index * 45}ms` }}
                        >
                          <div className="compare-body">
                            {answer.error ? (
                              <div className="compare-fail">
                                <span className="compare-fail-mark" aria-hidden="true">
                                  <Icon name="plug" size={15} />
                                </span>
                                <p className="compare-fail-title">Model not connected</p>
                                <p className="compare-fail-text">{answer.error}</p>
                                <button
                                  type="button"
                                  onClick={() =>
                                    window.dispatchEvent(
                                      new CustomEvent("lantas:settings", {
                                        detail: { tab: "models" },
                                      }),
                                    )
                                  }
                                >
                                  Open provider settings
                                </button>
                              </div>
                            ) : answer.text ? (
                              <Markdown text={answer.text} />
                            ) : (
                              <div className="compare-wait">
                                <span className="compare-pulse" />
                                {running ? "Thinking…" : "No answer yet"}
                              </div>
                            )}
                            {running && !answer.done && answer.text && (
                              <span className="compare-caret" aria-hidden="true" />
                            )}
                          </div>

                          <footer className="compare-meta">
                            <span className="compare-model-name">
                              {prettyModel(turn.sides[index as 0 | 1].model)}
                            </span>
                            {isFast && <span className="compare-win">Faster</span>}
                            <span className="compare-stat">
                              {answer.error
                                ? "—"
                                : answer.done
                                  ? `${(answer.ms / 1000).toFixed(1)}s`
                                  : running
                                    ? "running"
                                    : "—"}
                            </span>
                            <span className="compare-stat">
                              {tokens(answer).toLocaleString()} tokens
                            </span>
                            <button
                              type="button"
                              className="compare-copy"
                              onClick={() => {
                                navigator.clipboard?.writeText(answer.text).catch(() => {});
                                notify("Answer copied");
                              }}
                              disabled={!answer.text}
                              aria-label={`Copy ${prettyModel(side.model)} answer`}
                              title="Copy answer"
                            >
                              <Icon name="copy" size={12} />
                            </button>
                          </footer>
                        </article>
                      );
                    })}
                  </div>

                  <div className="compare-turn-foot">
                    <span className="compare-turn-note">
                      {bothDone && clean.length === 2 && fasterSide
                        ? `${prettyModel(fasterSide.model)} finished ${gap(
                            turn.answers[0],
                            turn.answers[1],
                          ).toFixed(1)}s sooner`
                        : bothDone && clean.length === 1
                          ? "Only one model answered"
                          : bothDone
                            ? "Connect a provider to compare answers"
                          : running
                            ? "Both models are answering…"
                            : ""}
                    </span>
                    <span className="compare-pref-label">Prefer</span>
                    <span className="compare-pref">
                      {turn.sides.map((side, index) => (
                        <button
                          key={index}
                          type="button"
                          className={chosen === index ? "is-on" : ""}
                          onClick={() =>
                            setPreference((previous) => ({
                              ...previous,
                              [turn.id]: index as 0 | 1,
                            }))
                          }
                        >
                          {prettyModel(side.model)}
                        </button>
                      ))}
                    </span>
                    <span className="compare-turn-index">#{turnIndex + 1}</span>
                  </div>
                </div>
              );
            })
          )}
          <div className="compare-tail" />
        </div>
      </div>

      <div className="composer-dock compare-dock">
        <div className={cx("composer compare-composer", running && "is-streaming")}>
          <textarea
            ref={inputRef}
            className="composer-input"
            rows={1}
            value={question}
            placeholder="Ask both models…"
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void ask(question);
              }
            }}
          />
          <div className="composer-bar">
            <div className="composer-tools">
              <span className="compare-chip">
                <Icon name="folder" size={11} />
                {state.workspaceName || session?.title || "This thread"}
              </span>
              <span className="compare-ask-note">Same question, both chats</span>
            </div>
            <div className="composer-end">
              {running ? (
                <button
                  type="button"
                  className="send-button is-stop"
                  onClick={stop}
                  aria-label="Stop both models"
                  title="Stop"
                >
                  <Icon name="stop" size={12} />
                </button>
              ) : (
                <button
                  type="button"
                  className="send-button"
                  onClick={() => void ask(question)}
                  disabled={!question.trim()}
                  aria-label="Ask both models"
                  title="Ask both models"
                >
                  <Icon name="arrowUp" size={15} strokeWidth={1.8} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
