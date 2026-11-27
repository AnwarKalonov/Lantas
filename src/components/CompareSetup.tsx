import { useEffect, useMemo, useRef, useState } from "react";
import { PROVIDERS } from "../lib/data";
import { isConfigured, prettyModel } from "../lib/providers";
import { useStore } from "../lib/store";
import type { CompareSide, ProviderId, Session } from "../lib/types";
import { Icon } from "./Icons";
import { ModelPicker } from "./ModelPicker";

/**
 * The step before a comparison.
 *
 * Clicking Compare must not replace the thread you are reading. This card sits
 * over the composer, asks for the two models and the question, and only then
 * opens the two-column surface. It is the same shape as the Keep/Discard bar:
 * one line of context, the choices, then one clear action.
 */

function modelsOf(id: ProviderId, settings: ReturnType<typeof useStore>["state"]["settings"]) {
  const config = settings.providers[id];
  const meta = PROVIDERS.find((item) => item.id === id);
  return Array.from(new Set([...(config?.models ?? []), ...(meta?.models ?? [])]));
}

export function pickDefaultSides(
  session: Session | null,
  settings: ReturnType<typeof useStore>["state"]["settings"],
): [CompareSide, CompareSide] {
  const connected = PROVIDERS.filter((meta) =>
    isConfigured(meta.id, settings.providers[meta.id]),
  );
  // Prefer the model this chat is using, but only when it can actually answer.
  // An empty “New session” can still point at an old provider with no key; the
  // setup card must fall back to a connected one instead of disabling Start.
  const sessionReady = Boolean(
    session && isConfigured(session.provider, settings.providers[session.provider]),
  );
  const defaultReady = isConfigured(
    settings.defaultProvider,
    settings.providers[settings.defaultProvider],
  );
  const leftProvider = sessionReady
    ? (session?.provider ?? settings.defaultProvider)
    : defaultReady
      ? settings.defaultProvider
      : (connected[0]?.id ?? settings.defaultProvider);
  const leftModel =
    (sessionReady && session?.model) ||
    (defaultReady && settings.defaultProvider === leftProvider && settings.defaultModel) ||
    modelsOf(leftProvider, settings)[0] ||
    "claude-sonnet-4-5";
  const left: CompareSide = { provider: leftProvider, model: leftModel };

  const alternate = modelsOf(left.provider, settings).find((entry) => entry !== left.model);
  if (alternate) return [left, { provider: left.provider, model: alternate }];

  for (const meta of connected) {
    const model = modelsOf(meta.id, settings).find(
      (entry) => !(meta.id === left.provider && entry === left.model),
    );
    if (model) return [left, { provider: meta.id, model }];
  }
  return [left, { ...left }];
}

export function CompareSetup({
  session,
  seed = "",
  onStart,
  onCancel,
  onConnect,
}: {
  session: Session | null;
  seed?: string;
  onStart: (sides: [CompareSide, CompareSide], question: string) => void;
  onCancel: () => void;
  onConnect: () => void;
}) {
  const { state } = useStore();
  const settings = state.settings;
  const [sides, setSides] = useState<[CompareSide, CompareSide]>(() =>
    pickDefaultSides(session, settings),
  );
  const [question, setQuestion] = useState(seed);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    // The question is what this card is for; the pickers are already sensible.
    const id = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const ready = useMemo(
    () =>
      sides.every((side) => isConfigured(side.provider, settings.providers[side.provider])) &&
      question.trim().length > 0,
    [sides, settings.providers, question],
  );

  const setSide = (index: 0 | 1, provider: ProviderId, model: string) => {
    setSides((current) => {
      const next: [CompareSide, CompareSide] = [{ ...current[0] }, { ...current[1] }];
      next[index] = { provider, model };
      return next;
    });
  };

  const start = () => {
    if (!ready) return;
    onStart([{ ...sides[0] }, { ...sides[1] }], question.trim());
  };

  return (
    <div className="compare-setup-wrap">
      <section className="compare-setup" aria-label="Compare two models">
        <header className="compare-setup-head">
          <span className="compare-setup-mark" aria-hidden="true">
            <Icon name="diff" size={14} />
          </span>
          <span className="compare-setup-title">Compare two models</span>
          <span className="compare-setup-note">Same thread, same question</span>
          <button
            type="button"
            className="compare-setup-close"
            onClick={onCancel}
            aria-label="Close compare"
            title="Close"
          >
            <Icon name="close" size={12} />
          </button>
        </header>

        <div className="compare-setup-models">
          {sides.map((side, index) => (
            <div className="compare-setup-side" key={index}>
              {index === 1 && <span className="compare-setup-vs">vs</span>}
              <span className="compare-setup-side-label">
                {index === 0 ? "Model A" : "Model B"}
              </span>
              <ModelPicker
                provider={side.provider}
                model={side.model}
                placement="down"
                onPick={(provider, model) => setSide(index as 0 | 1, provider, model)}
                onConnect={onConnect}
              />
            </div>
          ))}
        </div>

        <div className="compare-setup-question">
          <textarea
            ref={inputRef}
            rows={1}
            value={question}
            placeholder="What should both models answer?"
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                start();
              }
            }}
            aria-label="Question for both models"
          />
          <button
            type="button"
            className="compare-setup-start"
            onClick={start}
            disabled={!ready}
            title={
              ready
                ? "Open both chats side by side"
                : "Connect both providers and write a question first"
            }
          >
            Compare
            <Icon name="arrowUp" size={12} strokeWidth={2} />
          </button>
        </div>

        <footer className="compare-setup-foot">
          <span>
            {prettyModel(sides[0].model)} and {prettyModel(sides[1].model)} answer in their own
            chat. Nothing in this thread changes.
          </span>
          <span className="compare-setup-key">↵ to start · esc to close</span>
        </footer>
      </section>
    </div>
  );
}
