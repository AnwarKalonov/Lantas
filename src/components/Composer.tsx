import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { AGENTS, PROVIDERS, SLASH_COMMANDS } from "../lib/data";
import { isConfigured, isFreeModel, prettyModel } from "../lib/providers";
import { fileKind } from "../lib/workspace";
import type { AgentId, Attachment, ProviderId } from "../lib/types";
import { cx, uid } from "../lib/util";
import { Icon } from "./Icons";

const IMAGE_LIMIT = 4_000_000;
const TEXT_LIMIT = 400_000;

interface ComposerProps {
  variant: "home" | "session";
  agent: AgentId;
  provider: ProviderId;
  model: string;
  streaming?: boolean;
  contextUsed?: number;
  contextWindow?: number;
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop?: () => void;
  onAgentChange: (agent: AgentId) => void;
  onModelChange: (provider: ProviderId, model: string) => void;
  onOpenProviders: () => void;
  onScreenToggle?: () => void;
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
  onScreenToggle,
}: ComposerProps) {
  const { state, setSettings, notify } = useStore();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [menu, setMenu] = useState<"agent" | "model" | null>(null);
  const [modelQuery, setModelQuery] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
    const custom = state.commands.map((item) => ({
      command: `/${item.name}`,
      label: item.description || "Custom command",
    }));
    const skills = state.skills.map((item) => ({
      command: `/${item.name}`,
      label: item.description || "Skill",
    }));
    const seen = new Set<string>();
    return [...SLASH_COMMANDS, ...skills, ...custom].filter((item) => {
      if (seen.has(item.command)) return false;
      seen.add(item.command);
      return item.command.slice(1).toLowerCase().startsWith(slashQuery);
    });
  }, [slashQuery, state.commands, state.skills]);

  const mentionMatch = /(?:^|\s)@([\w./-]*)$/.exec(text);
  const mentionQuery = mentionMatch ? mentionMatch[1].toLowerCase() : null;
  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];
    return state.workspace
      .filter((file) => file.path.toLowerCase().includes(mentionQuery))
      .slice(0, 6);
  }, [mentionQuery, state.workspace]);

  const slashOpen = slashQuery !== null && slashMatches.length > 0;
  const mentionOpen = mentionQuery !== null && mentionMatches.length > 0;

  useEffect(() => {
    textareaRef.current?.focus();
  }, [variant]);

  useEffect(() => setSlashIndex(0), [slashQuery]);
  useEffect(() => setMentionIndex(0), [mentionQuery]);

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
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const attach = async (list: FileList | null) => {
    if (!list?.length) return;
    const next: Attachment[] = [];
    for (const file of Array.from(list)) {
      const kind = fileKind(file.name);
      if (kind === "image") {
        if (file.size > IMAGE_LIMIT) {
          notify(`${file.name} is larger than 4 MB`, "error");
          continue;
        }
        const body = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.readAsDataURL(file);
        });
        next.push({ id: uid("att"), name: file.name, size: file.size, kind: "image", body });
      } else if (kind === "text") {
        const body = await file.text();
        next.push({
          id: uid("att"),
          name: file.name,
          size: file.size,
          kind: "text",
          body: body.slice(0, TEXT_LIMIT),
        });
      } else {
        next.push({ id: uid("att"), name: file.name, size: file.size, kind: "other", body: "" });
      }
    }
    setAttachments((current) => [...current, ...next]);
    notify(`${next.length} file${next.length === 1 ? "" : "s"} attached`);
  };

  const submit = () => {
    const value = text.trim();
    if ((!value && attachments.length === 0) || streaming) return;
    onSend(value, attachments);
    setText("");
    setAttachments([]);
    setMenu(null);
    requestAnimationFrame(() => {
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    });
  };

  const applyCommand = (command: string) => {
    setText(`${command} `);
    textareaRef.current?.focus();
  };

  const applyMention = (path: string) => {
    setText((current) => current.replace(/@([\w./-]*)$/, `@${path} `));
    textareaRef.current?.focus();
  };

  return (
    <div className={cx("composer-wrap", `composer-${variant}`)}>
      <div className={cx("composer", streaming && "is-streaming")}>
        {attachments.length > 0 && (
          <div className="attach-row">
            {attachments.map((file) => (
              <span className={cx("attach-chip", file.kind === "image" && "is-image")} key={file.id}>
                {file.kind === "image" ? (
                  <img src={file.body} alt="" />
                ) : (
                  <Icon name="file" size={12} />
                )}
                <span className="attach-name">{file.name}</span>
                <button
                  type="button"
                  className="attach-remove"
                  aria-label={`Remove ${file.name}`}
                  onClick={() =>
                    setAttachments((current) => current.filter((item) => item.id !== file.id))
                  }
                >
                  <Icon name="close" size={11} />
                </button>
              </span>
            ))}
          </div>
        )}

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
          onPaste={(event) => {
            const files = event.clipboardData?.files;
            if (files?.length) {
              event.preventDefault();
              void attach(files);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              if (slashOpen) {
                event.preventDefault();
                applyCommand(slashMatches[Math.min(slashIndex, slashMatches.length - 1)].command);
                return;
              }
              if (mentionOpen) {
                event.preventDefault();
                applyMention(mentionMatches[Math.min(mentionIndex, mentionMatches.length - 1)].path);
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
            } else if (mentionOpen) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setMentionIndex((index) => (index + 1) % mentionMatches.length);
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setMentionIndex((index) => (index - 1 + mentionMatches.length) % mentionMatches.length);
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

        {mentionOpen && (
          <div className="slash-menu mention-menu" role="listbox">
            {mentionMatches.map((file, index) => (
              <button
                key={file.id}
                type="button"
                className={cx("slash-row", index === mentionIndex && "is-active")}
                onMouseEnter={() => setMentionIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  applyMention(file.path);
                }}
              >
                <span className="slash-name">@{file.name}</span>
                <span className="slash-label">{file.path}</span>
              </button>
            ))}
          </div>
        )}

        <div className="composer-bar" ref={barRef}>
          <div className="composer-tools">
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                void attach(event.target.files);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              className="bar-icon"
              onClick={() => fileRef.current?.click()}
              title="Attach files"
              aria-label="Attach files"
            >
              <Icon name="paperclip" size={15} />
            </button>

            <button
              type="button"
              className="bar-icon"
              onClick={() => setText((value) => (value.startsWith("/") ? value : `/${value}`))}
              title="Slash commands"
              aria-label="Slash commands"
            >
              <Icon name="command" size={14} />
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
                if (onScreenToggle) onScreenToggle();
                else setSettings({ screenAccess: !state.settings.screenAccess });
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
                disabled={!text.trim() && attachments.length === 0}
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

          {menu === "model" && (() => {
            const query = modelQuery.trim().toLowerCase();
            const favorites = state.settings.favoriteModels;
            const key = (id: ProviderId, entry: string) => `${id}/${entry}`;
            const toggleFavorite = (id: ProviderId, entry: string) => {
              const value = key(id, entry);
              setSettings({
                favoriteModels: favorites.includes(value)
                  ? favorites.filter((item) => item !== value)
                  : [...favorites, value],
              });
            };

            return (
              <div className="popover model-popover">
                <label className="popover-search">
                  <Icon name="search" size={12} />
                  <input
                    autoFocus
                    value={modelQuery}
                    onChange={(event) => setModelQuery(event.target.value)}
                    placeholder="Search models — “free”"
                    spellCheck={false}
                  />
                </label>

                {favorites.length > 0 && query === "" && (
                  <div className="model-group pinned-section">
                    <div className="model-group-label">
                      <span>Pinned</span>
                    </div>
                    {favorites.map((value) => {
                      const [id, ...rest] = value.split("/");
                      const entry = rest.join("/");
                      if (!PROVIDERS.some((meta) => meta.id === id)) return null;
                      return (
                        <button
                          key={value}
                          type="button"
                          className={cx(
                            "popover-row model-option",
                            id === provider && entry === model && "is-active",
                          )}
                          onClick={() => {
                            onModelChange(id as ProviderId, entry);
                            setMenu(null);
                          }}
                        >
                          <span className="popover-title">{prettyModel(entry)}</span>
                          {isFreeModel(id as ProviderId, entry) && (
                            <span className="model-free">free</span>
                          )}
                          {id === provider && entry === model && <Icon name="check" size={14} />}
                        </button>
                      );
                    })}
                  </div>
                )}

                {PROVIDERS.map((meta) => {
                  const config = state.settings.providers[meta.id];
                  const ready = isConfigured(meta.id, config);
                  const all = Array.from(new Set([...config.models, ...meta.models, model]));
                  const models = all
                    .filter(
                      (entry) =>
                        query === "" ||
                        entry.toLowerCase().includes(query) ||
                        prettyModel(entry).toLowerCase().includes(query),
                    )
                    .sort((a, b) => {
                      if (meta.id === "openrouter") {
                        const free =
                          Number(isFreeModel(meta.id, b)) - Number(isFreeModel(meta.id, a));
                        if (free !== 0) return free;
                      }
                      return a.localeCompare(b);
                    });
                  const shown = query === "" ? models.slice(0, 8) : models.slice(0, 40);
                  // While searching, only groups with a hit are worth showing.
                  if (query !== "" && (!ready || shown.length === 0)) return null;

                  return (
                    <div className="model-group" key={meta.id}>
                      <div className="model-group-label">
                        <span>{meta.name}</span>
                        {meta.local ? (
                          <span className="model-tag">local</span>
                        ) : ready ? (
                          <span className="model-tag">{all.length}</span>
                        ) : (
                          <span className="model-tag">needs key</span>
                        )}
                      </div>
                      {ready ? (
                        shown.map((entry) => (
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
                            <span className="popover-title">
                              {prettyModel(entry)}
                              {isFreeModel(meta.id, entry) && <span className="model-free">free</span>}
                            </span>
                            <span
                              className={cx(
                                "model-star",
                                favorites.includes(key(meta.id, entry)) && "is-pinned",
                              )}
                              role="button"
                              aria-label={`Pin ${entry}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleFavorite(meta.id, entry);
                              }}
                            >
                              <Icon name="sparkle" size={12} />
                            </span>
                            {meta.id === provider && entry === model && (
                              <Icon name="check" size={14} />
                            )}
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
                      {ready && shown.length < all.length && query === "" && (
                        <p className="popover-hint">
                          {all.length - shown.length} more — search to narrow
                        </p>
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
            );
          })()}
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
