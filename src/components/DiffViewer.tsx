import { useEffect, useMemo, useState } from "react";
import { diffLines } from "../lib/tools";
import type { DiffLine, StagedChange } from "../lib/types";
import { cx } from "../lib/util";
import { Icon } from "./Icons";

/** Align a sequential diff into left/right rows, pairing edits in a block. */
function pairRows(lines: DiffLine[]): Array<{ left?: DiffLine; right?: DiffLine }> {
  const rows: Array<{ left?: DiffLine; right?: DiffLine }> = [];
  let deletions: DiffLine[] = [];
  let additions: DiffLine[] = [];

  const flush = () => {
    const size = Math.max(deletions.length, additions.length);
    for (let index = 0; index < size; index += 1) {
      rows.push({ left: deletions[index], right: additions[index] });
    }
    deletions = [];
    additions = [];
  };

  for (const line of lines) {
    if (line.type === "ctx") {
      flush();
      rows.push({ left: line, right: line });
    } else if (line.type === "del") deletions.push(line);
    else additions.push(line);
  }
  flush();
  return rows;
}

function SplitBody({ lines }: { lines: DiffLine[] }) {
  const rows = useMemo(() => pairRows(lines), [lines]);
  return (
    <div className="diff-split">
      <div className="diff-pane">
        <div className="diff-pane-head">Before</div>
        <div className="diff-pane-body">
          {rows.map((row, index) => (
            <div
              key={`l-${index}`}
              className={cx(
                "diff-line",
                row.left?.type === "del" && "is-del",
                !row.left && "is-empty",
              )}
            >
              <span className="diff-no">{row.left?.no ?? ""}</span>
              <span className="diff-sign">{row.left?.type === "del" ? "−" : " "}</span>
              <span className="diff-code">{row.left?.text ?? " "}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="diff-pane">
        <div className="diff-pane-head">After</div>
        <div className="diff-pane-body">
          {rows.map((row, index) => (
            <div
              key={`r-${index}`}
              className={cx(
                "diff-line",
                row.right?.type === "add" && "is-add",
                !row.right && "is-empty",
              )}
            >
              <span className="diff-no">{row.right?.no ?? ""}</span>
              <span className="diff-sign">{row.right?.type === "add" ? "+" : " "}</span>
              <span className="diff-code">{row.right?.text ?? " "}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * A changed file in the transcript. It reads as one quiet row, opens a unified
 * diff in place, and carries Keep/Discard while the edit is still reviewable.
 */
export function DiffViewer({
  path,
  lines,
  added,
  removed,
  onOpenFile,
  staged,
  onKeep,
  onDiscard,
  busy,
}: {
  path: string;
  lines: DiffLine[];
  added: number;
  removed: number;
  onOpenFile?: (path: string) => void;
  staged?: StagedChange;
  onKeep?: (path: string) => void;
  onDiscard?: (path: string) => void;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const name = path.split("/").pop() ?? path;
  const dir = path.slice(0, Math.max(0, path.length - name.length)).replace(/\/$/, "");

  return (
    <div className={cx("edit-card", open && "is-open", staged && "is-staged")}>
      <div className="edit-card-head">
        <button
          type="button"
          className="edit-card-main"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          title={open ? "Hide diff" : "Show diff"}
        >
          <span className="edit-card-icon" aria-hidden="true">
            <Icon name="file" size={14} />
          </span>
          <span className="edit-card-copy">
            <span className="edit-card-name">{name}</span>
            <span className="edit-card-path">{dir || path}</span>
          </span>
          <span className="edit-card-stats">
            <span className="diff-add">+{added}</span>
            <span className="diff-del">−{removed}</span>
          </span>
          <Icon
            name="chevronRight"
            size={11}
            className={cx("edit-card-caret", open && "is-open")}
          />
        </button>

        {staged && onKeep && onDiscard ? (
          <div className="edit-card-actions">
            <button
              type="button"
              className="edit-card-discard"
              onClick={() => onDiscard(path)}
              disabled={busy}
            >
              Discard
            </button>
            <button
              type="button"
              className="edit-card-keep"
              onClick={() => onKeep(path)}
              disabled={busy}
            >
              <Icon name="check" size={11} />
              {busy ? "Keeping…" : "Keep changes"}
            </button>
          </div>
        ) : onOpenFile ? (
          <button
            type="button"
            className="edit-card-open"
            onClick={() => onOpenFile(path)}
            title="Open in the IDE"
          >
            <Icon name="external" size={12} />
            Open
          </button>
        ) : null}
      </div>

      {open && (
        <div className="edit-diff">
          {lines.map((line, index) => (
            <div
              key={`${line.type}-${line.no}-${index}`}
              className={cx(
                "edit-diff-line",
                line.type === "add" && "is-add",
                line.type === "del" && "is-del",
              )}
            >
              <span className="edit-diff-no">{line.type === "del" ? "" : line.no}</span>
              <span className="edit-diff-sign">
                {line.type === "add" ? "+" : line.type === "del" ? "−" : " "}
              </span>
              <span className="edit-diff-code">{line.text.replace(/\n$/, "") || " "}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Review staged assistant writes one file at a time before they hit disk. */
export function StagedDiffReview({
  changes,
  busyPath,
  onKeep,
  onDiscard,
  onClose,
}: {
  changes: StagedChange[];
  busyPath?: string | null;
  onKeep: (path: string) => void;
  onDiscard: (path: string) => void;
  onClose: () => void;
}) {
  const [activePath, setActivePath] = useState(changes[0]?.path ?? "");
  const active = changes.find((change) => change.path === activePath) ?? changes[0];

  useEffect(() => {
    if (!active) onClose();
  }, [active, onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const diff = useMemo(
    () => (active ? diffLines(active.before, active.after) : null),
    [active],
  );
  if (!active || !diff) return null;

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="confirm-card diff-review-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Review changes"
      >
        <div className="diff-review-head">
          <Icon name="diff" size={14} />
          <strong>Review changes</strong>
          <span className="diff-review-spacer" />
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close review">
            <Icon name="close" size={13} />
          </button>
        </div>
        <div className="diff-review-tabs">
          {changes.map((change) => (
            <button
              key={change.path}
              type="button"
              className={cx("diff-review-tab", change.path === active.path && "is-active")}
              onClick={() => setActivePath(change.path)}
              title={change.path}
            >
              {change.path}
            </button>
          ))}
        </div>
        <SplitBody lines={diff.lines} />
        <div className="diff-review-foot">
          <span>
            {diff.added} added, {diff.removed} removed. Nothing is written until you keep it.
          </span>
          <span className="diff-review-spacer" />
          <button
            type="button"
            className="button-quiet"
            disabled={busyPath === active.path}
            onClick={() => onDiscard(active.path)}
          >
            Discard changes
          </button>
          <button
            type="button"
            className="button-primary"
            disabled={busyPath === active.path}
            onClick={() => onKeep(active.path)}
          >
            <Icon name="check" size={12} />
            {busyPath === active.path ? "Keeping…" : "Keep changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
