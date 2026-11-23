import { useEffect, useRef, useState } from "react";
import type { DiffLine, Message, Part, Session } from "../lib/types";
import { AGENTS } from "../lib/data";
import { clock, cx, formatDuration, formatTokens } from "../lib/util";
import { MarkGlyph } from "./Brand";
import { Icon, type IconName } from "./Icons";

const TOOL_ICONS: Record<string, IconName> = {
  read: "file",
  grep: "search",
  edit: "wrench",
  terminal: "terminal",
  plan: "compass",
  web: "compass",
};

const PATH_RE =
  /((?:[\w@.-]+\/)+[\w@.-]+|[\w@.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|css|scss|html|md|mdx|py|rs|go|sh|yml|yaml|toml|swift|java|kt|cs|php|rb|sql|graphql|vue|svelte|astro|lock|txt))(?::(\d+))?/g;

function looksLikePath(value: string) {
  return /^(?:[\w@.-]+\/)+[\w@.-]+$|^[\w@.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|css|scss|html|md|mdx|py|rs|go|sh|yml|yaml|toml|swift|java|kt|cs|php|rb|sql|graphql|vue|svelte|astro|lock|txt)$/.test(
    value.trim(),
  );
}

function FileButton({
  path,
  line,
  onOpenFile,
  className,
}: {
  path: string;
  line?: number;
  onOpenFile?: (path: string, line?: number) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={cx("transcript-file", className)}
      onClick={() => onOpenFile?.(path, line)}
      title={`Open ${path}${line ? `:${line}` : ""}`}
      disabled={!onOpenFile}
    >
      <Icon name="file" size={11} />
      <span>{path.split("/").pop()}</span>
      {line ? <small>:{line}</small> : null}
    </button>
  );
}

function Inline({
  text,
  onOpenFile,
}: {
  text: string;
  onOpenFile?: (path: string, line?: number) => void;
}) {
  const chunks = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g).filter(Boolean);
  return (
    <>
      {chunks.map((chunk, index) => {
        if (chunk.startsWith("`") && chunk.endsWith("`")) {
          const value = chunk.slice(1, -1);
          if (looksLikePath(value)) {
            const [path, line] = value.split(/:(?=\d+$)/);
            return (
              <FileButton
                key={index}
                path={path}
                line={line ? Number(line) : undefined}
                onOpenFile={onOpenFile}
              />
            );
          }
          return <code key={index}>{value}</code>;
        }
        if (chunk.startsWith("**") && chunk.endsWith("**")) {
          return (
            <strong key={index}>
              <Inline text={chunk.slice(2, -2)} onOpenFile={onOpenFile} />
            </strong>
          );
        }
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(chunk);
        if (link) {
          return (
            <a key={index} href={link[2]} target="_blank" rel="noreferrer">
              {link[1]}
            </a>
          );
        }
        const pieces: Array<string | { path: string; line?: number }> = [];
        const paths = new RegExp(PATH_RE.source, "g");
        let end = 0;
        let found: RegExpExecArray | null;
        while ((found = paths.exec(chunk))) {
          if (found.index > end) pieces.push(chunk.slice(end, found.index));
          pieces.push({
            path: found[1],
            line: found[2] ? Number(found[2]) : undefined,
          });
          end = found.index + found[0].length;
        }
        if (end < chunk.length) pieces.push(chunk.slice(end));
        return (
          <span key={index}>
            {pieces.map((piece, pieceIndex) =>
              typeof piece === "string" ? (
                piece
              ) : (
                <FileButton
                  key={pieceIndex}
                  path={piece.path}
                  line={piece.line}
                  onOpenFile={onOpenFile}
                />
              ),
            )}
          </span>
        );
      })}
    </>
  );
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(code).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div className="md-code">
      <div className="md-code-head">
        <span>{language || "text"}</span>
        <button type="button" onClick={copy} className="md-code-copy">
          <Icon name={copied ? "check" : "copy"} size={11} />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{code.replace(/\n$/, "")}</code>
      </pre>
    </div>
  );
}

function Markdown({
  text,
  onOpenFile,
}: {
  text: string;
  onOpenFile?: (path: string, line?: number) => void;
}) {
  const parts: Array<{ kind: "text" | "code"; value: string; language?: string }> = [];
  const fence = /```([\w.+#-]*)\n([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text))) {
    if (match.index > cursor) parts.push({ kind: "text", value: text.slice(cursor, match.index) });
    parts.push({ kind: "code", language: match[1], value: match[2] });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push({ kind: "text", value: text.slice(cursor) });

  return (
    <div className="md">
      {parts.map((part, index) => {
        if (part.kind === "code") {
          return <CodeBlock key={index} language={part.language ?? ""} code={part.value} />;
        }
        const blocks = part.value.split(/\n{2,}/).filter((block) => block.trim());
        return blocks.map((block, blockIndex) => {
          const heading = /^(#{1,4})\s+(.*)$/.exec(block);
          if (heading) {
            const level = Math.min(4, heading[1].length);
            const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4";
            return (
              <Tag key={`${index}-${blockIndex}`}>
                <Inline text={heading[2]} onOpenFile={onOpenFile} />
              </Tag>
            );
          }
          if (/^[-*]\s+/m.test(block)) {
            return (
              <ul key={`${index}-${blockIndex}`}>
                {block.split("\n").map((line, lineIndex) => (
                  <li key={lineIndex}>
                    <Inline text={line.replace(/^[-*]\s+/, "")} onOpenFile={onOpenFile} />
                  </li>
                ))}
              </ul>
            );
          }
          if (/^\d+[.)]\s+/m.test(block)) {
            return (
              <ol key={`${index}-${blockIndex}`}>
                {block.split("\n").map((line, lineIndex) => (
                  <li key={lineIndex}>
                    <Inline text={line.replace(/^\d+[.)]\s+/, "")} onOpenFile={onOpenFile} />
                  </li>
                ))}
              </ol>
            );
          }
          if (block.startsWith("> ")) {
            return (
              <blockquote key={`${index}-${blockIndex}`}>
                <Inline text={block.replace(/^>\s?/gm, "")} onOpenFile={onOpenFile} />
              </blockquote>
            );
          }
          return (
            <p key={`${index}-${blockIndex}`}>
              <Inline text={block} onOpenFile={onOpenFile} />
            </p>
          );
        });
      })}
    </div>
  );
}

function pathFrom(value?: string) {
  if (!value) return null;
  const match = PATH_RE.exec(value);
  PATH_RE.lastIndex = 0;
  return match ? { path: match[1], line: match[2] ? Number(match[2]) : undefined } : null;
}

function ToolRow({
  part,
  onOpenFile,
}: {
  part: Extract<Part, { kind: "tool" }>;
  onOpenFile?: (path: string, line?: number) => void;
}) {
  const file = pathFrom(part.label) ?? pathFrom(part.detail);
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
      {file && onOpenFile ? (
        <FileButton
          path={file.path}
          line={file.line}
          onOpenFile={onOpenFile}
          className="tool-file"
        />
      ) : part.detail ? (
        <span className="tool-detail">{part.detail}</span>
      ) : null}
    </div>
  );
}

function DiffBlock({
  part,
  onOpenFile,
}: {
  part: Extract<Part, { kind: "diff" }>;
  onOpenFile?: (path: string, line?: number) => void;
}) {
  return (
    <div className="diff-block">
      <div className="diff-head">
        <Icon name="diff" size={13} />
        <button
          type="button"
          className="diff-path"
          onClick={() => onOpenFile?.(part.path)}
          disabled={!onOpenFile}
        >
          {part.path}
        </button>
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

function AssistantPart({
  part,
  onOpenFile,
}: {
  part: Part;
  onOpenFile?: (path: string, line?: number) => void;
}) {
  switch (part.kind) {
    case "text":
      return <Markdown text={part.text} onOpenFile={onOpenFile} />;
    case "tool":
      return <ToolRow part={part} onOpenFile={onOpenFile} />;
    case "diff":
      return <DiffBlock part={part} onOpenFile={onOpenFile} />;
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

function UserMessage({ message, compact }: { message: Message; compact?: boolean }) {
  const text = message.parts
    .map((part) => (part.kind === "text" ? part.text : ""))
    .join("");

  return (
    <div className={cx("msg msg-user", compact && "is-compact")}>
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

function AssistantMessage({
  message,
  compact,
  onOpenFile,
}: {
  message: Message;
  compact?: boolean;
  onOpenFile?: (path: string, line?: number) => void;
}) {
  const agent = AGENTS.find((item) => item.id === message.agent) ?? AGENTS[0];
  const hasParts = message.parts.length > 0;
  const duration = message.durationMs ? formatDuration(message.durationMs) : null;
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const text = message.parts
      .map((part) =>
        part.kind === "text" || part.kind === "note"
          ? part.text
          : part.kind === "tool"
            ? `[${part.tool}] ${part.label}`
            : part.kind === "diff"
              ? `[diff] ${part.path}`
              : `$ ${part.command}\n${part.output.join("\n")}`,
      )
      .join("\n\n");
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  if (compact) {
    return (
      <div className="msg msg-assistant is-compact">
        <div className="assistant-compact-mark" aria-hidden="true">
          <MarkGlyph size={11} />
        </div>
        <div className="assistant-block">
          {message.parts.map((part) => (
            <AssistantPart key={part.id} part={part} onOpenFile={onOpenFile} />
          ))}
          {message.streaming && <span className="stream-caret" aria-hidden="true" />}
        </div>
      </div>
    );
  }

  return (
    <div className="msg msg-assistant">
      <div className="assistant-head">
        <span className="assistant-compact-mark" aria-hidden="true">
          <MarkGlyph size={11} />
        </span>
        <span>{agent.name}</span>
        <span className="assistant-time">{clock(message.created)}</span>
      </div>

      <div className="assistant-block">
        {message.parts.map((part) => (
          <AssistantPart key={part.id} part={part} onOpenFile={onOpenFile} />
        ))}
        {message.streaming && <span className="stream-caret" aria-hidden="true" />}
      </div>

      {!message.streaming && hasParts && (
        <div className="assistant-foot">
          <span>{duration ? `Worked for ${duration}` : "Done"}</span>
          {message.tokens ? <span className="assistant-tokens">{formatTokens(message.tokens)} tokens</span> : null}
          {message.interrupted ? <span className="interrupted">interrupted</span> : null}
          <button type="button" className="assistant-copy" onClick={copy}>
            <Icon name={copied ? "check" : "copy"} size={11} />
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}

export function Transcript({
  session,
  messages,
  scrollRef,
  onOpenFile,
  compact = false,
  empty,
}: {
  session?: Session | null;
  messages?: Message[];
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  onOpenFile?: (path: string, line?: number) => void;
  compact?: boolean;
  empty?: React.ReactNode;
}) {
  const localRef = useRef<HTMLDivElement>(null);
  const ref = scrollRef ?? localRef;
  const list = messages ?? session?.messages ?? [];

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const nearBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < 180;
    if (nearBottom || list.at(-1)?.streaming) element.scrollTop = element.scrollHeight;
  }, [list, ref]);

  return (
    <div className={cx("transcript", compact && "is-compact")} ref={ref}>
      <div className="transcript-inner">
        {list.length === 0
          ? empty
          : list.map((message) =>
              message.role === "user" ? (
                <UserMessage key={message.id} message={message} compact={compact} />
              ) : (
                <AssistantMessage
                  key={message.id}
                  message={message}
                  compact={compact}
                  onOpenFile={onOpenFile}
                />
              ),
            )}
        <div className="transcript-tail" />
      </div>
    </div>
  );
}
