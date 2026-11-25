import { useEffect, useRef, useState } from "react";
import type { AgentId, Attachment, ProviderId, Session } from "../lib/types";
import { useStore } from "../lib/store";
import { AGENTS } from "../lib/data";
import { prettyModel } from "../lib/providers";
import { Composer } from "./Composer";
import { Icon } from "./Icons";
import { Transcript } from "./Transcript";

interface SessionViewProps {
  session: Session;
  streaming: boolean;
  onSend: (text: string, attachments?: Attachment[]) => void;
  onStop: () => void;
  onAgentChange: (agent: AgentId) => void;
  onModelChange: (provider: ProviderId, model: string) => void;
  onOpenProviders: () => void;
  onScreenToggle: () => void;
  onApprovePlan: () => void;
  onOpenFile?: (path: string, line?: number) => void;
}

export function SessionView({
  session,
  streaming,
  onSend,
  onStop,
  onAgentChange,
  onModelChange,
  onOpenProviders,
  onScreenToggle,
  onApprovePlan,
  onOpenFile,
}: SessionViewProps) {
  const { renameSession, deleteSession, notify } = useStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);
  const agentName = AGENTS.find((item) => item.id === session.agent)?.name ?? "Agent";
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

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
    if (draft.trim()) renameSession(session.id, draft);
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
            if (part.kind === "artifact") return `[file] ${part.name} (${part.format})`;
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
    <section className="session chat">
      <header className="session-head chat-head">
        <div className="chat-heading">
        <button type="button" className="chat-project" onClick={() => setEditing(true)}>
          {editing ? (
            <input
              className="chat-title-input"
              value={draft}
              autoFocus
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commitRename}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitRename();
                if (event.key === "Escape") setEditing(false);
              }}
            />
          ) : (
            <span className="chat-title" title="Click to rename">
              {session.title}
            </span>
          )}
        </button>
        <span className="chat-sub">
          {agentName} · {prettyModel(session.model)}
        </span>
        </div>

        <div className="session-actions chat-actions">
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
              notify("Thread deleted");
            }}
            title="Delete thread"
            aria-label="Delete thread"
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      </header>

      <Transcript session={session} scrollRef={scrollRef} onOpenFile={onOpenFile} />

      {session.agent === "plan" &&
        !streaming &&
        session.messages.at(-1)?.role === "assistant" && (
          <div className="plan-approve" role="status">
            <span>Plan ready. Nothing has been changed.</span>
            <button type="button" className="button-primary small" onClick={onApprovePlan}>
              Approve and build
            </button>
          </div>
        )}

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
          onScreenToggle={onScreenToggle}
        />
      </div>
    </section>
  );
}
