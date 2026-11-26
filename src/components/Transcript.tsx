import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { EASE, timing, useStill } from "../lib/motion";
import type { Message, Part, Session } from "../lib/types";
import { AGENTS } from "../lib/data";
import { prettyModel } from "../lib/providers";
import { clock, cx, formatDuration, formatTokens } from "../lib/util";
import { PATH_RE, looksLikePath, maskUrls, pathFrom } from "../lib/paths";
import { formatBytes, saveArtifact } from "../lib/artifacts";
import { DiffViewer } from "./DiffViewer";
import { Icon, type IconName } from "./Icons";

const TOOL_ICONS: Record<string, IconName> = {
  read: "file",
  grep: "search",
  edit: "wrench",
  terminal: "terminal",
  plan: "compass",
  web: "compass",
  deliver: "download",
};

// Paths come from lib/paths so URLs are never mistaken for files. A row saying
// "Opened …/calculator" used to grow a file chip that jumped to the editor.

/**
 * Execution is shown as one line, not twenty.
 *
 * A turn that browses, runs a command and edits a file used to print a row for
 * every step before the answer. The work is still here — one line says what ran
 * and stays open while it runs — but the reply starts with the reply.
 */
const STEP_NAMES: Record<string, string> = {
  browser: "browser",
  web: "web",
  terminal: "terminal",
  read: "read",
  grep: "search",
  edit: "edit",
  write: "edit",
  plan: "plan",
  skill: "skill",
  deliver: "file",
  artifact: "file",
  edit_file: "edit",
  read_file: "read",
  find: "search",
};

function stepName(part: Part): string | null {
  if (part.kind === "tool") return STEP_NAMES[part.tool] ?? part.tool;
  if (part.kind === "shell") return "terminal";
  if (part.kind === "diff") return "edit";
  if (part.kind === "artifact") return "file";
  return null;
}

function isStep(part: Part): boolean {
  return stepName(part) !== null;
}

type Block = { kind: "text"; part: Part } | { kind: "run"; parts: Part[] };

function groupParts(parts: Part[]): Block[] {
  const blocks: Block[] = [];
  for (const part of parts) {
    if (isStep(part)) {
      const last = blocks.at(-1);
      if (last?.kind === "run") last.parts.push(part);
      else blocks.push({ kind: "run", parts: [part] });
    } else {
      blocks.push({ kind: "text", part });
    }
  }
  return blocks;
}

function runSummary(parts: Part[]): string {
  const counts = new Map<string, number>();
  for (const part of parts) {
    const name = stepName(part);
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, count]) => (count > 1 ? `${name} ×${count}` : name))
    .join(", ");
}

function partRunning(part: Part): boolean {
  return (part as { state?: string }).state === "run";
}

interface Source {
  url: string;
  label: string;
}

/** Links the reply actually cites, once each, for the Sources strip. */
function sourcesOf(parts: Part[]): Source[] {
  const seen = new Map<string, Source>();
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\bhttps?:\/\/[^\s)<>"']+/g;
  for (const part of parts) {
    if (part.kind !== "text") continue;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(part.text))) {
      const url = (match[2] ?? match[0]).replace(/[.,;:]+$/, "");
      if (!/^https?:\/\//i.test(url)) continue;
      if (seen.has(url)) continue;
      let label = match[1] ?? "";
      try {
        const host = new URL(url).hostname.replace(/^www\./, "");
        label = label && !/^https?:/i.test(label) ? label : host;
      } catch {
        label = label || url;
      }
      seen.set(url, { url, label });
    }
  }
  return Array.from(seen.values()).slice(0, 8);
}

function RunBlock({
  parts,
  onOpenFile,
}: {
  parts: Part[];
  onOpenFile?: (path: string, line?: number) => void;
}) {
  const running = parts.some(partRunning);
  const [open, setOpen] = useState(running);

  // Open while the steps are live, then fold them back into one quiet line.
  // The details are still one click away, but a finished turn is not a wall
  // of tool output.
  useEffect(() => {
    setOpen(running);
  }, [running]);

  return (
    <div className={cx("run-block", running && "is-running")}>
      <button
        type="button"
        className="run-head"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {running ? (
          <Icon name="loader" size={12} className="spin" />
        ) : (
          <Icon name="check" size={12} />
        )}
        <span className="run-title">
          {running ? "Working · " : "Used "}
          {runSummary(parts)}
        </span>
        <Icon name="chevronDown" size={11} className={cx("run-caret", open && "is-open")} />
      </button>
      {open && (
        <div className="run-body">
          {parts.map((part) => (
            <AssistantPart key={part.id} part={part} onOpenFile={onOpenFile} />
          ))}
        </div>
      )}
    </div>
  );
}

function SourceStrip({ parts }: { parts: Part[] }) {
  const sources = sourcesOf(parts);
  if (!sources.length) return null;
  return (
    <div className="msg-sources">
      <span className="msg-sources-label">
        {sources.length} {sources.length === 1 ? "Source" : "Sources"}
      </span>
      <div className="msg-sources-list">
        {sources.map((source) => {
          let host = source.label;
          try {
            host = new URL(source.url).hostname.replace(/^www\./, "");
          } catch {
            /* keep the label */
          }
          return (
            <a
              key={source.url}
              className="source-chip"
              href={source.url}
              target="_blank"
              rel="noreferrer"
              title={source.url}
            >
              <span className="source-fav" aria-hidden="true">
                {host.charAt(0).toUpperCase()}
              </span>
              <span className="source-host">{host}</span>
            </a>
          );
        })}
      </div>
    </div>
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
        const scan = maskUrls(chunk);
        let end = 0;
        let found: RegExpExecArray | null;
        while ((found = paths.exec(scan))) {
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
  const [expanded, setExpanded] = useState(false);
  const body = code.replace(/\n$/, "");
  const lines = body ? body.split("\n").length : 0;
  // A pasted file is not a reply. Long blocks stay readable at a glance and
  // open in place when the user wants the whole thing.
  const long = lines > 16;
  const copy = () => {
    navigator.clipboard?.writeText(code).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div className={cx("md-code", long && !expanded && "is-clamped")}>
      <div className="md-code-head">
        <span>{language || "text"}</span>
        <div className="md-code-actions">
          {long && (
            <button
              type="button"
              onClick={() => setExpanded((open) => !open)}
              className="md-code-copy"
            >
              {expanded ? "Collapse" : `${lines} lines`}
            </button>
          )}
          <button type="button" onClick={copy} className="md-code-copy">
            <Icon name={copied ? "check" : "copy"} size={11} />
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <pre>
        <code>{body}</code>
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
    <DiffViewer
      path={part.path}
      lines={part.lines}
      added={part.added}
      removed={part.removed}
      onOpenFile={onOpenFile}
    />
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

function ReasoningBlock({ part }: { part: Extract<Part, { kind: "reasoning" }> }) {
  const [open, setOpen] = useState(false);
  const running = part.state === "run";
  const seconds = part.durationMs ? Math.max(1, Math.round(part.durationMs / 1000)) : null;
  const label = running
    ? "Thinking…"
    : seconds
      ? `Thought for ${seconds}s`
      : "Thought process";

  return (
    <div className={cx("reasoning-block", running && "is-running")}>
      <button
        type="button"
        className="reasoning-head"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <Icon
          name={running ? "loader" : "sparkle"}
          size={12}
          className={running ? "spin" : "reasoning-mark"}
        />
        <span>{label}</span>
        <span className="reasoning-toggle">{open ? "Hide" : "Show"}</span>
        <Icon name="chevronDown" size={11} className={cx("reasoning-caret", open && "is-open")} />
      </button>
      {open && <div className="reasoning-body">{part.text}</div>}
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
    case "reasoning":
      return <ReasoningBlock part={part} />;
    case "tool":
      return <ToolRow part={part} onOpenFile={onOpenFile} />;
    case "diff":
      return <DiffBlock part={part} onOpenFile={onOpenFile} />;
    case "shell":
      return <ShellBlock part={part} />;
    case "artifact":
      return <ArtifactBlock part={part} />;
    case "note":
      return (
        <div className="note-row">
          <span>{part.text}</span>
        </div>
      );
    default:
      return null;
  }
}

function ArtifactBlock({ part }: { part: Extract<Part, { kind: "artifact" }> }) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "gone">("idle");
  const icon = part.format === "zip" ? "archive" : part.format === "pdf" ? "doc" : "file";

  const save = async () => {
    setState("saving");
    const result = await saveArtifact(part.artifactId);
    if (result === "missing") {
      setState("gone");
      return;
    }
    if (result === "cancelled") {
      setState("idle");
      return;
    }
    setState("saved");
    window.setTimeout(() => setState("idle"), 2200);
  };

  const label =
    state === "gone"
      ? "Expired"
      : state === "saved"
        ? "Saved"
        : state === "saving"
          ? "Saving…"
          : "Download";

  return (
    <div className={cx("artifact-card", `is-${part.format}`, state === "saved" && "is-saved")}>
      <span className="artifact-icon" aria-hidden="true">
        <Icon name={icon} size={16} />
      </span>
      <span className="artifact-copy">
        <span className="artifact-name" title={part.name}>
          {part.name}
        </span>
        <span className="artifact-meta">
          {part.format.toUpperCase()} · {formatBytes(part.bytes)}
        </span>
      </span>
      <button
        type="button"
        className="artifact-save"
        onClick={save}
        disabled={state === "saving" || state === "gone"}
        title={
          state === "gone"
            ? "This file was built earlier in the session. Ask again to rebuild it."
            : `Save ${part.name}`
        }
      >
        <Icon name={state === "saved" ? "check" : "download"} size={13} />
        {label}
      </button>
    </div>
  );
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
  const who = message.model ? prettyModel(message.model) : agent.name;
  const hasParts = message.parts.length > 0;
  const duration = message.durationMs ? formatDuration(message.durationMs) : null;
  // "Deliver file" finished and the card it produced sits directly below it,
  // so the row would say the same thing twice.
  const hasArtifact = message.parts.some((part) => part.kind === "artifact");
  const visibleParts = message.parts.filter(
    (part) => !(hasArtifact && part.kind === "tool" && part.tool === "deliver" && part.state === "done"),
  );
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
                              : part.kind === "artifact"
                  ? `[file] ${part.name}`
                  : part.kind === "reasoning"
                    ? ""
                    : `$ ${part.command}\n${part.output.join("\n")}`,
      )
      .join("\n\n");
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const blocks = groupParts(visibleParts);

  if (compact) {
    return (
      <div className="msg msg-assistant is-compact">
        <div className="assistant-block">
          {blocks.map((block, index) =>
            block.kind === "run" ? (
              <RunBlock key={`run-${index}`} parts={block.parts} onOpenFile={onOpenFile} />
            ) : (
              <AssistantPart key={block.part.id} part={block.part} onOpenFile={onOpenFile} />
            ),
          )}
          {message.streaming && <span className="stream-caret" aria-hidden="true" />}
          {message.interrupted && <span className="interrupted">interrupted</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="msg msg-assistant">
      <div className="assistant-head" title={`${agent.name} · ${who}`}>
        <span className="assistant-name">{who}</span>
        <span className="assistant-sep" aria-hidden="true">
          •
        </span>
        <span className="assistant-time">{clock(message.created)}</span>
      </div>

      <div className="assistant-block">
        {blocks.map((block, index) =>
          block.kind === "run" ? (
            <RunBlock key={`run-${index}`} parts={block.parts} onOpenFile={onOpenFile} />
          ) : (
            <AssistantPart key={block.part.id} part={block.part} onOpenFile={onOpenFile} />
          ),
        )}
        {message.streaming && <span className="stream-caret" aria-hidden="true" />}
      </div>

      {!message.streaming && <SourceStrip parts={visibleParts} />}

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


/** A message lands as it arrives: 30ms of stagger, capped at six. */
function Row({ index, children }: { index: number; children: React.ReactNode }) {
  const still = useStill();
  return (
    <motion.div
      initial={{ opacity: 0, y: 7 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...timing(0.24, still), delay: still ? 0 : Math.min(index, 6) * 0.03 }}
    >
      {children}
    </motion.div>
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
          : list.map((message, index) => (
              <Row key={message.id} index={index}>
                {message.role === "user" ? (
                  <UserMessage message={message} compact={compact} />
                ) : (
                  <AssistantMessage
                    message={message}
                    compact={compact}
                    onOpenFile={onOpenFile}
                  />
                )}
              </Row>
            ))}
        <div className="transcript-tail" />
      </div>
    </div>
  );
}
