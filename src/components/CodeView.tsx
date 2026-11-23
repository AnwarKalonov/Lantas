import { useMemo, useState } from "react";
import { useStore } from "../lib/store";
import { languageFor, openWorkspaceFolder, readLocalFiles } from "../lib/workspace";
import { cx } from "../lib/util";
import { Icon } from "./Icons";

export function CodeView({ onOpenFolder }: { onOpenFolder: () => void }) {
  const { state, setWorkspace, notify } = useStore();
  const [query, setQuery] = useState("");
  const [activePath, setActivePath] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [wrap, setWrap] = useState(false);

  const files = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return state.workspace;
    return state.workspace.filter((file) => file.path.toLowerCase().includes(term));
  }, [state.workspace, query]);

  const active =
    state.workspace.find((file) => file.path === activePath) ?? files[0] ?? null;
  const lines = active ? active.text.split("\n") : [];

  const dropFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const read = await readLocalFiles(list);
    setWorkspace(state.workspaceName || "Dropped files", [...read, ...state.workspace]);
    notify(`${read.length} file${read.length === 1 ? "" : "s"} added to the workspace`);
    setActivePath(read[0]?.path ?? activePath);
  };

  return (
    <section
      className={cx("code-view", dragging && "is-dropping")}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void dropFiles(event.dataTransfer.files);
      }}
    >
      <header className="code-head">
        <div className="code-head-left">
          <Icon name="folder" size={14} />
          <span className="code-project">{state.workspaceName || "No folder open"}</span>
          {state.workspace.length > 0 && (
            <span className="code-count">{state.workspace.length} files</span>
          )}
        </div>
        <div className="code-head-right">
          <label className="code-filter">
            <Icon name="search" size={13} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter files"
              spellCheck={false}
            />
          </label>
          <button type="button" className="bar-icon" onClick={onOpenFolder} title="Open folder">
            <Icon name="folder" size={15} />
          </button>
        </div>
      </header>

      {state.workspace.length === 0 ? (
        <div className="code-empty">
          <div className="code-empty-art" aria-hidden="true">
            <Icon name="frame" size={30} />
          </div>
          <h2>Give Lantas a folder</h2>
          <p>
            It reads what you pick — nothing is uploaded. In the desktop app this is a native
            picker; in a browser it asks once for the directory.
          </p>
          <div className="code-empty-actions">
            <button type="button" className="button-primary" onClick={onOpenFolder}>
              <Icon name="folder" size={14} />
              Open folder
            </button>
            <label className="button-ghost">
              <Icon name="plus" size={14} />
              Drop or pick files
              <input
                type="file"
                multiple
                hidden
                onChange={(event) => void dropFiles(event.target.files)}
              />
            </label>
          </div>
          <p className="code-hint">You can also drag files anywhere onto this panel.</p>
        </div>
      ) : (
        <div className="code-body">
          <aside className="code-tree">
            <div className="code-tree-head">
              <span>{files.length} shown</span>
              <button
                type="button"
                className="text-button"
                onClick={async () => {
                  try {
                    const next = await openWorkspaceFolder();
                    if (!next) return;
                    setWorkspace(next.name, next.files);
                    setActivePath(next.files[0]?.path ?? null);
                    notify(`${next.files.length} files from ${next.name}`);
                  } catch (error) {
                    notify(error instanceof Error ? error.message : "Could not open that folder", "error");
                  }
                }}
              >
                Change
              </button>
            </div>
            <div className="code-tree-rows">
              {files.map((file) => (
                <button
                  key={file.id}
                  type="button"
                  className={cx("code-tree-row", active?.path === file.path && "is-active")}
                  onClick={() => setActivePath(file.path)}
                >
                  <Icon name="file" size={12} />
                  <span className="code-tree-name">{file.name}</span>
                  <span className="code-tree-dir">
                    {file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : ""}
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <div className="code-main">
            {active ? (
              <>
                <div className="code-file-head">
                  <div className="code-file-path">
                    <Icon name="file" size={13} />
                    <span>{active.path}</span>
                  </div>
                  <div className="code-file-meta">
                    <span className="code-lang">{languageFor(active.path)}</span>
                    <span className="code-lines">{lines.length} lines</span>
                    <button
                      type="button"
                      className={cx("bar-icon", wrap && "is-on")}
                      onClick={() => setWrap((value) => !value)}
                      title="Wrap lines"
                    >
                      <Icon name="panelLeft" size={14} />
                    </button>
                    <button
                      type="button"
                      className="bar-icon"
                      title="Copy path"
                      onClick={() => {
                        navigator.clipboard?.writeText(active.path).catch(() => {});
                        notify("Path copied");
                      }}
                    >
                      <Icon name="copy" size={14} />
                    </button>
                  </div>
                </div>
                {active.binary || !active.text ? (
                  <div className="code-binary">
                    <Icon name="alert" size={16} />
                    <p>This file is binary or too large to preview.</p>
                    <span>{Math.max(1, Math.round(active.size / 1024))} KB</span>
                  </div>
                ) : (
                  <div className={cx("code-scroll", wrap && "is-wrapped")}>
                    <pre className="code-pre">
                      {lines.map((line, index) => (
                        <div className="code-line" key={index}>
                          <span className="code-gutter">{index + 1}</span>
                          <span className="code-text">{line || " "}</span>
                        </div>
                      ))}
                    </pre>
                  </div>
                )}
              </>
            ) : (
              <div className="code-empty small">
                <p>No file matches that filter.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {dragging && <div className="code-drop-hint">Drop to add to this workspace</div>}
    </section>
  );
}
