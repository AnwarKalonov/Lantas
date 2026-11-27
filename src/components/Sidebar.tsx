import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { PROVIDERS } from "../lib/data";
import { isConfigured, prettyModel } from "../lib/providers";
import type { Session } from "../lib/types";
import { cx, timeAgo } from "../lib/util";
import { Icon, type IconName } from "./Icons";

interface RowMenu {
  sessionId: string;
  x: number;
  y: number;
}

const NAV: Array<{ id: "chats" | "skills" | "integrations"; label: string; icon: IconName }> = [
  { id: "chats", label: "Threads", icon: "message" },
  { id: "skills", label: "Skills", icon: "book" },
  { id: "integrations", label: "Integrations", icon: "plug" },
];

function projectName(cwd: string) {
  const parts = cwd.split("/").filter((part) => part && part !== "~" && part !== ".");
  const last = parts[parts.length - 1] ?? "Workspace";
  return last.charAt(0).toUpperCase() + last.slice(1);
}

function folderLabel(root: string) {
  if (!root) return "Choose a project folder";
  return root.replace(/^\/Users\/[^/]+/, "~");
}

export function Sidebar({
  onOpenSettings,
  onOpenFolder,
  onAddFolder,
  historyCollapsed = false,
}: {
  onOpenSettings: () => void;
  onOpenFolder: () => void;
  onAddFolder: () => void;
  historyCollapsed?: boolean;
}) {
  const {
    state,
    createSession,
    selectSession,
    deleteSession,
    renameSession,
    updateSession,
    setView,
    setMode,
    notify,
    toggleSidebar,
  } = useStore();
  const [menu, setMenu] = useState<RowMenu | null>(null);
  const [workspaceMenu, setWorkspaceMenu] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const menuRef = useRef<HTMLDivElement | null>(null);
  const workspaceMenuRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Chat, browser and code keep separate thread lists; the sidebar shows the
  // ones that belong to the surface you are in.
  const surfaceSessions = useMemo(
    () => state.sessions.filter((session) => (session.surface ?? "chat") === state.mode),
    [state.sessions, state.mode],
  );

  const wanted = query.trim().toLowerCase();
  const matched = useMemo(
    () =>
      wanted
        ? surfaceSessions.filter(
            (session) =>
              session.title.toLowerCase().includes(wanted) ||
              (session.cwd ?? "").toLowerCase().includes(wanted),
          )
        : surfaceSessions,
    [surfaceSessions, wanted],
  );

  const pinned = useMemo(
    () => matched.filter((session) => session.pinned).sort((a, b) => b.updated - a.updated),
    [matched],
  );

  const projects = useMemo(() => {
    const map = new Map<string, Session[]>();
    matched
      .filter((session) => !session.pinned)
      .forEach((session) => {
        const key = session.cwd || "~/dev/lantas";
        map.set(key, [...(map.get(key) ?? []), session]);
      });
    return Array.from(map.entries())
      .map(([cwd, items]) => ({
        cwd,
        label: projectName(cwd),
        items: [...items].sort((a, b) => b.updated - a.updated),
      }))
      .sort((a, b) => (b.items[0]?.updated ?? 0) - (a.items[0]?.updated ?? 0));
  }, [matched]);

  const provider = state.settings.defaultProvider;
  const providerMeta = PROVIDERS.find((item) => item.id === provider);
  const connected = isConfigured(provider, state.settings.providers[provider]);

  useEffect(() => {
    if (!workspaceMenu) return;
    const close = (event: MouseEvent) => {
      if (!workspaceMenuRef.current?.contains(event.target as Node)) setWorkspaceMenu(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setWorkspaceMenu(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [workspaceMenu]);

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [menu]);

  // ⌘F inside the thread view focuses this field instead of the browser's
  // find bar, which cannot search threads.
  useEffect(() => {
    if (historyCollapsed) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "f") return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [historyCollapsed]);

  const startRename = (id: string) => {
    const session = state.sessions.find((item) => item.id === id);
    if (!session) return;
    setDraft(session.title);
    setRenaming(id);
    setMenu(null);
  };

  const commitRename = () => {
    if (renaming && draft.trim()) {
      renameSession(renaming, draft);
      notify("Thread renamed");
    }
    setRenaming(null);
  };

  const openSession = (id: string) => {
    setView("chats");
    selectSession(id);
  };

  const togglePin = (id: string) => {
    const session = state.sessions.find((item) => item.id === id);
    const next = !session?.pinned;
    updateSession(id, (current) => ({ ...current, pinned: next }));
    notify(next ? "Thread pinned" : "Thread unpinned");
    setMenu(null);
  };

  const renderRow = (session: Session) => {
    const available = isConfigured(session.provider, state.settings.providers[session.provider]);
    const active = session.id === state.activeId && state.view === "chats";
    return (
      <div
        key={session.id}
        className={cx(
          "thread-row",
          active && "is-active",
          renaming === session.id && "is-editing",
        )}
        onClick={() => openSession(session.id)}
        onDoubleClick={() => startRename(session.id)}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter") openSession(session.id);
        }}
      >
        {renaming === session.id ? (
          <input
            className="thread-rename"
            value={draft}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitRename();
              if (event.key === "Escape") setRenaming(null);
            }}
            onClick={(event) => event.stopPropagation()}
          />
        ) : (
          <>
            <span className="thread-title" title={session.title}>
              {session.title}
            </span>
            {!available && <span className="thread-dot" title="Provider not connected" />}
            <span className="thread-time">{timeAgo(session.updated)}</span>
            <button
              type="button"
              className="thread-menu"
              aria-label={`Actions for ${session.title}`}
              onClick={(event) => {
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                setMenu({
                  sessionId: session.id,
                  x: rect.right,
                  y: rect.bottom + 6,
                });
              }}
            >
              <Icon name="more" size={14} />
            </button>
          </>
        )}
      </div>
    );
  };

  return (
    <aside className={cx("sidebar shell-nav", historyCollapsed && "is-collapsed")}>
      <div className="rail">
        <button
          type="button"
          className={cx("rail-button rail-collapse", historyCollapsed && "is-flipped")}
          onClick={toggleSidebar}
          aria-label={historyCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={historyCollapsed ? "Expand sidebar (⌘B)" : "Collapse history (⌘B)"}
        >
          <Icon name="panelLeft" size={16} />
        </button>

        <button
          type="button"
          className="rail-button"
          onClick={() => createSession()}
          title="New thread (⌘N)"
          aria-label="New thread"
        >
          <Icon name="plus" size={16} />
        </button>

        <div className="rail-group">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cx("rail-button", state.view === item.id && "is-active")}
              onClick={() => {
                setMode("chat");
                setView(item.id);
              }}
              title={item.label}
              aria-label={item.label}
            >
              <Icon name={item.icon} size={16} />
            </button>
          ))}
        </div>

        <span className="rail-spacer" />

        <button
          type="button"
          className="rail-button"
          onClick={() => window.dispatchEvent(new CustomEvent("lantas:compare"))}
          title="Compare two models"
          aria-label="Compare two models"
        >
          <Icon name="diff" size={16} />
        </button>

        <button
          type="button"
          className="rail-button"
          onClick={onOpenSettings}
          title="Settings (⌘,)"
          aria-label="Settings"
        >
          <Icon name="settings" size={16} />
        </button>
      </div>

      <div
        className={cx("nav-panel", historyCollapsed && "is-collapsed")}
        inert={historyCollapsed ? true : undefined}
        aria-hidden={historyCollapsed}
      >
        <div className="nav-workspace" ref={workspaceMenuRef}>
          <button
            type="button"
            className={cx("workspace-switch", !state.workspaceRoot && "is-empty")}
            onClick={() => setWorkspaceMenu((open) => !open)}
            aria-expanded={workspaceMenu}
            aria-haspopup="menu"
          >
            <span className="workspace-switch-icon">
              <Icon name="folder" size={14} />
            </span>
            <span className="workspace-switch-copy">
              <span className="workspace-switch-name">
                {state.workspaceName || "Open a folder"}
              </span>
              <span className="workspace-switch-path">
                {folderLabel(state.workspaceRoot)}
              </span>
            </span>
            <Icon name="chevronDown" size={12} className="workspace-switch-caret" />
          </button>

          {workspaceMenu && (
            <div className="workspace-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setWorkspaceMenu(false);
                  onOpenFolder();
                }}
              >
                <Icon name="folder" size={14} />
                <span>Open folder…</span>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!state.workspaceRoot}
                onClick={() => {
                  setWorkspaceMenu(false);
                  onAddFolder();
                }}
              >
                <Icon name="folderPlus" size={14} />
                <span>Add folder…</span>
              </button>
              <div className="workspace-menu-sep" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setWorkspaceMenu(false);
                  onOpenSettings();
                }}
              >
                <Icon name="settings" size={14} />
                <span>Permissions and settings</span>
              </button>
            </div>
          )}
        </div>

        <div className="nav-panel-head">
            <label className="nav-search">
            <Icon name="search" size={13} />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setQuery("");
              }}
              placeholder="Search"
              aria-label="Search threads"
              spellCheck={false}
            />
            {query ? (
              <button
                type="button"
                className="nav-search-clear"
                onClick={() => setQuery("")}
                aria-label="Clear search"
              >
                <Icon name="close" size={12} />
              </button>
            ) : null}
          </label>
          <button
            type="button"
            className="nav-new"
            onClick={() => createSession()}
            title="New thread (⌘N)"
            aria-label="New thread"
          >
            <Icon name="plus" size={14} />
          </button>
        </div>

        <div className="nav-scroll">
          {pinned.length > 0 && (
            <section className="project nav-pinned">
              <div className="nav-section-label">
                <Icon name="pin" size={14} />
                <span>Pinned</span>
                <span className="project-count">{pinned.length}</span>
              </div>
              <div className="thread-rows">{pinned.map(renderRow)}</div>
            </section>
          )}

          {projects.map((project) => {
            const open = !collapsed[project.cwd];
            return (
              <section className="project" key={project.cwd}>
                <button
                  type="button"
                  className="project-head"
                  onClick={() =>
                    setCollapsed((prev) => ({ ...prev, [project.cwd]: open }))
                  }
                  aria-expanded={open}
                >
                  <Icon
                    name="chevronDown"
                    size={12}
                    className={cx("project-caret", !open && "is-closed")}
                  />
                  <span className="project-name">{project.label}</span>
                  <span className="project-count">{project.items.length}</span>
                </button>

                {open && (
                  <div className="project-body">
                    <div className="thread-rows">{project.items.map(renderRow)}</div>
                  </div>
                )}
              </section>
            );
          })}

          {matched.length === 0 && (
            <div className="nav-empty">
              {wanted ? (
                <p>No thread matches “{query.trim()}”</p>
              ) : (
                <>
                  <p>
                    {state.mode === "browser"
                      ? "No browser threads yet"
                      : state.mode === "code"
                        ? "No code threads yet"
                        : "No threads yet"}
                  </p>
                  <button className="text-button" onClick={() => createSession()} type="button">
                    Start one
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="nav-panel-foot">
          <button type="button" className="nav-status" onClick={onOpenSettings}>
            <span className={cx("status-dot", connected ? "is-ok" : "is-idle")} aria-hidden="true" />
            <span className="nav-status-text">
              <span className="nav-status-title">
                {connected ? providerMeta?.name ?? "Model" : "No provider connected"}
              </span>
              <span className="nav-status-sub">
                {connected
                  ? prettyModel(state.settings.defaultModel)
                  : "Connect one in Settings"}
              </span>
            </span>
          </button>
        </div>
      </div>

      {menu && (
        <div
          className="row-menu"
          ref={menuRef}
          style={{ top: menu.y, left: Math.min(menu.x - 168, window.innerWidth - 184) }}
        >
          <button
            type="button"
            onClick={() => {
              openSession(menu.sessionId);
              setMenu(null);
            }}
          >
            <Icon name="message" size={14} /> Open
          </button>
          <button type="button" onClick={() => togglePin(menu.sessionId)}>
            <Icon name="pin" size={14} />
            {state.sessions.find((item) => item.id === menu.sessionId)?.pinned
              ? "Unpin"
              : "Pin"}
          </button>
          <button type="button" onClick={() => startRename(menu.sessionId)}>
            <Icon name="file" size={14} /> Rename
          </button>
          <button
            type="button"
            onClick={() => {
              const session = state.sessions.find((item) => item.id === menu.sessionId);
              if (session) navigator.clipboard?.writeText(session.id).catch(() => {});
              notify("Thread ID copied");
              setMenu(null);
            }}
          >
            <Icon name="copy" size={14} /> Copy ID
          </button>
          <div className="row-menu-sep" />
          <button
            className="danger"
            type="button"
            onClick={() => {
              deleteSession(menu.sessionId);
              setMenu(null);
              notify("Thread deleted");
            }}
          >
            <Icon name="trash" size={14} /> Delete
          </button>
        </div>
      )}
    </aside>
  );
}
