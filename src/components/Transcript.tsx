import type { DiffLine, Message, Part, Session } from "../lib/types";
import { AGENTS } from "../lib/data";
import { clock, cx, formatDuration, formatTokens } from "../lib/util";
import { Icon, type IconName } from "./Icons";

const TOOL_ICONS: Record<string, IconName> = {
  read: "file",
  grep: "search",
  edit: "wrench",
  plan: "compass",
  web: "compass",
};

function Inline({ text }: { text: string }) {
  const chunks = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <>
      {chunks.map((chunk, index) => {
        if (chunk.startsWith("`") && chunk.endsWith("`")) {
          return <code key={index}>{chunk.slice(1, -1)}</code>;
        }
        if (chunk.startsWith("**") && chunk.endsWith("**")) {
          return <strong key={index}>{chunk.slice(2, -2)}</strong>;
        }
        return <span key={index}>{chunk}</span>;
      })}
    </>
  );
}

function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).filter(Boolean);
  return (
    <div className="md">
      {blocks.map((block, index) => {
        if (block.startsWith("- ")) {
          return (
            <ul key={index}>
              {block.split("\n").map((line, lineIndex) => (
                <li key={lineIndex}>
                  <Inline text={line.replace(/^-\s/, "")} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index}>
            <Inline text={block} />
          </p>
        );
      })}
    </div>
  );
}

function ToolRow({ part }: { part: Extract<Part, { kind: "tool" }> }) {
  return (
    <div className={cx("tool-row", `state-${part.state}`)}>
      <span className="tool-icon">
        {part.state === "run" ? (
          <Icon name="loader" size={13} className="spin" />
        ) : part.state === "error" ? (
          <Icon name="alert" size={13} />
        ) : (
          <Icon name="check" size={13} />
        )}
      </span>
      <span className="tool-kind">
        <Icon name={TOOL_ICONS[part.tool] ?? "file"} size={13} />
      </span>
      <span className="tool-label">{part.label}</span>
      {part.detail && <span className="tool-detail">{part.detail}</span>}
    </div>
  );
}

function DiffBlock({ part }: { part: Extract<Part, { kind: "diff" }> }) {
  return (
    <div className="diff-block">
      <div className="diff-head">
        <Icon name="diff" size={13} />
        <span className="diff-path">{part.path}</span>
        <span className="diff-stats">
          <span className="diff-add">+{part.added}</span>
          <span className="diff-del">−{part.removed}</span>
        </span>
      </div>
      <div className="diff-body">
        {part.lines.map((line: DiffLine, index) => (
          <div key={index} className={cx("diff-line", `is-${line.type}`)}>
            <span className="diff-no">{line.no}</span>
            <span className="diff-sign">
              {line.type === "add" ? "+" : line.type === "del" ? "−" : " "}
            </span>
            <span className="diff-code">{line.text || " "}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShellBlock({ part }: { part: Extract<Part, { kind: "shell" }> }) {
  return (
    <div className={cx("shell-block", `state-${part.state}`)}>
      <div className="shell-head">
        <Icon name="terminal" size={13} />
        <span className="shell-prompt">$</span>
        <span className="shell-command">{part.command}</span>
        <span className="shell-state">
          {part.state === "run" ? (
            <Icon name="loader" size={12} className="spin" />
          ) : part.state === "error" ? (
            <span className="shell-exit">exit 1</span>
          ) : (
            <span className="shell-exit ok">exit 0</span>
          )}
        </span>
      </div>
      {part.output.length > 0 && (
        <div className="shell-body">
          {part.output.map((line, index) => (
            <div
              key={index}
              className={cx(
                "shell-line",
                /error|Found \d+ error/.test(line) && "is-error",
                line.startsWith("✓") && "is-ok",
              )}
            >
              {line || " "}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AssistantPart({ part }: { part: Part }) {
  switch (part.kind) {
    case "text":
      return <Markdown text={part.text} />;
    case "tool":
      return <ToolRow part={part} />;
    case "diff":
      return <DiffBlock part={part} />;
    case "shell":
      return <ShellBlock part={part} />;
    case "note":
      return (
        <div className="note-row">
          <Icon name="sparkle" size={13} />
          <span>{part.text}</span>
        </div>
      );
    default:
      return null;
  }
}

function UserMessage({ message }: { message: Message }) {
  const text = message.parts
    .map((part) => (part.kind === "text" ? part.text : ""))
    .join("");

  return (
    <div className="msg msg-user">
      <span className="user-clip" aria-hidden="true">
        <Icon name="paperclip" size={12} />
      </span>
      <div className="user-card">
        {message.attachments && message.attachments.length > 0 && (
          <div className="msg-attachments">
            {message.attachments.map((file) =>
              file.kind === "image" ? (
                <img key={file.id} className="msg-image" src={file.body} alt={file.name} />
              ) : (
                <span className="msg-file" key={file.id}>
                  <Icon name="file" size={12} />
                  {file.name}
                </span>
              ),
            )}
          </div>
        )}
        {text ? <p>{text}</p> : null}
      </div>
    </div>
  );
}

function AssistantMessage({ message }: { message: Message }) {
  const agent = AGENTS.find((item) => item.id === message.agent) ?? AGENTS[0];
  const hasParts = message.parts.length > 0;
  const duration = message.durationMs ? formatDuration(message.durationMs) : null;

  return (
    <div className="msg msg-assistant">
      <div className="assistant-head">
        <Icon name="clock" size={12} />
        <span>{clock(message.created)}</span>
        <span className="assistant-who">{agent.name}</span>
      </div>

      <div className="assistant-block">
        {message.parts.map((part) => (
          <AssistantPart key={part.id} part={part} />
        ))}
        {message.streaming && <span className="stream-caret" aria-hidden="true" />}
      </div>

      {!message.streaming && hasParts && (
        <div className="assistant-foot">
          <Icon name="wrench" size={12} />
          <span>{duration ? `Worked for ${duration}` : "Done"}</span>
          {message.tokens ? <span className="assistant-tokens">{formatTokens(message.tokens)} tokens</span> : null}
          {message.interrupted ? <span className="interrupted">interrupted</span> : null}
        </div>
      )}
    </div>
  );
}

export function Transcript({
  session,
  scrollRef,
}: {
  session: Session;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="transcript" ref={scrollRef}>
      <div className="transcript-inner">
        {session.messages.map((message) =>
          message.role === "user" ? (
            <UserMessage key={message.id} message={message} />
          ) : (
            <AssistantMessage key={message.id} message={message} />
          ),
        )}
        <div className="transcript-tail" />
      </div>
    </div>
  );
}
