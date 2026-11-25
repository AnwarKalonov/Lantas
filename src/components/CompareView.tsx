import { useEffect, useMemo, useRef, useState } from "react";
import { PROVIDERS } from "../lib/data";
import {
  buildHistory,
} from "../lib/chat";
import {
  isConfigured,
  prettyModel,
  streamChat,
  type ChatTurn,
  type StreamUsage,
} from "../lib/providers";
import { useStore } from "../lib/store";
import type { ProviderId, Session } from "../lib/types";
import { cx } from "../lib/util";
import { Icon } from "./Icons";
import { ModelPicker } from "./ModelPicker";

/**
 * Two models, one question, side by side.
 *
 * The point is not a vote: it is seeing where two models disagree about the
 * same folder. Both streams share the session's recent history and workspace
 * list, so the answers are about the work in front of the user, not a generic
 * prompt. Time and token count sit under each answer; the faster one gets a
 * quiet label once both have finished.
 */

interface Side {
  provider: ProviderId;
  model: string;
}

interface Answer {
  text: string;
  ms: number;
  input: number;
  output: number;
  done: boolean;
  error: string;
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

export function CompareView({
  session,
  seed = "",
  onClose,
}: {
  session: Session | null;
  seed?: string;
  onClose: () => void;
}) {
  const { state, notify } = useStore();
  const settings = state.settings;
  const [sides, setSides] = useState<[Side, Side]>(() => defaultSides(session, settings));
  const [question, setQuestion] = useState(seed);
  const [answers, setAnswers] = useState<[Answer, Answer]>([EMPTY_ANSWER, EMPTY_ANSWER]);
  const [running, setRunning] = useState(false);
  const [round, setRound] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  const started = answers.some((answer) => answer.done || answer.text);

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

  const patchAnswer = (index: 0 | 1, patch: (answer: Answer) => Answer) => {
    setAnswers((previous) => {
      const next: [Answer, Answer] = [{ ...previous[0] }, { ...previous[1] }];
      next[index] = patch(next[index]);
      return next;
    });
  };

  const stop = () => {
    controller.current?.abort();
    controller.current = null;
    setRunning(false);
  };

  const ask = async (text: string) => {
    const prompt = text.trim();
    if (!prompt || running) return;
    const controllerForRound = new AbortController();
    controller.current = controllerForRound;
    setRunning(true);
    setRound((value) => value + 1);
    setAnswers([{ ...EMPTY_ANSWER }, { ...EMPTY_ANSWER }]);

    const messages: ChatTurn[] = [...history, { role: "user", content: prompt }];

    await Promise.all(
      sides.map(async (side, index) => {
        const spot = index as 0 | 1;
        const begun = performance.now();
        let usage: StreamUsage = {};
        if (!isConfigured(side.provider, settings.providers[side.provider])) {
          patchAnswer(spot, () => ({
            ...EMPTY_ANSWER,
            done: true,
            error: "This provider is not connected yet. Choose another model or add a key in Settings → Providers.",
          }));
          return;
        }
        try {
          await streamChat({
            provider: side.provider,
            config: settings.providers[side.provider],
            model: side.model,
            system,
            messages,
            signal: controllerForRound.signal,
            onDelta: (chunk) => {
              patchAnswer(spot, (answer) => ({ ...answer, text: answer.text + chunk }));
            },
            onUsage: (next) => {
              usage = { ...usage, ...next };
              patchAnswer(spot, (answer) => ({
                ...answer,
                input: usage.input ?? answer.input,
                output: usage.output ?? answer.output,
              }));
            },
          });
          patchAnswer(spot, (answer) => ({
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
          patchAnswer(spot, (answer) => ({
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

    if (!controllerForRound.signal.aborted) {
      controller.current = null;
      setRunning(false);
    }
  };

  const bothDone = answers.every((answer) => answer.done);
  const finished = answers.filter((answer) => answer.done && !answer.error);
  const faster =
    bothDone && finished.length === 2
      ? [...finished].sort((a, b) => a.ms - b.ms)[0]
      : null;
  const fastestSide = faster ? sides[answers.indexOf(faster)] : null;

  const tokens = (answer: Answer) =>
    answer.input + answer.output || estimateTokens(answer.text);

  return (
    <div className="overlay compare-overlay" onMouseDown={onClose}>
      <section
        className="compare-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Compare models"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="compare-head">
          <div className="compare-title">
            <h2>Compare Models</h2>
            <span className="compare-count">
              {round} {round === 1 ? "exchange" : "exchanges"}
            </span>
          </div>
          <div className="compare-head-actions">
            {started && (
              <button
                type="button"
                className="compare-new"
                onClick={() => {
                  setAnswers([{ ...EMPTY_ANSWER }, { ...EMPTY_ANSWER }]);
                  setQuestion("");
                  setRound(0);
                  inputRef.current?.focus();
                }}
              >
                <Icon name="plus" size={13} />
                New comparison
              </button>
            )}
            <button
              type="button"
              className="icon-button"
              onClick={onClose}
              aria-label="Close comparison"
            >
              <Icon name="close" size={15} />
            </button>
          </div>
        </header>

        <div className="compare-grid">
          {sides.map((side, index) => {
            const answer = answers[index as 0 | 1];
            const isFast = Boolean(fastestSide && fastestSide.model === side.model);
            return (
              <article className="compare-pane" key={index}>
                  <header className="compare-pane-head">
                    <ModelPicker
                      provider={side.provider}
                      model={side.model}
                      onPick={(provider, model) => {
                        const next: [Side, Side] = [{ ...sides[0] }, { ...sides[1] }];
                        next[index as 0 | 1] = { provider, model };
                        setSides(next);
                      }}
                      onConnect={() => notify("Open Settings → Providers to connect this model", "error")}
                    />
                    {isFast && <span className="compare-win">Faster</span>}
                  </header>

                  <div className="compare-body">
                    {!started ? (
                      <div className="compare-idle">
                        <Icon name="diff" size={15} />
                        <p>This answer will appear here. Both models get the same question and the same workspace.</p>
                      </div>
                    ) : answer.error ? (
                      <p className="compare-error">{answer.error}</p>
                    ) : answer.text ? (
                      <div className="compare-text">{answer.text}</div>
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
                    <button
                      type="button"
                      className="compare-copy"
                      onClick={() => {
                        navigator.clipboard?.writeText(answer.text).catch(() => {});
                        notify("Answer copied");
                      }}
                      disabled={!answer.text}
                    >
                      <Icon name="copy" size={12} />
                      Copy
                    </button>
                    <span className="compare-stat">
                      {answer.done ? `${(answer.ms / 1000).toFixed(1)}s` : running ? "running" : "—"}
                    </span>
                    <span className="compare-stat">{tokens(answer).toLocaleString()} tokens</span>
                  </footer>
                </article>
              );
            })}
        </div>

        <div className="compare-ask">
          <div className="compare-context">
            <span className="compare-chip">
              <Icon name="folder" size={11} />
              {state.workspaceName || session?.title || "This thread"}
            </span>
            <span className="compare-models">
              {prettyModel(sides[0].model)} vs {prettyModel(sides[1].model)}
            </span>
            {fastestSide && bothDone && finished.length === 2 && (
              <span className="compare-verdict">
                {prettyModel(fastestSide.model)} answered{" "}
                {((Math.max(...finished.map((answer) => answer.ms)) -
                  Math.min(...finished.map((answer) => answer.ms))) /
                  1000
                ).toFixed(1)}
                s sooner
              </span>
            )}
          </div>
          <div className={cx("compare-input", running && "is-running")}>
            <textarea
              ref={inputRef}
              value={question}
              rows={1}
              placeholder="Ask both models about this file…"
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void ask(question);
                }
              }}
            />
            {running ? (
              <button
                type="button"
                className="compare-send is-stop"
                onClick={stop}
                aria-label="Stop both models"
                title="Stop"
              >
                <Icon name="stop" size={13} />
              </button>
            ) : (
              <button
                type="button"
                className="compare-send"
                onClick={() => void ask(question)}
                disabled={!question.trim()}
                aria-label="Ask both models"
                title="Ask both models"
              >
                <Icon name="arrowUp" size={14} />
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

