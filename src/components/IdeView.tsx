import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../lib/store";
import {
  allDirPaths,
  buildTree,
  countLines,
  fileInitials,
  fileTone,
  quickOpen,
  searchWorkspace,
  type TreeNode,
} from "../lib/ide";
import { monacoLanguage } from "../lib/ide";
import { readLocalFiles, writeWorkspaceFile } from "../lib/workspace";
import type { Session } from "../lib/types";
import { cx } from "../lib/util";
import { Icon } from "./Icons";
import { MonacoEditor } from "./MonacoEditor";

type Activity = "explorer" | "search" | "git" | "skills";

interface IdeViewProps {
  onExit: () => void;
  onOpenFolder: () => void;
  onOpenSettings: () => void;
  onOpenSkills: () => void;
  onAsk: (text: string) => void;
  session: Session | null;
  defaultModel: string;
  streaming: boolean;
}

const RAIL: Array<{ id: Activity; label: string; icon: "folder" | "search" | "branch" | "book" }> = [
  { id: "explorer", label: "Explorer", icon: "folder" },
  { id: "search", label: "Search", icon: "search" },
  { id: "git", label: "Source control", icon: "branch" },
  { id: "skills", label: "Skills", icon: "book" },
];

function TreeRows({
  nodes,
  depth,
  expanded,
  onToggle,
  active,
  dirty,
  onOpen,
}: {
  nodes: TreeNode[];
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  active: string | null;
  dirty: Set<string>;
  onOpen: (path: string) => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        if (node.dir) {
          const open = expanded.has(node.path);
          return (
            <div key={node.path}>
              <button
                type="button"
                className="ide-tree-row is-dir"
                style={{ paddingLeft: 10 + depth * 12 }}
                onClick={() => onToggle(node.path)}
              >
                <Icon
                  name="chevronRight"
                  size={12}
                  className={cx("ide-caret", open && "is-open")}
                />
                <Icon name="folder" size={13} className="ide-tree-folder" />
                <span>{node.name}</span>
              </button>
              {open && (
                <TreeRows
                  nodes={node.children}
                  depth={depth + 1}
                  expanded={expanded}
                  onToggle={onToggle}
                  active={active}
                  dirty={dirty}
                  onOpen={onOpen}
                />
              )}
            </div>
          );
        }
        return (
          <button
            key={node.path}
            type="button"
            className={cx("ide-tree-row", active === node.path && "is-active")}
            style={{ paddingLeft: 22 + depth * 12 }}
            onClick={() => onOpen(node.path)}
            title={node.path}
          >
            <span className="ide-file-badge" style={{ color: fileTone(node.path) }}>
              {fileInitials(node.path)}
            </span>
            <span className="ide-tree-name">{node.name}</span>
            {dirty.has(node.path) && <span className="ide-dirty" aria-label="Unsaved" />}
          </button>
        );
      })}
    </>
  );
}

export function IdeView({
  onExit,
  onOpenFolder,
  onOpenSettings,
  onOpenSkills,
  onAsk,
  session,
  defaultModel,
  streaming,
}: IdeViewProps) {
  const {
    state,
    patchWorkspaceFile,
    setWorkspace,
    notify,
  } = useStore();
  const [activity, setActivity] = useState<Activity>("explorer");
  const [sideOpen, setSideOpen] = useState(true);
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [tabs, setTabs] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [search, setSearch] = useState("");
  const [quick, setQuick] = useState<string | null>(null);
  const [askDraft, setAskDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const quickRef = useRef<HTMLInputElement | null>(null);
  const askRef = useRef<HTMLTextAreaElement | null>(null);
  const [initialLine, setInitialLine] = useState<number | undefined>(undefined);
  const [dropping, setDropping] = useState(false);
  const [resolvedTheme, setResolvedTheme] = useState<"dark" | "light">(() => {
    if (state.settings.theme !== "system") return state.settings.theme;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });

  const files = state.workspace;
  const tree = useMemo(() => buildTree(files), [files]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (files.length && expanded.size === 0) {
      setExpanded(new Set(allDirPaths(tree)));
    }
  }, [files.length, tree, expanded.size]);

  const activeFile = files.find((file) => file.path === active) ?? null;
  const activeText = active ? (drafts[active] ?? activeFile?.text ?? "") : "";

  const dirty = useMemo(() => {
    const set = new Set<string>();
    for (const file of files) {
      const draft = drafts[file.path];
      if (draft !== undefined && draft !== file.text) set.add(file.path);
    }
    return set;
  }, [drafts, files]);

  const open = useCallback((path: string, line?: number) => {
    setTabs((current) => (current.includes(path) ? current : [...current, path]));
    setActive(path);
    setInitialLine(line);
    setQuick(null);
  }, []);

  const close = (path: string) => {
    setTabs((current) => {
      const next = current.filter((item) => item !== path);
      if (active === path) setActive(next[next.length - 1] ?? null);
      return next;
    });
  };

  const updateDraft = (path: string, text: string) => {
    setDrafts((current) => ({ ...current, [path]: text }));
  };

  const save = useCallback(
    async (path: string) => {
      const file = files.find((item) => item.path === path);
      if (!file) return;
      const text = drafts[path] ?? file.text;
      setSaving(true);
      let disk = false;
      try {
        disk = await writeWorkspaceFile(state.workspaceRoot, path, text);
      } catch {
        disk = false;
      }
      patchWorkspaceFile(path, text);
      setDrafts((current) => {
        const next = { ...current };
        delete next[path];
        return next;
      });
      setSaving(false);
      if (disk) notify(`Saved ${file.name}`);
      else notify(`${file.name} updated in the IDE — open the folder with write access to save to disk`, "error");
    },
    [drafts, files, notify, patchWorkspaceFile, state.workspaceRoot],
  );

  const saveActive = useCallback(() => {
    if (active) void save(active);
  }, [active, save]);

  const saveAll = async () => {
    for (const path of Array.from(dirty)) {
      // Sequential: one failed write should not block the rest.
      // eslint-disable-next-line no-await-in-loop
      await save(path);
    }
  };

  const discard = (path: string) => {
    setDrafts((current) => {
      const next = { ...current };
      delete next[path];
      return next;
    });
    notify("Reverted to the saved file");
  };

  useEffect(() => {
    if (state.settings.theme !== "system") {
      setResolvedTheme(state.settings.theme);
      return undefined;
    }
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => setResolvedTheme(query.matches ? "light" : "dark");
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [state.settings.theme]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (key === "p") {
        event.preventDefault();
        setQuick((value) => value ?? "");
      } else if (key === "s") {
        event.preventDefault();
        if (event.shiftKey) void saveAll();
        else saveActive();
      } else if (key === "b") {
        event.preventDefault();
        setSideOpen((value) => !value);
      } else if (key === "j") {
        event.preventDefault();
        setAssistantOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveActive, saveAll]);

  useEffect(() => {
    if (quick !== null) quickRef.current?.focus();
  }, [quick]);

  useEffect(() => {
    if (!active && files.length) open(files[0].path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files.length]);

  const searchHits = useMemo(
    () => (activity === "search" ? searchWorkspace(files, search, 80) : []),
    [activity, files, search],
  );
  const quickFiles = useMemo(
    () => (quick === null ? [] : quickOpen(files, quick, 24)),
    [files, quick],
  );

  const recent = (session?.messages ?? [])
    .slice(-6)
    .flatMap((message) =>
      message.parts
        .filter((part): part is Extract<typeof part, { kind: "text" }> => part.kind === "text")
        .map((part) => ({ role: message.role, text: part.text })),
    )
    .filter((entry) => entry.text.trim())
    .slice(-4);

  const sendAsk = () => {
    const text = askDraft.trim();
    if (!text || streaming) return;
    onAsk(text);
    setAskDraft("");
    notify("Sent to Lantas");
  };

  return (
    <div
      className={cx("ide", dropping && "is-dropping")}
      onDragOver={(event) => {
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDropping(false);
      }}
      onDrop={async (event) => {
        event.preventDefault();
        setDropping(false);
        const dropped = await readLocalFiles(event.dataTransfer.files);
        if (!dropped.length) return;
        setWorkspace(
          state.workspaceName || "Dropped files",
          [...dropped, ...files.filter((file) => !dropped.some((item) => item.path === file.path))],
        );
        open(dropped[0].path);
        notify(`${dropped.length} file${dropped.length === 1 ? "" : "s"} opened`);
      }}
    >
      <header className="ide-top" data-tauri-drag-region>
        <div className="ide-top-left">
          <button type="button" className="ide-brand" onClick={onExit} title="Back to Lantas">
            <span className="ide-brand-mark" aria-hidden="true" />
            <span className="ide-brand-name">Lantas</span>
            <span className="ide-brand-tag">IDE</span>
          </button>
          <span className="ide-top-sep" />
          <button
            type="button"
            className="ide-project"
            onClick={onOpenFolder}
            title="Open another folder"
          >
            <Icon name="folder" size={13} />
            {state.workspaceName || "No folder open"}
          </button>
          <span className="ide-branch">
            <Icon name="branch" size={12} />
            {session?.branch ?? "main"}
          </span>
        </div>
        <div className="ide-top-center">
          <button type="button" className="ide-search-trigger" onClick={() => setQuick("")}>
            <Icon name="search" size={13} />
            <span>{state.workspaceName || "Files"}</span>
            <kbd>⌘P</kbd>
          </button>
        </div>
        <div className="ide-top-right">
          <button
            type="button"
            className="ide-icon-button"
            onClick={saveActive}
            disabled={!active || saving}
            title="Save (⌘S)"
            aria-label="Save"
          >
            <Icon name="check" size={15} />
          </button>
          <button
            type="button"
            className={cx("ide-icon-button", assistantOpen && "is-on")}
            onClick={() => setAssistantOpen((value) => !value)}
            title="Lantas assistant (⌘J)"
            aria-label="Assistant"
          >
            <Icon name="sparkle" size={15} />
          </button>
          <button
            type="button"
            className="ide-icon-button"
            onClick={onOpenSettings}
            title="Settings"
            aria-label="Settings"
          >
            <Icon name="settings" size={15} />
          </button>
          <button type="button" className="ide-exit" onClick={onExit}>
            Chat
            <Icon name="chevronRight" size={12} />
          </button>
        </div>
      </header>

      <div className="ide-body">
        <nav className="ide-rail" aria-label="IDE sections">
          {RAIL.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cx(
                "ide-rail-button",
                activity === item.id && sideOpen && "is-active",
              )}
              onClick={() => {
                if (item.id === "skills") {
                  onOpenSkills();
                  return;
                }
                if (activity === item.id) setSideOpen((value) => !value);
                else {
                  setActivity(item.id);
                  setSideOpen(true);
                }
              }}
              title={item.label}
              aria-label={item.label}
            >
              <Icon name={item.icon} size={18} />
              {item.id === "git" && dirty.size > 0 && (
                <span className="ide-rail-badge">{dirty.size}</span>
              )}
            </button>
          ))}
          <span className="ide-rail-spacer" />
          <button
            type="button"
            className="ide-rail-button"
            onClick={() => setAssistantOpen((value) => !value)}
            title="Lantas assistant (⌘J)"
            aria-label="Lantas assistant"
          >
            <Icon name="message" size={17} />
          </button>
        </nav>

        {sideOpen && (
          <aside className="ide-side">
            {activity === "explorer" && (
              <>
                <div className="ide-side-head">
                  <span>Explorer</span>
                  <div className="ide-side-actions">
                    <button
                      type="button"
                      className="ide-icon-button small"
                      onClick={onOpenFolder}
                      title="Open folder"
                      aria-label="Open folder"
                    >
                      <Icon name="folder" size={13} />
                    </button>
                  </div>
                </div>
                <div className="ide-tree">
                  {files.length > 0 ? (
                    <TreeRows
                      nodes={tree}
                      depth={0}
                      expanded={expanded}
                      onToggle={(path) =>
                        setExpanded((current) => {
                          const next = new Set(current);
                          if (next.has(path)) next.delete(path);
                          else next.add(path);
                          return next;
                        })
                      }
                      active={active}
                      dirty={dirty}
                      onOpen={open}
                    />
                  ) : (
                    <div className="ide-empty-side">
                      <p>A folder is not open.</p>
                      <button type="button" className="button-primary small" onClick={onOpenFolder}>
                        Open folder
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            {activity === "search" && (
              <>
                <div className="ide-side-head">
                  <span>Search</span>
                  {searchHits.length > 0 && <span className="ide-count">{searchHits.length}</span>}
                </div>
                <label className="ide-search-input">
                  <Icon name="search" size={13} />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search files"
                    spellCheck={false}
                    autoFocus
                  />
                </label>
                <div className="ide-results">
                  {searchHits.map((hit) => (
                    <button
                      key={`${hit.path}:${hit.line}`}
                      type="button"
                      className="ide-result"
                      onClick={() => open(hit.path, hit.line)}
                    >
                      <span className="ide-result-path">
                        {hit.path}
                        <span className="ide-result-line">{hit.line}</span>
                      </span>
                      <span className="ide-result-text">{hit.text}</span>
                    </button>
                  ))}
                  {search.trim().length > 1 && searchHits.length === 0 && (
                    <p className="ide-side-note">No matches in the open folder.</p>
                  )}
                  {search.trim().length < 2 && (
                    <p className="ide-side-note">Type at least two characters.</p>
                  )}
                </div>
              </>
            )}

            {activity === "git" && (
              <>
                <div className="ide-side-head">
                  <span>Source control</span>
                  <span className="ide-count">{dirty.size}</span>
                </div>
                <div className="ide-git-actions">
                  <button type="button" className="button-quiet small" onClick={() => void saveAll()} disabled={dirty.size === 0}>
                    Save all
                  </button>
                  <button type="button" className="button-quiet small" onClick={() => setDrafts({})} disabled={dirty.size === 0}>
                    Discard all
                  </button>
                </div>
                {dirty.size === 0 ? (
                  <p className="ide-side-note">No unsaved changes. Edits appear here until you save.</p>
                ) : (
                  <div className="ide-results">
                    {Array.from(dirty).map((path) => (
                      <div className="ide-change" key={path}>
                        <button type="button" onClick={() => open(path)}>
                          <span className="ide-file-badge" style={{ color: fileTone(path) }}>
                            {fileInitials(path)}
                          </span>
                          <span className="ide-change-text">
                            <span>{path.split("/").pop()}</span>
                            <small>{path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""}</small>
                          </span>
                          <span className="ide-change-mark">M</span>
                        </button>
                        <div className="ide-change-actions">
                          <button type="button" className="text-button" onClick={() => void save(path)}>
                            Save
                          </button>
                          <button type="button" className="text-button" onClick={() => discard(path)}>
                            Revert
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <p className="ide-side-note">
                  Saves write through to the folder you opened. Commits stay in your own terminal.
                </p>
              </>
            )}
          </aside>
        )}

        <main className="ide-main">
          <div className="ide-tabs" role="tablist">
            {tabs.map((path) => {
              const file = files.find((item) => item.path === path);
              return (
                <div
                  key={path}
                  className={cx("ide-tab", active === path && "is-active")}
                  role="tab"
                  aria-selected={active === path}
                >
                  <button type="button" className="ide-tab-name" onClick={() => setActive(path)}>
                    <span className="ide-file-badge" style={{ color: fileTone(path) }}>
                      {fileInitials(path)}
                    </span>
                    {file?.name ?? path.split("/").pop()}
                    {dirty.has(path) && <span className="ide-dirty" aria-label="Unsaved" />}
                  </button>
                  <button
                    type="button"
                    className="ide-tab-close"
                    aria-label={`Close ${file?.name ?? path}`}
                    onClick={() => close(path)}
                  >
                    <Icon name="close" size={11} />
                  </button>
                </div>
              );
            })}
            <span className="ide-tabs-spacer" />
            {dirty.size > 0 && (
              <button type="button" className="ide-tab-save" onClick={() => void saveAll()}>
                Save {dirty.size}
              </button>
            )}
          </div>

          {activeFile ? (
            <>
              <div className="ide-crumbs">
                {activeFile.path.split("/").map((part, index, parts) => (
                  <span key={`${part}-${index}`} className="ide-crumb">
                    {part}
                    {index < parts.length - 1 && <Icon name="chevronRight" size={10} />}
                  </span>
                ))}
                <span className="ide-crumbs-spacer" />
                {dirty.has(activeFile.path) && (
                  <button type="button" className="text-button" onClick={() => discard(activeFile.path)}>
                    Revert
                  </button>
                )}
              </div>
              {activeFile.binary ? (
                <div className="ide-binary">
                  <Icon name="file" size={18} />
                  <p>Binary file. The editor shows text only.</p>
                  <span>{Math.max(1, Math.round(activeFile.size / 1024))} KB</span>
                </div>
              ) : (
                <MonacoEditor
                  path={activeFile.path}
                  value={activeText}
                  theme={resolvedTheme}
                  initialLine={initialLine}
                  onChange={(text) => updateDraft(activeFile.path, text)}
                  onSave={saveActive}
                  onCursor={(line, column) => setCursor({ line, column })}
                />
              )}
            </>
          ) : (
            <div className="ide-welcome">
              <div className="ide-welcome-card">
                <p className="ide-welcome-kicker">Lantas IDE</p>
                <h1>Open a folder to start</h1>
                <p>
                  The editor is VS Code's Monaco, running locally. Files are read from the folder you
                  pick, edits save back to it, and Lantas can read the same workspace when you ask.
                </p>
                <div className="ide-welcome-actions">
                  <button type="button" className="button-primary" onClick={onOpenFolder}>
                    <Icon name="folder" size={14} />
                    Open folder
                  </button>
                  {files.length > 0 && (
                    <button type="button" className="button-quiet" onClick={() => setQuick("")}>
                      Quick open
                    </button>
                  )}
                </div>
                <div className="ide-welcome-keys">
                  <span><kbd>⌘P</kbd> quick open</span>
                  <span><kbd>⌘S</kbd> save</span>
                  <span><kbd>⌘J</kbd> assistant</span>
                </div>
              </div>
            </div>
          )}
        </main>

        {assistantOpen && (
          <aside className="ide-assistant">
            <div className="ide-assistant-head">
              <div>
                <span className="ide-assistant-title">Lantas</span>
                <span className="ide-assistant-sub">
                  {session?.model || defaultModel || "No model"}
                </span>
              </div>
              <button
                type="button"
                className="ide-icon-button small"
                onClick={() => setAssistantOpen(false)}
                aria-label="Close assistant"
              >
                <Icon name="close" size={13} />
              </button>
            </div>
            <div className="ide-assistant-thread">
              {recent.length === 0 ? (
                <div className="ide-assistant-empty">
                  <p>Ask about this folder. Lantas reads the open workspace and writes back through the editor.</p>
                  <div className="ide-assistant-suggestions">
                    {["Summarize this project", "Find the riskiest code", "Fix the failing check"].map(
                      (item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() => {
                            onAsk(item);
                            notify("Sent to Lantas");
                          }}
                        >
                          {item}
                        </button>
                      ),
                    )}
                  </div>
                </div>
              ) : (
                recent.map((entry, index) => (
                  <div className={cx("ide-msg", entry.role === "user" ? "is-user" : "is-agent")} key={index}>
                    <span className="ide-msg-role">{entry.role === "user" ? "You" : "Lantas"}</span>
                    <p>{entry.text.slice(0, 1600)}</p>
                  </div>
                ))
              )}
              {streaming && (
                <div className="ide-msg is-agent is-live">
                  <span className="ide-msg-role">Lantas</span>
                  <span className="ide-typing"><i /><i /><i /></span>
                </div>
              )}
            </div>
            <div className="ide-assistant-composer">
              <textarea
                ref={askRef}
                rows={3}
                value={askDraft}
                onChange={(event) => setAskDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || !event.shiftKey)) {
                    event.preventDefault();
                    sendAsk();
                  }
                }}
                placeholder="Ask about this folder"
                spellCheck={false}
              />
              <div className="ide-assistant-actions">
                <span className="ide-assistant-hint">⇧↵ new line</span>
                <button
                  type="button"
                  className="button-primary small"
                  onClick={sendAsk}
                  disabled={!askDraft.trim() || streaming}
                >
                  Send
                </button>
              </div>
            </div>
            <button type="button" className="ide-assistant-open" onClick={onExit}>
              Open full chat
              <Icon name="chevronRight" size={12} />
            </button>
          </aside>
        )}
      </div>

      <footer className="ide-status">
        <div className="ide-status-left">
          <span className="ide-status-item">
            <Icon name="branch" size={12} />
            {session?.branch ?? "main"}
          </span>
          {dirty.size > 0 && (
            <span className="ide-status-item">
              <span className="ide-dirty" />
              {dirty.size} unsaved
            </span>
          )}
          <span className="ide-status-item dim">
            {files.length} files
          </span>
        </div>
        <div className="ide-status-right">
          {activeFile && (
            <>
              <span className="ide-status-item">
                Ln {cursor.line}, Col {cursor.column}
              </span>
              <span className="ide-status-item">
                {countLines(activeText)} lines
              </span>
              <span className="ide-status-item">{monacoLanguage(activeFile.path)}</span>
              <span className="ide-status-item">Spaces: 2</span>
            </>
          )}
          <span className="ide-status-item dim">UTF-8</span>
          <span className="ide-status-item accent">Lantas IDE</span>
        </div>
      </footer>

      {dropping && <div className="ide-drop-hint">Drop files to open them in the IDE</div>}

      {quick !== null && (
        <div className="ide-quick-overlay" onMouseDown={() => setQuick(null)}>
          <div className="ide-quick" onMouseDown={(event) => event.stopPropagation()}>
            <label className="ide-quick-input">
              <Icon name="search" size={14} />
              <input
                ref={quickRef}
                value={quick}
                onChange={(event) => setQuick(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setQuick(null);
                  if (event.key === "Enter" && quickFiles[0]) open(quickFiles[0].path);
                }}
                placeholder="Go to file"
                spellCheck={false}
              />
              <kbd>esc</kbd>
            </label>
            <div className="ide-quick-list">
              {quickFiles.map((file, index) => (
                <button
                  key={file.path}
                  type="button"
                  className={cx("ide-quick-row", index === 0 && "is-first")}
                  onClick={() => open(file.path)}
                >
                  <span className="ide-file-badge" style={{ color: fileTone(file.path) }}>
                    {fileInitials(file.path)}
                  </span>
                  <span className="ide-quick-name">{file.name}</span>
                  <span className="ide-quick-path">
                    {file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : ""}
                  </span>
                </button>
              ))}
              {quickFiles.length === 0 && (
                <p className="ide-quick-empty">
                  {files.length ? "No file matches that name." : "Open a folder first."}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
