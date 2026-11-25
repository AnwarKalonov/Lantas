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
import {
  createWorkspaceFile,
  createWorkspaceFolder,
  deleteWorkspacePath,
  readLocalFiles,
  readWorkspaceWithExtras,
  resolveWorkspaceTarget,
  renameWorkspacePath,
  writeWorkspacePath,
} from "../lib/workspace";
import { inTauri, openInVsCode } from "../lib/native";
import { readAttachments } from "../lib/attachments";
import type { Attachment, ProviderId, Session, WorkspaceFile } from "../lib/types";
import { cx } from "../lib/util";
import { GitPanel } from "./GitPanel";
import { ExtensionsPanel } from "./ExtensionsPanel";
import { ModelPicker } from "./ModelPicker";
import { Icon } from "./Icons";
import { MonacoEditor } from "./MonacoEditor";
import { TerminalPanel } from "./TerminalPanel";
import { Transcript } from "./Transcript";
import { StagedDiffReview } from "./DiffViewer";

type Activity = "explorer" | "search" | "git" | "extensions" | "skills";

type MenuEntry = {
  key: string;
  label?: string;
  kbd?: string;
  run?: () => void;
  disabled?: boolean;
  sep?: boolean;
};
type MenuGroup = { id: string; label: string; items: MenuEntry[] };

/**
 * Buffers outlive the Code surface. Leaving Code for chat unmounts the
 * workspace, so keeping tabs and drafts here means unsaved edits are still
 * there (and still dirty) when the user comes back instead of vanishing.
 */
const bufferCache: {
  active: string | null;
  tabs: string[];
  drafts: Record<string, string>;
} = { active: null, tabs: [], drafts: {} };

interface IdeViewProps {
  onExit: () => void;
  onOpenFolder: () => void;
  onAddFolder: () => void;
  onOpenSettings: () => void;
  onOpenSkills: () => void;
  onAsk: (text: string, attachments?: Attachment[]) => void;
  session: Session | null;
  defaultModel: string;
  streaming: boolean;
  onStop: () => void;
  openRequest?: { path: string; line?: number; nonce: number } | null;
  cliRequest?: number;
}

const RAIL: Array<{
  id: Activity;
  label: string;
  icon: "folder" | "search" | "branch" | "book" | "sparkle";
}> = [
  { id: "explorer", label: "Explorer", icon: "folder" },
  { id: "search", label: "Search", icon: "search" },
  { id: "git", label: "Source control", icon: "branch" },
  { id: "extensions", label: "Extensions", icon: "sparkle" },
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
  onAddFolder,
  onOpenSettings,
  onOpenSkills,
  onAsk,
  session,
  defaultModel,
  streaming,
  onStop,
  openRequest,
  cliRequest,
}: IdeViewProps) {
  const {
    state,
    patchWorkspaceFile,
    setWorkspace,
    setSettings,
    updateSession,
    createSession,
    staged,
    keepStaged,
    discardStaged,
    keepChange,
    discardChange,
    notify,
  } = useStore();
  const [activity, setActivity] = useState<Activity>("explorer");
  const [sideOpen, setSideOpen] = useState(true);
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [tabs, setTabs] = useState<string[]>(() => [...bufferCache.tabs]);
  const [active, setActive] = useState<string | null>(() => bufferCache.active);
  const [drafts, setDrafts] = useState<Record<string, string>>(() => ({ ...bufferCache.drafts }));
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [search, setSearch] = useState("");
  const [quick, setQuick] = useState<string | null>(null);
  const [askDraft, setAskDraft] = useState("");
  const [askFiles, setAskFiles] = useState<Attachment[]>([]);
  const askFileInput = useRef<HTMLInputElement>(null);

  /** Same attachment rules as the main composer: images the model can see,
   *  text files as contents, everything else named. */
  const attachToAsk = async (list: FileList | null) => {
    const { files, rejected } = await readAttachments(list);
    if (rejected.length) notify(rejected[0], "error");
    if (files.length) setAskFiles((current) => [...current, ...files]);
  };
  const [saving, setSaving] = useState(false);
  const [entryPrompt, setEntryPrompt] = useState<"file" | "folder" | "rename" | null>(null);
  const [entryName, setEntryName] = useState("");
  const [entryBusy, setEntryBusy] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [openEditorsOpen, setOpenEditorsOpen] = useState(true);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);
  const [cliTick, setCliTick] = useState(0);
  const [openingCode, setOpeningCode] = useState(false);
  const quickRef = useRef<HTMLInputElement | null>(null);
  const askRef = useRef<HTMLTextAreaElement | null>(null);
  const entryRef = useRef<HTMLInputElement | null>(null);
  const lastOpenRequest = useRef(0);
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
    bufferCache.tabs = tabs;
    bufferCache.active = active;
    bufferCache.drafts = drafts;
  }, [tabs, active, drafts]);

  useEffect(() => {
    if (files.length && expanded.size === 0) {
      setExpanded(new Set(allDirPaths(tree)));
    }
  }, [files.length, tree, expanded.size]);

  const activeFile = files.find((file) => file.path === active) ?? null;
  const activeText = active ? (drafts[active] ?? activeFile?.text ?? "") : "";

  // A restored buffer can point at a file that was renamed or deleted while the
  // user was in chat.
  useEffect(() => {
    if (!files.length) return;
    const known = new Set(files.map((file) => file.path));
    setTabs((current) => {
      const next = current.filter((path) => known.has(path));
      return next.length === current.length ? current : next;
    });
    setActive((current) => (current && known.has(current) ? current : null));
  }, [files]);

  const dirty = useMemo(() => {
    const set = new Set<string>();
    for (const file of files) {
      const draft = drafts[file.path];
      if (draft !== undefined && draft !== file.text) set.add(file.path);
    }
    return set;
  }, [drafts, files]);

  const open = useCallback((path: string, line?: number) => {
    if (files.some((file) => file.dir && file.path === path)) return;
    setTabs((current) => (current.includes(path) ? current : [...current, path]));
    setActive(path);
    setInitialLine(line);
    setQuick(null);
  }, [files]);

  const close = (path: string) => {
    setTabs((current) => {
      const next = current.filter((item) => item !== path);
      if (active === path) setActive(next[next.length - 1] ?? null);
      return next;
    });
  };

  const refreshFromDisk = useCallback(async () => {
    if (!state.workspaceRoot) return;
    const next = await readWorkspaceWithExtras(state.workspaceRoot);
    if (next) setWorkspace(next.name, next.files, next.root);
  }, [setWorkspace, state.workspaceRoot]);

  useEffect(() => {
    if (!cliRequest) return;
    setTerminalOpen(true);
  }, [cliRequest]);

  useEffect(() => {
    if (!openRequest || lastOpenRequest.current === openRequest.nonce) return;
    const wanted = openRequest.path.replace(/^\.\//, "");
    const match =
      files.find((file) => !file.dir && file.path === wanted) ??
      files.find((file) => !file.dir && file.path.endsWith(`/${wanted}`)) ??
      files.find((file) => !file.dir && file.name === wanted.split("/").pop());
    if (!match) {
      lastOpenRequest.current = openRequest.nonce;
      notify(
        files.length
          ? `${wanted} is not in this folder`
          : "Open a folder first, then click the file again",
        "error",
      );
      return;
    }
    lastOpenRequest.current = openRequest.nonce;
    open(match.path, openRequest.line);
  }, [files, notify, open, openRequest]);

  useEffect(() => {
    if (entryPrompt) entryRef.current?.focus();
  }, [entryPrompt]);

  const startEntry = (kind: "file" | "folder" | "rename") => {
    // A browser tab opens a folder through the File System Access API and has no
    // absolute root, so creating, renaming and deleting are desktop-only. Say
    // that instead of reopening the picker as if nothing were open.
    if (!state.workspaceRoot) {
      notify(
        inTauri()
          ? "Open a folder first"
          : "Creating and renaming files needs the desktop app. Editing and saving open files works here.",
        "error",
      );
      return;
    }
    if (kind === "rename" && !active) return;
    setEntryName(kind === "rename" ? active ?? "" : "");
    setEntryPrompt(kind);
  };

  const commitEntry = async () => {
    if (!entryPrompt || !entryName.trim() || entryBusy) return;
    const relative = entryName.trim().replace(/^\/+|\/+$/g, "");
    if (!relative) return;
    setEntryBusy(true);
    try {
      const target = resolveWorkspaceTarget(state.workspaceRoot, relative);
      if (entryPrompt === "file") {
        await createWorkspaceFile(target.root, target.relative, "");
        patchWorkspaceFile(relative, "");
        open(relative);
        notify(`Created ${relative}`);
      } else if (entryPrompt === "folder") {
        await createWorkspaceFolder(target.root, target.relative);
        const next = await readWorkspaceWithExtras(state.workspaceRoot);
        if (next) setWorkspace(next.name, next.files, next.root);
        else if (!files.some((file) => file.path === relative)) {
          const folder: WorkspaceFile = {
            id: relative,
            name: relative.split("/").pop() ?? relative,
            path: relative,
            size: 0,
            added: Date.now(),
            text: "",
            dir: true,
          };
          setWorkspace(state.workspaceName || "Workspace", [...files, folder], state.workspaceRoot);
          setExpanded((current) => new Set(current).add(relative));
        }
        notify(`Created ${relative}/`);
      } else if (active) {
        const previous = active;
        const from = resolveWorkspaceTarget(state.workspaceRoot, previous);
        if (from.root !== target.root) throw new Error("A file cannot move between two folders.");
        const moved = await renameWorkspacePath(from.root, from.relative, target.relative);
        if (!moved) throw new Error("Renaming needs the desktop app.");
        const next = await readWorkspaceWithExtras(state.workspaceRoot);
        if (next) {
          setWorkspace(next.name, next.files, next.root);
        } else {
          setWorkspace(
            state.workspaceName || "Workspace",
            files.map((file) =>
              file.path === previous || file.path.startsWith(`${previous}/`)
                ? {
                    ...file,
                    id: relative + file.path.slice(previous.length),
                    path: relative + file.path.slice(previous.length),
                    name: (relative + file.path.slice(previous.length)).split("/").pop() ?? file.name,
                  }
                : file,
            ),
            state.workspaceRoot,
          );
        }
        setTabs((current) => current.map((path) => (path === previous ? relative : path)));
        setDrafts((current) => {
          if (!(previous in current)) return current;
          const nextDrafts = { ...current };
          nextDrafts[relative] = nextDrafts[previous];
          delete nextDrafts[previous];
          return nextDrafts;
        });
        setActive(relative);
        notify(`Renamed to ${relative}`);
      }
      setEntryPrompt(null);
      setEntryName("");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not update the file", "error");
    } finally {
      setEntryBusy(false);
    }
  };

  const deleteActive = async () => {
    if (!active) return;
    if (!window.confirm(`Delete ${active}? This cannot be undone.`)) return;
    try {
      const target = resolveWorkspaceTarget(state.workspaceRoot, active);
      const removed = await deleteWorkspacePath(target.root, target.relative);
      if (!removed) throw new Error("Deleting needs the desktop app.");
      setWorkspace(
        state.workspaceName || "Workspace",
        files.filter((file) => file.path !== active && !file.path.startsWith(`${active}/`)),
        state.workspaceRoot,
      );
      close(active);
      notify(`Deleted ${active}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not delete that file", "error");
    }
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
        disk = await writeWorkspacePath(state.workspaceRoot, path, text);
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
      } else if (key === "b" && !event.shiftKey) {
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
    if (!menu) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  useEffect(() => {
    const firstFile = files.find((file) => !file.dir);
    if (!active && firstFile) open(firstFile.path);
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

  const sendAsk = () => {
    const text = askDraft.trim();
    if ((!text && askFiles.length === 0) || streaming) return;
    const files = askFiles;
    onAsk(text, files.length ? files : undefined);
    setAskDraft("");
    setAskFiles([]);
    notify(
      files.length
        ? `Sent to Lantas with ${files.length} file${files.length === 1 ? "" : "s"}`
        : "Sent to Lantas",
    );
  };

  const openInCode = async () => {
    if (!state.workspaceRoot) {
      notify("Open a folder first, then open it in VS Code", "error");
      onOpenFolder();
      return;
    }
    setOpeningCode(true);
    const ok = await openInVsCode(state.workspaceRoot);
    setOpeningCode(false);
    notify(
      ok
        ? `Opened ${state.workspaceName || "the folder"} in VS Code`
        : "VS Code was not found. Install it, or use Open Folder in Lantas.",
      ok ? "default" : "error",
    );
  };

  const pickModel = (provider: ProviderId, model: string) => {
    if (session) {
      updateSession(session.id, (current) => ({ ...current, provider, model }));
    }
    setSettings({ defaultProvider: provider, defaultModel: model });
  };

  const showPanel = (next: Activity) => {
    setActivity(next);
    setSideOpen(true);
  };

  const menus: MenuGroup[] = [
    {
      id: "file",
      label: "File",
      items: [
        { key: "new-file", label: "New File…", kbd: "⌥⌘N", run: () => startEntry("file") },
        { key: "new-folder", label: "New Folder…", run: () => startEntry("folder") },
        { key: "open-folder", label: "Open Folder…", kbd: "⌘O", run: onOpenFolder },
        { key: "file-sep-1", sep: true },
        { key: "save", label: "Save", kbd: "⌘S", run: saveActive, disabled: !active },
        {
          key: "save-all",
          label: "Save All",
          kbd: "⇧⌘S",
          run: () => void saveAll(),
          disabled: dirty.size === 0,
        },
        {
          key: "revert",
          label: "Revert File",
          run: () => active && discard(active),
          disabled: !active || !dirty.has(active),
        },
        { key: "file-sep-2", sep: true },
        {
          key: "close",
          label: "Close Editor",
          kbd: "⌘W",
          run: () => active && close(active),
          disabled: !active,
        },
        { key: "file-sep-3", sep: true },
        {
          key: "vscode",
          label: "Open in VS Code",
          run: () => void openInCode(),
          disabled: !state.workspaceRoot || openingCode,
        },
        { key: "chat", label: "Back to Chat", run: onExit },
      ],
    },
    {
      id: "view",
      label: "View",
      items: [
        { key: "explorer", label: "Explorer", kbd: "⌘B", run: () => showPanel("explorer") },
        { key: "search", label: "Search", kbd: "⇧⌘F", run: () => showPanel("search") },
        { key: "git", label: "Source Control", kbd: "⌃⇧G", run: () => showPanel("git") },
        { key: "ext", label: "Extensions", run: () => showPanel("extensions") },
        { key: "view-sep-1", sep: true },
        {
          key: "assistant",
          label: "Assistant",
          kbd: "⌘J",
          run: () => setAssistantOpen((value) => !value),
        },
        {
          key: "terminal",
          label: "Terminal",
          kbd: "⌃`",
          run: () => setTerminalOpen((value) => !value),
        },
        { key: "view-sep-2", sep: true },
        { key: "quick", label: "Quick Open", kbd: "⌘P", run: () => setQuick("") },
        {
          key: "refresh",
          label: "Refresh Explorer",
          run: () => void refreshFromDisk(),
          disabled: !state.workspaceRoot,
        },
      ],
    },
    {
      id: "go",
      label: "Go",
      items: [
        { key: "go-file", label: "Go to File…", kbd: "⌘P", run: () => setQuick("") },
        {
          key: "go-search",
          label: "Find in Folder…",
          kbd: "⇧⌘F",
          run: () => showPanel("search"),
        },
        { key: "go-sep-1", sep: true },
        {
          key: "go-side",
          label: "Toggle Sidebar",
          kbd: "⌘B",
          run: () => setSideOpen((value) => !value),
        },
        { key: "go-chat", label: "Back to Chat", run: onExit },
      ],
    },
  ];

  // A kept or declined staged file replaces the editor's saved copy. Drop the
  // stale draft so the open tab shows the accepted text instead of an old,
  // falsely "unsaved" buffer that could overwrite the result.
  const clearDrafts = (paths: string[]) => {
    setDrafts((current) => {
      if (!paths.some((path) => path in current)) return current;
      const next = { ...current };
      for (const path of paths) delete next[path];
      return next;
    });
  };

  const keepAll = async () => {
    const paths = staged.map((change) => change.path);
    const written = await keepStaged();
    clearDrafts(paths);
    notify(
      written === staged.length
        ? `Kept ${written} file${written === 1 ? "" : "s"}`
        : `Kept ${staged.length} in the workspace; ${written} written to disk`,
      written === staged.length ? "default" : "error",
    );
  };

  const keepOne = async (path: string) => {
    setReviewBusy(path);
    const ok = await keepChange(path);
    clearDrafts([path]);
    setReviewBusy(null);
    notify(ok ? `Kept ${path}` : `Could not write ${path} to disk`, ok ? "default" : "error");
  };

  const discardOne = (path: string) => {
    discardChange(path);
    clearDrafts([path]);
    notify(`Declined ${path}`);
  };

  const discardAll = () => {
    clearDrafts(staged.map((change) => change.path));
    discardStaged();
    notify("Declined the assistant's changes");
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
      <header className="ide-header">
        <div className="ide-header-left">
          <nav className="ide-menus" aria-label="Editor menu">
            {menus.map((group) => (
              <div className="ide-menu-wrap" key={group.id}>
                <button
                  type="button"
                  className={cx("ide-menu-trigger", menu === group.id && "is-open")}
                  aria-haspopup="menu"
                  aria-expanded={menu === group.id}
                  onClick={() => setMenu((current) => (current === group.id ? null : group.id))}
                >
                  {group.label}
                </button>
                {menu === group.id && (
                  <div className="ide-menu" role="menu">
                    {group.items.map((item) =>
                      item.sep ? (
                        <span key={item.key} className="ide-menu-rule" />
                      ) : (
                        <button
                          key={item.key}
                          type="button"
                          role="menuitem"
                          disabled={item.disabled}
                          onClick={() => {
                            setMenu(null);
                            item.run?.();
                          }}
                        >
                          <span>{item.label}</span>
                          {item.kbd && <kbd>{item.kbd}</kbd>}
                        </button>
                      ),
                    )}
                  </div>
                )}
              </div>
            ))}
          </nav>
        </div>

        <div className="ide-header-center">
          <button
            type="button"
            className="ide-command"
            onClick={() => setQuick("")}
            title="Go to file (⌘P)"
          >
            <Icon name="search" size={13} />
            <span>{state.workspaceName || "Search files by name"}</span>
            <kbd>⌘P</kbd>
          </button>
        </div>

        <div className="ide-header-right">
          <button
            type="button"
            className="ide-icon-button"
            onClick={() => startEntry("file")}
            title="New file"
            aria-label="New file"
          >
            <Icon name="filePlus" size={14} />
          </button>
          <button
            type="button"
            className="ide-icon-button"
            onClick={onOpenFolder}
            title="Open folder"
            aria-label="Open folder"
          >
            <Icon name="folder" size={14} />
          </button>
          <span className="ide-header-rule" />
          <button
            type="button"
            className="ide-icon-button"
            onClick={() => void openInCode()}
            disabled={!state.workspaceRoot || openingCode}
            title="Open this folder in VS Code"
            aria-label="Open in VS Code"
          >
            <Icon name="external" size={14} />
          </button>
          <button type="button" className="ide-header-chat" onClick={onExit}>
            Chat
            <Icon name="chevronRight" size={11} />
          </button>
        </div>
      </header>

      {menu && <div className="ide-menu-scrim" onMouseDown={() => setMenu(null)} />}

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
              {item.id === "git" && (dirty.size > 0 || staged.length > 0) && (
                <span className="ide-rail-badge">{dirty.size + staged.length}</span>
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
                      onClick={() => startEntry("file")}
                      title="New file"
                      aria-label="New file"
                    >
                      <Icon name="filePlus" size={13} />
                    </button>
                    <button
                      type="button"
                      className="ide-icon-button small"
                      onClick={() => startEntry("folder")}
                      title="New folder"
                      aria-label="New folder"
                    >
                      <Icon name="folderPlus" size={13} />
                    </button>
                    <button
                      type="button"
                      className="ide-icon-button small"
                      onClick={() => void refreshFromDisk()}
                      title="Refresh folder"
                      aria-label="Refresh folder"
                    >
                      <Icon name="refresh" size={12} />
                    </button>
                    <button
                      type="button"
                      className="ide-icon-button small"
                      onClick={onAddFolder}
                      title="Add folder"
                      aria-label="Add folder"
                    >
                      <Icon name="folderPlus" size={13} />
                    </button>
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
                <div className="ide-editors">
                  <button
                    type="button"
                    className="ide-section-head"
                    onClick={() => setOpenEditorsOpen((value) => !value)}
                    aria-expanded={openEditorsOpen}
                  >
                    <Icon
                      name="chevronRight"
                      size={12}
                      className={cx("ide-caret", openEditorsOpen && "is-open")}
                    />
                    <span>Open editors</span>
                    <span className="ide-section-count">{tabs.length}</span>
                  </button>
                  {openEditorsOpen && (
                    <div className="ide-open-list">
                      {tabs.map((path) => (
                        <div
                          key={path}
                          className={cx("ide-open-row", active === path && "is-active")}
                        >
                          <button
                            type="button"
                            className="ide-open-name"
                            onClick={() => setActive(path)}
                            title={path}
                          >
                            <span className="ide-file-badge" style={{ color: fileTone(path) }}>
                              {fileInitials(path)}
                            </span>
                            <span className="ide-open-label">
                              {path.split("/").pop() ?? path}
                            </span>
                            {dirty.has(path) && <span className="ide-dirty" aria-label="Unsaved" />}
                          </button>
                          <button
                            type="button"
                            className="ide-open-close"
                            onClick={() => close(path)}
                            aria-label={`Close ${path.split("/").pop() ?? path}`}
                          >
                            <Icon name="close" size={11} />
                          </button>
                        </div>
                      ))}
                      {tabs.length === 0 && (
                        <p className="ide-section-empty">No editors open</p>
                      )}
                    </div>
                  )}
                </div>
                <div className="ide-workspace">
                  <Icon name="chevronRight" size={12} className="ide-caret is-open" />
                  <span className="ide-workspace-name">
                    {state.workspaceName || "No folder open"}
                  </span>
                  <span className="ide-workspace-count">
                    {files.filter((file) => !file.dir).length}
                  </span>
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
                {active && (
                  <div className="ide-explorer-active">
                    <span title={active}>{active}</span>
                    <button
                      type="button"
                      className="ide-git-text"
                      onClick={() => startEntry("rename")}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="ide-git-text is-quiet"
                      onClick={() => void deleteActive()}
                    >
                      Delete
                    </button>
                  </div>
                )}
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
              <GitPanel
                root={state.workspaceRoot}
                activePath={active}
                onOpen={open}
                onOpenFolder={onOpenFolder}
                dirty={dirty}
                onSaveAll={() => void saveAll()}
              />
            )}

            {activity === "extensions" && <ExtensionsPanel />}
          </aside>
        )}

        <main className="ide-main">
          <div className="ide-tabs" role="tablist">
            {tabs.map((path) => {
              const file = files.find((item) => item.path === path);
              return (
                <div
                  key={path}
                  className={cx(
                    "ide-tab",
                    active === path && "is-active",
                    dirty.has(path) && "is-dirty",
                  )}
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
            <div className="ide-tab-actions">
              <button
                type="button"
                className={cx("ide-tab-action", assistantOpen && "is-on")}
                onClick={() => setAssistantOpen((value) => !value)}
                title="Assistant (⌘J)"
                aria-label="Assistant"
              >
                <Icon name="sparkle" size={14} />
              </button>
              <button
                type="button"
                className={cx("ide-tab-action", terminalOpen && "is-on")}
                onClick={() => setTerminalOpen((open) => !open)}
                title="Terminal"
                aria-label="Terminal"
              >
                <Icon name="terminal" size={14} />
              </button>
              <button
                type="button"
                className="ide-tab-action"
                onClick={() => void openInCode()}
                disabled={!state.workspaceRoot || openingCode}
                title="Open this folder in VS Code"
                aria-label="Open in VS Code"
              >
                <Icon name="external" size={14} />
              </button>
            </div>
          </div>

          {staged.length > 0 && (
            <div className="ide-review-bar" role="status">
              <span className="ide-review-label">
                <span className="ide-review-dot" />
                Lantas changed {staged.length} file{staged.length === 1 ? "" : "s"}
              </span>
              <span className="ide-review-files" title={staged.map((change) => change.path).join("\n")}>
                {staged
                  .slice(0, 3)
                  .map((change) => change.path.split("/").pop())
                  .join(", ")}
                {staged.length > 3 ? ` +${staged.length - 3}` : ""}
              </span>
              <span className="ide-review-spacer" />
              <button
                type="button"
                className="ide-review-decline"
                onClick={() => setReviewOpen(true)}
              >
                Review
              </button>
              <button
                type="button"
                className="ide-review-decline"
                onClick={discardAll}
              >
                Decline all
              </button>
              <button type="button" className="ide-review-keep" onClick={() => void keepAll()}>
                Keep changes
              </button>
            </div>
          )}

          {activeFile ? (
            <>
              <div className="ide-crumbs">
                <span className="ide-file-badge" style={{ color: fileTone(activeFile.path) }}>
                  {fileInitials(activeFile.path)}
                </span>
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
                  editor={state.settings.editor}
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
                <p className="ide-welcome-kicker">Code workspace</p>
                <h1>
                  {state.workspaceRoot
                    ? `${state.workspaceName || "This folder"} is open`
                    : "Open a folder to start"}
                </h1>
                <p>
                  {state.workspaceRoot
                    ? "Nothing is open in the editor yet. Create a file here and it is written to the folder on disk, or pick one from the explorer."
                    : "The editor is VS Code's Monaco, running locally. Files are read from the folder you pick, edits save back to it, and Lantas can read the same workspace when you ask."}
                </p>
                <div className="ide-welcome-actions">
                  {state.workspaceRoot && (
                    <>
                      <button
                        type="button"
                        className="button-primary"
                        onClick={() => startEntry("file")}
                      >
                        <Icon name="filePlus" size={14} />
                        New file
                      </button>
                      <button
                        type="button"
                        className="button-quiet"
                        onClick={() => startEntry("folder")}
                      >
                        <Icon name="folderPlus" size={14} />
                        New folder
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className={cx("button-quiet", !state.workspaceRoot && "button-primary")}
                    onClick={onOpenFolder}
                  >
                    <Icon name="folder" size={14} />
                    {state.workspaceRoot ? "Open another folder" : "Open folder"}
                  </button>
                  {files.length > 0 && (
                    <button type="button" className="button-quiet" onClick={() => setQuick("")}>
                      Quick open
                    </button>
                  )}
                  <button
                    type="button"
                    className="button-quiet"
                    onClick={() => void openInCode()}
                    disabled={!state.workspaceRoot || openingCode}
                  >
                    <Icon name="external" size={14} />
                    {openingCode ? "Opening…" : "Open in VS Code"}
                  </button>
                </div>
                <div className="ide-welcome-keys">
                  <span><kbd>⌘P</kbd> quick open</span>
                  <span><kbd>⌘S</kbd> save</span>
                  <span><kbd>⌘J</kbd> assistant</span>
                </div>
              </div>
            </div>
          )}

          {reviewOpen && staged.length > 0 && (
            <StagedDiffReview
              changes={staged}
              busyPath={reviewBusy}
              onKeep={(path) => void keepOne(path)}
              onDiscard={discardOne}
              onClose={() => setReviewOpen(false)}
            />
          )}

          {terminalOpen && (
            <TerminalPanel
              cwd={state.workspaceRoot}
              cliRequest={(cliRequest ?? 0) + cliTick}
              onClose={() => setTerminalOpen(false)}
            />
          )}
        </main>

        {assistantOpen && (
          <aside className="ide-assistant">
            <div className="ide-assistant-head">
              <div className="ide-assistant-id">
                <span className="ide-assistant-title">Assistant</span>
              </div>
              <div className="ide-assistant-head-actions">
                <ModelPicker
                  provider={session?.provider ?? state.settings.defaultProvider}
                  model={session?.model || defaultModel}
                  onPick={pickModel}
                  onConnect={onOpenSettings}
                  className="ide-assistant-model"
                />
                <button
                  type="button"
                  className="ide-icon-button small"
                  onClick={() => {
                    createSession();
                    notify("New thread ready");
                  }}
                  title="New chat"
                  aria-label="New chat"
                >
                  <Icon name="plus" size={13} />
                </button>
                <button
                  type="button"
                  className="ide-icon-button small"
                  onClick={() => setAssistantOpen(false)}
                  aria-label="Close assistant"
                >
                  <Icon name="close" size={13} />
                </button>
              </div>
            </div>

            <Transcript
              session={session}
              compact
              onOpenFile={(path, line) => open(path, line)}
              empty={
                <div className="ide-assistant-empty">
                  <h3>{state.workspaceName ? `Work in ${state.workspaceName}` : "Work in this folder"}</h3>
                  <p>
                    It reads this folder, edits real files, runs commands and links every file it
                    touches. Click a path to open it here.
                  </p>
                  <div className="ide-assistant-suggestions">
                    {[
                      "Summarize this project",
                      "Find the riskiest code",
                      "Fix the failing check",
                    ].map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => {
                          onAsk(item);
                          notify("Sent to Lantas");
                        }}
                      >
                        <Icon name="arrowUp" size={11} />
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              }
            />

            {(() => {
              const mention = /(?:^|\s)@([\w./-]*)$/.exec(askDraft);
              const matches = mention
                ? files
                    .filter((file) => !file.dir && file.path.toLowerCase().includes(mention[1].toLowerCase()))
                    .slice(0, 5)
                : [];
              return matches.length > 0 ? (
                <div className="ide-mention-menu">
                  {matches.map((file) => (
                    <button
                      key={file.path}
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        setAskDraft((current) =>
                          current.replace(/@([\w./-]*)$/, `@${file.path} `),
                        );
                        askRef.current?.focus();
                      }}
                    >
                      <span>{file.name}</span>
                      <small>{file.path}</small>
                    </button>
                  ))}
                </div>
              ) : null;
            })()}

            <div className="ide-assistant-composer">
              {askFiles.length > 0 && (
                <div className="attach-row">
                  {askFiles.map((file) => (
                    <span className={cx("attach-chip", file.kind === "image" && "is-image")} key={file.id}>
                      {file.kind === "image" ? <img src={file.body} alt="" /> : <Icon name="file" size={12} />}
                      <span className="attach-name">{file.name}</span>
                      <button
                        type="button"
                        className="attach-remove"
                        aria-label={`Remove ${file.name}`}
                        onClick={() =>
                          setAskFiles((current) => current.filter((item) => item.id !== file.id))
                        }
                      >
                        <Icon name="close" size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <textarea
                ref={askRef}
                rows={3}
                value={askDraft}
                onChange={(event) => setAskDraft(event.target.value)}
                onPaste={(event) => {
                  const pasted = event.clipboardData?.files;
                  if (pasted?.length) {
                    event.preventDefault();
                    void attachToAsk(pasted);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || !event.shiftKey)) {
                    event.preventDefault();
                    sendAsk();
                  }
                }}
                placeholder="Ask, edit, or @ a file…"
                spellCheck={false}
              />
              <div className="ide-assistant-actions">
                <button
                  type="button"
                  className="ide-context-chip"
                  onClick={() => askFileInput.current?.click()}
                  title="Attach a file or image"
                >
                  <Icon name="paperclip" size={10} />
                  Attach
                </button>
                <input
                  ref={askFileInput}
                  type="file"
                  multiple
                  hidden
                  onChange={(event) => {
                    void attachToAsk(event.target.files);
                    event.target.value = "";
                  }}
                />
                {activeFile && (
                  <button
                    type="button"
                    className="ide-context-chip"
                    onClick={() => setAskDraft((current) => `${current}@${activeFile.path} `)}
                    title="Add the open file to the message"
                  >
                    <Icon name="paperclip" size={10} />
                    {activeFile.name}
                  </button>
                )}
                <span className="ide-assistant-hint">⇧↵ new line</span>
                <button
                  type="button"
                  className="ide-send-button"
                  onClick={streaming ? onStop : sendAsk}
                  disabled={!streaming && !askDraft.trim() && askFiles.length === 0}
                  aria-label={streaming ? "Stop" : "Send"}
                  title={streaming ? "Stop the assistant" : "Send"}
                >
                  <Icon name={streaming ? "stop" : "arrowUp"} size={13} />
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
          <button
            type="button"
            className="ide-status-item is-button"
            onClick={() => showPanel("git")}
            title="Source control"
          >
            <Icon name="branch" size={12} />
            {session?.branch ?? "main"}
          </button>
          {dirty.size > 0 && (
            <span className="ide-status-item">
              <span className="ide-dirty" />
              {dirty.size} unsaved
            </span>
          )}
          <span className="ide-status-item dim">
            {files.filter((file) => !file.dir).length} files
          </span>
        </div>
        <div className="ide-status-right">
          {activeFile && (
            <>
              <span className="ide-status-item">{monacoLanguage(activeFile.path)}</span>
              <span className="ide-status-item">UTF-8</span>
              <span className="ide-status-item">LF</span>
              <span className="ide-status-item">Spaces: 2</span>
              <span className="ide-status-item">{countLines(activeText)} lines</span>
              <span className="ide-status-item">
                Ln {cursor.line}, Col {cursor.column}
              </span>
            </>
          )}
          {!activeFile && <span className="ide-status-item dim">UTF-8</span>}
        </div>
      </footer>

      {dropping && <div className="ide-drop-hint">Drop files to open them in the IDE</div>}

      {entryPrompt && (
        <div className="ide-entry-overlay" onMouseDown={() => setEntryPrompt(null)}>
          <form
            className="ide-entry-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void commitEntry();
            }}
          >
            <div className="ide-entry-head">
              <span>
                {entryPrompt === "file"
                  ? "New file"
                  : entryPrompt === "folder"
                    ? "New folder"
                    : "Rename"}
              </span>
              <button
                type="button"
                className="ide-icon-button small"
                onClick={() => setEntryPrompt(null)}
                aria-label="Close"
              >
                <Icon name="close" size={12} />
              </button>
            </div>
            <label className="ide-entry-field">
              <span>{entryPrompt === "folder" ? "Folder path" : "File path"}</span>
              <input
                ref={entryRef}
                value={entryName}
                onChange={(event) => setEntryName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setEntryPrompt(null);
                }}
                placeholder={
                  entryPrompt === "folder" ? "src/components" : "src/components/Button.tsx"
                }
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <p className="ide-entry-note">
              {state.workspaceRoot
                ? `Inside ${state.workspaceName}`
                : "Open a folder to use the file tree."}
            </p>
            <div className="ide-entry-actions">
              <button
                type="button"
                className="button-quiet small"
                onClick={() => setEntryPrompt(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="button-primary small"
                disabled={!entryName.trim() || entryBusy || !state.workspaceRoot}
              >
                {entryBusy ? "Working…" : entryPrompt === "rename" ? "Rename" : "Create"}
              </button>
            </div>
          </form>
        </div>
      )}

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
