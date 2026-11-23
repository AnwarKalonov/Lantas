import { useCallback, useEffect, useMemo, useState } from "react";
import {
  gitCommit,
  gitDiff,
  gitInit,
  gitPull,
  gitPush,
  gitSetRemote,
  gitStage,
  gitStatus,
  gitUnstage,
  repoNamespace,
  statusLabel,
  type GitStatus,
} from "../lib/git";
import { inTauri, openExternal } from "../lib/native";
import { useStore } from "../lib/store";
import type { StagedChange } from "../lib/types";
import { cx } from "../lib/util";
import { Icon } from "./Icons";

const EMPTY: GitStatus = {
  repo: false,
  branch: "",
  upstream: "",
  ahead: 0,
  behind: 0,
  files: [],
  remotes: [],
  commits: [],
};

/**
 * Source control for the folder the IDE has open. Everything is the user's own
 * git; the panel only runs commands and shows the result.
 */
export function GitPanel({
  root,
  activePath,
  onOpen,
  onOpenFolder,
  dirty,
  onSaveAll,
}: {
  root: string;
  activePath: string | null;
  onOpen: (path: string, line?: number) => void;
  onOpenFolder: () => void;
  dirty: Set<string>;
  onSaveAll: () => void;
}) {
  const { staged, keepChange, discardChange, keepStaged, discardStaged, notify } = useStore();
  const [status, setStatus] = useState<GitStatus>(EMPTY);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [remote, setRemote] = useState("");
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [diff, setDiff] = useState<{ path: string; text: string; staged: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!root) {
      setStatus(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setStatus(await gitStatus(root));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [root]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!diff) return;
    setDiff(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label);
    setError("");
    try {
      const result = await action();
      if (typeof result === "string" && result.trim()) {
        notify(result.split("\n").filter(Boolean).slice(-1)[0].slice(0, 140));
      }
      await refresh();
      setDiff(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy("");
    }
  };

  const origin = useMemo(
    () => status.remotes.find(([name]) => name === "origin")?.[1] ?? "",
    [status.remotes],
  );
  const namespace = repoNamespace(origin);
  const stagedPaths = useMemo(
    () => status.files.filter((file) => file.staged).map((file) => file.path),
    [status.files],
  );
  const changedPaths = useMemo(
    () => status.files.filter((file) => !file.staged).map((file) => file.path),
    [status.files],
  );

  const showDiff = async (path: string, isStaged: boolean) => {
    if (diff?.path === path && diff.staged === isStaged) {
      setDiff(null);
      return;
    }
    setDiff({ path, text: "Loading diff…", staged: isStaged });
    try {
      const text = await gitDiff(root, path, isStaged);
      setDiff({ path, text: text || "No textual diff for this file.", staged: isStaged });
    } catch (caught) {
      setDiff({
        path,
        text: caught instanceof Error ? caught.message : String(caught),
        staged: isStaged,
      });
    }
  };

  const keepAll = async () => {
    const written = await keepStaged();
    notify(
      written === staged.length
        ? `Kept ${written} file${written === 1 ? "" : "s"}`
        : `Kept ${staged.length} in the workspace; ${written} written to disk`,
      written === staged.length ? "default" : "error",
    );
    await refresh();
  };

  const remoteHost = (() => {
    try {
      return new URL(origin.replace(/^git@github\.com:/, "https://github.com/")).hostname;
    } catch {
      return origin ? "remote" : "";
    }
  })();

  if (!root) {
    return (
      <div className="ide-git-panel">
        <div className="ide-side-head">
          <span>Source control</span>
        </div>
        <div className="ide-empty-side">
          <p>Open a folder to see its branch and changes.</p>
          <button type="button" className="button-primary small" onClick={onOpenFolder}>
            Open folder
          </button>
        </div>
      </div>
    );
  }

  if (!inTauri()) {
    return (
      <div className="ide-git-panel">
        <div className="ide-side-head">
          <span>Source control</span>
        </div>
        <p className="ide-side-note">
          Git runs through the desktop app. Open Lantas as an app to commit, pull and push.
        </p>
      </div>
    );
  }

  return (
    <div className="ide-git-panel">
      <div className="ide-side-head">
        <span>Source control</span>
        <button
          type="button"
          className="ide-icon-button small"
          onClick={() => void refresh()}
          title="Refresh"
          aria-label="Refresh source control"
        >
          <Icon name="refresh" size={12} />
        </button>
      </div>

      {error && <p className="ide-git-error">{error}</p>}

      {loading ? (
        <p className="ide-side-note">Reading the repository…</p>
      ) : !status.repo ? (
        <div className="ide-git-init">
          <p className="ide-side-note">This folder is not a git repository yet.</p>
          <button
            type="button"
            className="button-primary small"
            disabled={busy === "init"}
            onClick={() =>
              void run("init", async () => {
                await gitInit(root);
                return "Repository created";
              })
            }
          >
            {busy === "init" ? "Creating…" : "Initialise repository"}
          </button>
          <form
            className="ide-git-remote"
            onSubmit={(event) => {
              event.preventDefault();
              if (!remote.trim()) return;
              void run("remote", async () => {
                const saved = await gitSetRemote(root, remote.trim());
                setRemoteOpen(false);
                return `Origin set to ${saved}`;
              });
            }}
          >
            <input
              value={remote}
              onChange={(event) => setRemote(event.target.value)}
              placeholder="https://github.com/you/repo.git"
              spellCheck={false}
              aria-label="Repository URL"
            />
            <button type="submit" className="button-quiet small" disabled={!remote.trim()}>
              Set origin
            </button>
          </form>
        </div>
      ) : (
        <>
          <div className="ide-git-branch">
            <span className="ide-git-branch-name">
              <Icon name="branch" size={12} />
              {status.branch || "detached"}
            </span>
            {(status.ahead > 0 || status.behind > 0) && (
              <span className="ide-git-track">
                {status.ahead > 0 && <span>↑{status.ahead}</span>}
                {status.behind > 0 && <span>↓{status.behind}</span>}
              </span>
            )}
            <span className="ide-git-spacer" />
            <button
              type="button"
              className="ide-git-text"
              disabled={Boolean(busy)}
              onClick={() => void run("pull", () => gitPull(root))}
              title="Pull changes"
            >
              {busy === "pull" ? "…" : "Pull"}
            </button>
            <button
              type="button"
              className="ide-git-text"
              disabled={Boolean(busy)}
              onClick={() => void run("push", () => gitPush(root))}
              title="Push commits"
            >
              {busy === "push" ? "…" : "Push"}
            </button>
          </div>

          {status.remotes.length === 0 || remoteOpen ? (
            <form
              className="ide-git-remote"
              onSubmit={(event) => {
                event.preventDefault();
                if (!remote.trim()) return;
                void run("remote", async () => {
                  const saved = await gitSetRemote(root, remote.trim());
                  setRemoteOpen(false);
                  return `Origin set to ${saved}`;
                });
              }}
            >
              <input
                autoFocus={remoteOpen}
                value={remote}
                onChange={(event) => setRemote(event.target.value)}
                placeholder="https://github.com/you/repo.git"
                spellCheck={false}
                aria-label="Repository URL"
              />
              <button type="submit" className="button-quiet small" disabled={!remote.trim()}>
                Connect
              </button>
            </form>
          ) : (
            <div className="ide-git-remote-row">
              <span className="ide-git-remote-text" title={origin}>
                {remoteHost}
              </span>
              {namespace && (
                <button
                  type="button"
                  className="ide-git-text"
                  onClick={() => void openExternal(`https://github.com/${namespace}`)}
                >
                  Open
                </button>
              )}
              <button
                type="button"
                className="ide-git-text"
                onClick={() => {
                  setRemote(origin);
                  setRemoteOpen(true);
                }}
              >
                Change
              </button>
            </div>
          )}

          {dirty.size > 0 && (
            <div className="ide-git-unsaved">
              <span>{dirty.size} unsaved editor change{dirty.size === 1 ? "" : "s"}</span>
              <button type="button" className="ide-git-text" onClick={onSaveAll}>
                Save all
              </button>
            </div>
          )}

          {staged.length > 0 && (
            <section className="ide-git-staged">
              <div className="ide-git-group-head">
                <span>From Lantas · {staged.length}</span>
                <span className="ide-git-group-actions">
                  <button type="button" className="ide-git-text" onClick={() => void keepAll()}>
                    Keep all
                  </button>
                  <button
                    type="button"
                    className="ide-git-text is-quiet"
                    onClick={() => {
                      discardStaged();
                      notify("Declined the assistant's changes");
                    }}
                  >
                    Decline
                  </button>
                </span>
              </div>
              {staged.map((change: StagedChange) => (
                <div className="ide-git-review" key={change.path}>
                  <button
                    type="button"
                    className="ide-git-review-name"
                    onClick={() => onOpen(change.path)}
                    title={change.path}
                  >
                    <Icon name="file" size={12} />
                    {change.path.split("/").pop()}
                  </button>
                  <span className="ide-git-group-actions">
                    <button
                      type="button"
                      className="ide-git-text"
                      onClick={async () => {
                        const ok = await keepChange(change.path);
                        notify(ok ? `Kept ${change.path}` : `${change.path} kept in the workspace; disk write failed`, ok ? "default" : "error");
                        if (ok) await refresh();
                      }}
                    >
                      Keep
                    </button>
                    <button
                      type="button"
                      className="ide-git-text is-quiet"
                      onClick={() => {
                        discardChange(change.path);
                        notify(`Declined ${change.path}`);
                      }}
                    >
                      Decline
                    </button>
                  </span>
                </div>
              ))}
            </section>
          )}

          <div className="ide-git-group-head">
            <span>Changes · {status.files.length}</span>
            {status.files.length > 0 && (
              <button
                type="button"
                className="ide-git-text"
                onClick={() =>
                  void run("stage", () => gitStage(root, status.files.map((file) => file.path)))
                }
              >
                Stage all
              </button>
            )}
          </div>

          {status.files.length === 0 ? (
            <p className="ide-side-note">Working tree clean.</p>
          ) : (
            <div className="ide-git-files">
              {status.files.map((file) => (
                <div
                  className={cx("ide-git-file", activePath === file.path && "is-active")}
                  key={`${file.path}-${file.staged ? "s" : "w"}`}
                >
                  <button
                    type="button"
                    className="ide-git-file-main"
                    onClick={() => onOpen(file.path)}
                    onDoubleClick={() => void showDiff(file.path, file.staged)}
                    title={file.path}
                  >
                    <span className={cx("ide-git-status", `is-${file.status.toLowerCase()}`)}>
                      {statusLabel(file.status)}
                    </span>
                    <span className="ide-git-file-name">{file.path.split("/").pop()}</span>
                    <span className="ide-git-file-dir">
                      {file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : ""}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="ide-git-stage"
                    onClick={() =>
                      void run(file.staged ? "unstage" : "stage", () =>
                        file.staged ? gitUnstage(root, [file.path]) : gitStage(root, [file.path]),
                      )
                    }
                    title={file.staged ? "Unstage" : "Stage"}
                    aria-label={file.staged ? `Unstage ${file.path}` : `Stage ${file.path}`}
                  >
                    {file.staged ? "−" : "+"}
                  </button>
                </div>
              ))}
            </div>
          )}

          {(stagedPaths.length > 0 || changedPaths.length > 0) && (
            <div className="ide-git-commit">
              <textarea
                rows={2}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Commit message"
                spellCheck={false}
                aria-label="Commit message"
              />
              <button
                type="button"
                className="button-primary small"
                disabled={!message.trim() || stagedPaths.length === 0 || Boolean(busy)}
                onClick={() =>
                  void run("commit", async () => {
                    const out = await gitCommit(root, message);
                    setMessage("");
                    return out.split("\n")[0] || "Committed";
                  })
                }
                title={
                  stagedPaths.length === 0
                    ? "Stage at least one file first"
                    : "Commit staged changes"
                }
              >
                {busy === "commit" ? "Committing…" : `Commit${stagedPaths.length ? ` ${stagedPaths.length}` : ""}`}
              </button>
            </div>
          )}

          {diff && (
            <div className="ide-git-diff">
              <div className="ide-git-group-head">
                <span title={diff.path}>{diff.path.split("/").pop()}</span>
                <button
                  type="button"
                  className="ide-git-text is-quiet"
                  onClick={() => setDiff(null)}
                >
                  Close
                </button>
              </div>
              <pre>{diff.text.slice(0, 12_000)}</pre>
            </div>
          )}

          {status.commits.length > 0 && (
            <section className="ide-git-log">
              <div className="ide-git-group-head">
                <span>Recent</span>
              </div>
              {status.commits.slice(0, 5).map((commit) => (
                <div className="ide-git-commit-row" key={commit.hash} title={commit.subject}>
                  <span className="ide-git-hash">{commit.hash}</span>
                  <span className="ide-git-subject">{commit.subject}</span>
                </div>
              ))}
            </section>
          )}

          <p className="ide-side-note">
            Push uses the git credentials already on this Mac. Lantas never stores a token.
          </p>
        </>
      )}
    </div>
  );
}
