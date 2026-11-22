import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { AGENTS, PROVIDERS, SLASH_COMMANDS } from "../lib/data";
import { isConfigured, prettyModel } from "../lib/providers";
import type { AgentId, ProviderId } from "../lib/types";
import { cx } from "../lib/util";
import { Icon } from "./Icons";

interface ComposerProps {
  variant: "home" | "session";
  agent: AgentId;
  provider: ProviderId;
  model: string;
  streaming?: boolean;
  contextUsed?: number;
  contextWindow?: number;
  onSend: (text: string) => void;
  onStop?: () => void;
  onAgentChange: (agent: AgentId) => void;
  onModelChange: (provider: ProviderId, model: string) => void;
  onOpenProviders: () => void;
}

export function Composer({
  variant,
  agent,
  provider,
  model,
  streaming = false,
  contextUsed = 0,
  contextWindow = 200_000,
  onSend,
  onStop,
  onAgentChange,
  onModelChange,
  onOpenProviders,
}: ComposerProps) {
  const { state, setSettings, notify } = useStore();
  const [text, setText] = useState("");
  const [menu, setMenu] = useState<"agent" | "model" | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const agentMeta = AGENTS.find((item) => item.id === agent) ?? AGENTS[0];
  const providerMeta = PROVIDERS.find((item) => item.id === provider) ?? PROVIDERS[0];
  const connected = isConfigured(provider, state.settings.providers[provider]);
  const percent = contextWindow > 0 ? Math.round((contextUsed / contextWindow) * 100) : 0;

  const slashQuery =
    text.startsWith("/") && !text.includes(" ") && !text.includes("\n")
      ? text.slice(1).toLowerCase()
      : null;

  const slashMatches = useMemo(() => {
    if (slashQuery === null) return [];
    return SLASH_COMMANDS.filter((item) => item.command.slice(1).toLowerCase().startsWith(slashQuery));
  }, [slashQuery]);

  const slashOpen = slashQuery !== null && slashMatches.length > 0;

  useEffect(() => {
    textareaRef.current?.focus();
  }, [variant]);

  useEffect(() => setSlashIndex(0), [slashQuery]);

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if (!barRef.current?.contains(event.target as Node)) setMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

  const submit = () => {
    const value = text.trim();
    if (!value || streaming) return;
    onSend(value);
    setText("");
    setMenu(null);
    requestAnimationFrame(() => {
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    });
  };

  const applyCommand = (command: string) => {
    setText(`${command} `);
    textareaRef.current?.focus();
  };

  return (
    <div className={cx("composer-wrap", `composer-${variant}`)}>
      <div className={cx("composer", streaming && "is-streaming")}>
        <textarea
          ref={textareaRef}
          className="composer-input"
          rows={1}
          spellCheck={false}
          autoComplete="off"
          aria-label="Message Lantas"
          placeholder={variant === "home" ? "Ask anything, or describe a task" : "Follow up…"}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              if (slashOpen) {
                event.preventDefault();
                applyCommand(slashMatches[Math.min(slashIndex, slashMatches.length - 1)].command);
                return;
              }
              if (event.metaKey || (state.settings.sendOnEnter && !event.shiftKey)) {
                event.preventDefault();
                submit();
                return;
              }
            }
            if (slashOpen) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSlashIndex((index) => (index + 1) % slashMatches.length);
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setSlashIndex((index) => (index - 1 + slashMatches.length) % slashMatches.length);
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setText("");
              }
            }
          }}
        />

        {slashOpen && (
          <div className="slash-menu" role="listbox">
            {slashMatches.map((item, index) => (
              <button
                key={item.command}
                type="button"
                className={cx("slash-row", index === slashIndex && "is-active")}
                onMouseEnter={() => setSlashIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  applyCommand(item.command);
                }}
              >
                <span className="slash-name">{item.command}</span>
                <span className="slash-label">{item.label}</span>
              </button>
            ))}
          </div>
        )}

        <div className="composer-bar" ref={barRef}>
          <div className="composer-tools">
            <button
              type="button"
              className="bar-icon"
              onClick={() => {
                setText("/");
                textareaRef.current?.focus();
              }}
              title="Slash commands"
              aria-label="Slash commands"
            >
              <Icon name="plus" size={15} />
            </button>

            <button
              type="button"
              className={cx("bar-pill", menu === "agent" && "is-open")}
              onClick={() => setMenu(menu === "agent" ? null : "agent")}
              title="Agent"
            >
              <span className={cx("bar-dot", connected ? "is-live" : "is-demo")} />
              {agentMeta.name}
              <Icon name="chevronDown" size={12} />
            </button>

            <button
              type="button"
              className={cx("bar-pill", menu === "model" && "is-open")}
              onClick={() => setMenu(menu === "model" ? null : "model")}
              title={`${providerMeta.name} · ${prettyModel(model)}`}
            >
              {prettyModel(model)}
              <Icon name="chevronDown" size={12} />
            </button>

            <span className="bar-divider" />

            <button
              type="button"
              className={cx("bar-icon", state.settings.screenAccess && "is-on")}
              aria-pressed={state.settings.screenAccess}
              onClick={() => {
                setSettings({ screenAccess: !state.settings.screenAccess });
                notify(state.settings.screenAccess ? "Screen access off" : "Screen access on");
              }}
              title="Read the frontmost window"
              aria-label="Screen access"
            >
              <Icon name="screen" size={14} />
            </button>
            <button
              type="button"
              className={cx("bar-icon", state.settings.computerControl && "is-on")}
              aria-pressed={state.settings.computerControl}
              onClick={() => {
                setSettings({ computerControl: !state.settings.computerControl });
                notify(
                  state.settings.computerControl
                    ? "Computer control off"
                    : "Computer control on — pointer and keyboard",
                );
              }}
              title="Pointer and keyboard control"
              aria-label="Computer control"
            >
              <Icon name="cursor" size={14} />
            </button>
          </div>

          <div className="composer-end">
            {variant === "session" && (
              <span className={cx("context-pct", percent > 80 && "is-high")} title="Context used">
                {percent}%
              </span>
            )}
            {streaming ? (
              <button
                type="button"
                className="send-button is-stop"
                onClick={onStop}
                aria-label="Stop"
                title="Stop (esc)"
              >
                <Icon name="stop" size={12} />
              </button>
            ) : (
              <button
                type="button"
                className="send-button"
                onClick={submit}
                disabled={!text.trim()}
                aria-label="Send"
                title="Send"
              >
                <Icon name="arrowUp" size={15} strokeWidth={1.8} />
              </button>
            )}
          </div>

          {menu === "agent" && (
            <div className="popover chip-popover">
              {AGENTS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={cx("popover-row", item.id === agent && "is-active")}
                  onClick={() => {
                    onAgentChange(item.id);
                    setMenu(null);
                  }}
                >
                  <span className="popover-text">
                    <span className="popover-title">{item.name}</span>
                    <span className="popover-sub">{item.description}</span>
                  </span>
                  {item.id === agent && <Icon name="check" size={14} />}
                </button>
              ))}
            </div>
          )}

          {menu === "model" && (
            <div className="popover model-popover">
              {PROVIDERS.map((meta) => {
                const config = state.settings.providers[meta.id];
                const ready = isConfigured(meta.id, config);
                const models = Array.from(new Set([...config.models, ...meta.models, model]));
                return (
                  <div className="model-group" key={meta.id}>
                    <div className="model-group-label">
                      <span>{meta.name}</span>
                      {meta.local ? (
                        <span className="model-tag">local</span>
                      ) : ready ? null : (
                        <span className="model-tag">needs key</span>
                      )}
                    </div>
                    {ready ? (
                      models.map((entry) => (
                        <button
                          key={`${meta.id}-${entry}`}
                          type="button"
                          className={cx(
                            "popover-row model-option",
                            meta.id === provider && entry === model && "is-active",
                          )}
                          onClick={() => {
                            onModelChange(meta.id, entry);
                            setMenu(null);
                          }}
                        >
                          <span className="popover-title">{prettyModel(entry)}</span>
                          {meta.id === provider && entry === model && <Icon name="check" size={14} />}
                        </button>
                      ))
                    ) : (
                      <button
                        type="button"
                        className="popover-row model-option is-muted"
                        onClick={() => {
                          setMenu(null);
                          onOpenProviders();
                        }}
                      >
                        <span className="popover-title">Connect {meta.name}</span>
                        <Icon name="chevronRight" size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
              <div className="popover-foot">
                <button type="button" className="text-button" onClick={onOpenProviders}>
                  Manage providers
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {!connected && (
        <div className="composer-note">
          <span>Demo runtime — connect a provider for live replies.</span>
          <button type="button" className="text-button" onClick={onOpenProviders}>
            Connect
          </button>
        </div>
      )}
    </div>
  );
}
