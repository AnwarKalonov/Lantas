import { useEffect, useRef, useState } from "react";
import type { AgentId, ProviderId, Session } from "../lib/types";
import { AGENTS } from "../lib/data";
import { getProvider, prettyModel } from "../lib/providers";
import { useStore } from "../lib/store";
import { formatTokens } from "../lib/util";
import { Composer } from "./Composer";
import { Icon } from "./Icons";
import { Transcript } from "./Transcript";

interface SessionViewProps {
  session: Session;
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onAgentChange: (agent: AgentId) => void;
  onModelChange: (provider: ProviderId, model: string) => void;
  onOpenProviders: () => void;
}

export function SessionView({
  session,
  streaming,
  onSend,
  onStop,
  onAgentChange,
  onModelChange,
  onOpenProviders,
}: SessionViewProps) {
  const { renameSession, deleteSession, notify } = useStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const agent = AGENTS.find((item) => item.id === session.agent) ?? AGENTS[0];
  const provider = getProvider(session.provider);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stick.current) el.scrollTop = el.scrollHeight;
  }, [session.messages, session.id]);

  useEffect(() => {
    stick.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [session.id]);

  useEffect(() => {
    if (!streaming) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onStop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [streaming, onStop]);

  const commitRename = () => {
    renameSession(session.id, draft);
    setEditing(false);
  };

  const copyTranscript = () => {
    const text = session.messages
      .map((message) => {
        const body = message.parts
          .map((part) => {
            if (part.kind === "text") return part.text;
            if (part.kind === "tool") return `[${part.tool}] ${part.label}`;
            if (part.kind === "diff") return `[diff] ${part.path} +${part.added} −${part.removed}`;
            if (part.kind === "shell") return `$ ${part.command}\n${part.output.join("\n")}`;
            return part.text;
          })
          .join("\n\n");
        return `${message.role === "user" ? "You" : "Lantas"}:\n${body}`;
      })
      .join("\n\n---\n\n");
    navigator.clipboard?.writeText(text).catch(() => {});
    notify("Transcript copied");
  };

  return (
    <section className="session">
      <header className="session-head">
        <div className="session-head-main">
          {editing ? (
            <input
              className="session-title-input"
              value={draft}
              autoFocus
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitRename();
                if (event.key === "Escape") setEditing(false);
              }}
            />
          ) : (
            <h1
              className="session-title"
              onDoubleClick={() => {
                setDraft(session.title);
                setEditing(true);
              }}
              title="Double-click to rename"
            >
              {session.title}
            </h1>
          )}
          <div className="session-sub">
            <span className="sub-item">
              <Icon name="branch" size={12} />
              {session.branch}
            </span>
            <span className="meta-dot">·</span>
            <span className="sub-item">{session.cwd}</span>
            <span className="meta-dot">·</span>
            <span className="sub-item">
              {agent.name} · {prettyModel(session.model)}
            </span>
            <span className="meta-dot">·</span>
            <span className="sub-item">{provider.name}</span>
            {session.files.length > 0 && (
              <>
                <span className="meta-dot">·</span>
                <span className="sub-item">
                  {session.files.length} file{session.files.length === 1 ? "" : "s"} changed
                </span>
              </>
            )}
            <span className="meta-dot">·</span>
            <span className="sub-item">{formatTokens(session.tokens)} tokens</span>
          </div>
        </div>
        <div className="session-actions">
          <button
            type="button"
            className="icon-button"
            onClick={copyTranscript}
            title="Copy transcript"
            aria-label="Copy transcript"
          >
            <Icon name="copy" size={15} />
          </button>
          <button
            type="button"
            className="icon-button danger-hover"
            onClick={() => {
              deleteSession(session.id);
              notify("Session deleted");
            }}
            title="Delete session"
            aria-label="Delete session"
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      </header>

      <Transcript session={session} scrollRef={scrollRef} />

      <div className="composer-dock">
        <Composer
          variant="session"
          agent={session.agent}
          provider={session.provider}
          model={session.model}
          streaming={streaming}
          contextUsed={session.tokens}
          contextWindow={session.contextWindow}
          onSend={onSend}
          onStop={onStop}
          onAgentChange={onAgentChange}
          onModelChange={onModelChange}
          onOpenProviders={onOpenProviders}
        />
      </div>
    </section>
  );
}
