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

/** The side-by-side diff used by assistant edits in the transcript. */
export function DiffViewer({
  path,
  lines,
  added,
  removed,
  onOpenFile,
}: {
  path: string;
  lines: DiffLine[];
  added: number;
  removed: number;
  onOpenFile?: (path: string) => void;
}) {
  return (
    <div className="diff-block">
      <div className="diff-head">
        <Icon name="diff" size={13} />
        <button
          type="button"
          className="diff-path"
          onClick={() => onOpenFile?.(path)}
          disabled={!onOpenFile}
        >
          {path}
        </button>
        <span className="diff-stats">
          <span className="diff-add">+{added}</span>
          <span className="diff-del">−{removed}</span>
        </span>
      </div>
      <SplitBody lines={lines} />
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
            Discard
          </button>
          <button
            type="button"
            className="button-primary"
            disabled={busyPath === active.path}
            onClick={() => onKeep(active.path)}
          >
            {busyPath === active.path ? "Keeping…" : "Keep file"}
          </button>
        </div>
      </div>
    </div>
  );
}
