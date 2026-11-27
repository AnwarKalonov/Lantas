import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../lib/store";
import type { Session, Workspace } from "../lib/types";
import { cx, timeAgo } from "../lib/util";
import { Icon } from "./Icons";
import { MarkGlyph } from "./Brand";

interface RowMenu {
  sessionId: string;
  x: number;
  y: number;
}

interface WorkspaceMenu {
  workspaceId: string;
  x: number;
  y: number;
}

export function Sidebar({
  onOpenSettings,
  onAddWorkspace,
  historyCollapsed = false,
}: {
  onOpenSettings: () => void;
  onAddWorkspace: () => void;
  historyCollapsed?: boolean;
}) {
  const {
    state,
    createSession,
    selectSession,
    deleteSession,
    renameSession,
    updateSession,
    selectWorkspace,
    deleteWorkspace,
    updateWorkspace,
    setView,
    setMode,
    setScope,
    notify,
    toggleSidebar,
  } = useStore();
  const [menu, setMenu] = useState<RowMenu | null>(null);
  const [wsMenu, setWsMenu] = useState<WorkspaceMenu | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renamingWs, setRenamingWs] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [pinnedCollapsed, setPinnedCollapsed] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const wsMenuRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const activeWorkspace = state.workspaces.find(
    (workspace) => workspace.id === state.activeWorkspaceId,
  );

  // Ordinary chat and each workspace keep separate histories. The sidebar
  // shows the list that belongs to the scope you are in.
  const surfaceSessions = useMemo(
    () =>
      state.sessions.filter((session) => {
        if ((session.surface ?? "chat") !== state.mode) return false;
        return state.scope === "workspace"
          ? session.workspaceId === state.activeWorkspaceId
          : !session.workspaceId;
      }),
    [state.sessions, state.mode, state.scope, state.activeWorkspaceId],
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
  const recent = useMemo(
    () =>
      matched.filter((session) => !session.pinned).sort((a, b) => b.updated - a.updated),
    [matched],
  );

  useEffect(() => {
    if (!menu && !wsMenu) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
      if (!wsMenuRef.current?.contains(event.target as Node)) setWsMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(null);
        setWsMenu(null);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [menu, wsMenu]);

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
      notify("Chat renamed");
    }
    setRenaming(null);
  };

  const startRenameWorkspace = (workspace: Workspace) => {
    setDraft(workspace.name);
    setRenamingWs(workspace.id);
    setWsMenu(null);
  };

  const commitWorkspaceRename = () => {
    if (renamingWs && draft.trim()) {
      updateWorkspace(renamingWs, { name: draft.trim() });
      notify("Workspace renamed");
    }
    setRenamingWs(null);
  };

  const openSession = (id: string) => {
    setView("chats");
    selectSession(id);
  };

  const togglePin = (id: string) => {
    const session = state.sessions.find((item) => item.id === id);
    const next = !session?.pinned;
    updateSession(id, (current) => ({ ...current, pinned: next }));
    notify(next ? "Chat pinned" : "Chat unpinned");
    setMenu(null);
  };

  const newChat = () => {
    if (state.scope === "workspace" && !activeWorkspace) {
      onAddWorkspace();
      return;
    }
    setView("chats");
    createSession(undefined, undefined, undefined, "chat");
  };

  const renderRow = (session: Session) => {
    const active = session.id === state.activeId && state.view === "chats";
    return (
      <div
        key={session.id}
        className={cx("thread-row ow-thread", active && "is-active", renaming === session.id && "is-editing")}
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
            <span className="thread-time">{timeAgo(session.updated)}</span>
            <button
              type="button"
              className="thread-menu"
              aria-label={`Actions for ${session.title}`}
              onClick={(event) => {
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                setMenu({ sessionId: session.id, x: rect.right, y: rect.bottom + 6 });
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
    <aside className={cx("sidebar ow-sidebar", historyCollapsed && "is-collapsed")}>
      <div className="ow-side-head">
        <button
          type="button"
          className="ow-brand"
          onClick={() => setScope("chat")}
          title="Lantas"
        >
          <MarkGlyph size={17} />
          <span>Lantas</span>
        </button>
        <span className="ow-side-head-actions">
          <button
            type="button"
            className="icon-button"
            onClick={newChat}
            title="New chat (⌘N)"
            aria-label="New chat"
          >
            <Icon name="plus" size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={toggleSidebar}
            title="Collapse sidebar (⌘B)"
            aria-label="Collapse sidebar"
          >
            <Icon name="panelLeft" size={15} />
          </button>
        </span>
      </div>

      <label className="ow-search">
        <Icon name="search" size={14} />
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setQuery("");
          }}
          placeholder="Search sessions"
          aria-label="Search sessions"
          spellCheck={false}
        />
        {query ? (
          <button
            type="button"
            className="ow-search-clear"
            onClick={() => setQuery("")}
            aria-label="Clear search"
          >
            <Icon name="close" size={12} />
          </button>
        ) : (
          <kbd>⌘F</kbd>
        )}
      </label>

      <div className="ow-side-scroll">
        <section className="ow-side-section">
          <div className="ow-side-label">
            <span>Workspaces</span>
            <button
              type="button"
              className="ow-label-action"
              onClick={onAddWorkspace}
              title="New workspace"
              aria-label="New workspace"
            >
              <Icon name="plus" size={13} />
            </button>
          </div>

          {state.workspaces.length === 0 && (
            <button type="button" className="ow-ws-row is-empty" onClick={onAddWorkspace}>
              <span className="ow-ws-plus">
                <Icon name="plus" size={13} />
              </span>
              <span className="ow-ws-name">Add a project folder</span>
            </button>
          )}

          {state.workspaces.map((workspace) => {
            const count = state.sessions.filter(
              (session) => session.workspaceId === workspace.id,
            ).length;
            const active =
              workspace.id === state.activeWorkspaceId && state.scope === "workspace";
            return (
              <div
                key={workspace.id}
                className={cx("ow-ws-row", active && "is-active")}
                role="button"
                tabIndex={0}
                onClick={() => selectWorkspace(workspace.id)}
                onDoubleClick={() => startRenameWorkspace(workspace)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") selectWorkspace(workspace.id);
                }}
              >
                <span className="ow-ws-dot" style={{ background: workspace.color }} />
                {renamingWs === workspace.id ? (
                  <input
                    className="ow-ws-rename"
                    value={draft}
                    autoFocus
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={commitWorkspaceRename}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") commitWorkspaceRename();
                      if (event.key === "Escape") setRenamingWs(null);
                    }}
                  />
                ) : (
                  <span className="ow-ws-name" title={workspace.root || workspace.name}>
                    {workspace.name}
                  </span>
                )}
                {count > 0 && <span className="ow-ws-count">{count}</span>}
                <button
                  type="button"
                  className="ow-ws-menu"
                  aria-label={`Actions for ${workspace.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    const rect = event.currentTarget.getBoundingClientRect();
                    setWsMenu({ workspaceId: workspace.id, x: rect.right, y: rect.bottom + 4 });
                  }}
                >
                  <Icon name="more" size={13} />
                </button>
              </div>
            );
          })}

          <button type="button" className="ow-add-workspace" onClick={onAddWorkspace}>
            <Icon name="plus" size={13} />
            Add workspace
          </button>
        </section>

        {state.scope === "workspace" && (
          <section className="ow-side-section ow-chat-section">
            <div className="ow-side-label">
              <span>{activeWorkspace ? `Chats in ${activeWorkspace.name}` : "Chats"}</span>
              {activeWorkspace && (
                <button
                  type="button"
                  className="ow-label-action"
                  onClick={newChat}
                  title="New chat"
                  aria-label="New chat"
                >
                  <Icon name="plus" size={13} />
                </button>
              )}
            </div>

            {!activeWorkspace ? (
              <p className="ow-side-empty">Choose a workspace above, or add a folder to start.</p>
            ) : matched.length === 0 ? (
              <div className="ow-side-empty">
                <p>{wanted ? `No chat matches “${query.trim()}”` : "No chats in this workspace yet."}</p>
                {!wanted && (
                  <button className="text-button" onClick={newChat} type="button">
                    Start the first one
                  </button>
                )}
              </div>
            ) : (
              <div className="ow-thread-list">
                {pinned.length > 0 && (
                  <>
                    <button
                      type="button"
                      className="ow-pinned-toggle"
                      onClick={() => setPinnedCollapsed((value) => !value)}
                    >
                      <Icon
                        name="chevronDown"
                        size={11}
                        className={cx(pinnedCollapsed && "is-closed")}
                      />
                      Pinned
                    </button>
                    {!pinnedCollapsed && pinned.map(renderRow)}
                  </>
                )}
                {recent.map(renderRow)}
              </div>
            )}
          </section>
        )}

        {state.scope === "chat" && (
          <section className="ow-side-section ow-chat-section">
            <div className="ow-side-label">
              <span>Chats</span>
            </div>
            {matched.length === 0 ? (
              <div className="ow-side-empty">
                <p>{wanted ? `No chat matches “${query.trim()}”` : "No chats yet."}</p>
                {!wanted && (
                  <button className="text-button" onClick={newChat} type="button">
                    Start one
                  </button>
                )}
              </div>
            ) : (
              <div className="ow-thread-list">
                {pinned.length > 0 && (
                  <>
                    <button
                      type="button"
                      className="ow-pinned-toggle"
                      onClick={() => setPinnedCollapsed((value) => !value)}
                    >
                      <Icon
                        name="chevronDown"
                        size={11}
                        className={cx(pinnedCollapsed && "is-closed")}
                      />
                      Pinned
                    </button>
                    {!pinnedCollapsed && pinned.map(renderRow)}
                  </>
                )}
                {recent.map(renderRow)}
              </div>
            )}
          </section>
        )}
      </div>

      <div className="ow-side-foot">
        <button
          type="button"
          className="ow-foot-row"
          onClick={() => {
            setMode("chat");
            setView("skills");
          }}
        >
          <Icon name="book" size={14} />
          Skills
        </button>
        <button
          type="button"
          className="ow-foot-row"
          onClick={() => {
            setMode("chat");
            setView("integrations");
          }}
        >
          <Icon name="plug" size={14} />
          Integrations
        </button>
        <button type="button" className="ow-foot-row" onClick={onOpenSettings}>
          <Icon name="settings" size={14} />
          Settings
        </button>
      </div>

      {menu && (
        <div
          className="row-menu ow-row-menu"
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
            {state.sessions.find((item) => item.id === menu.sessionId)?.pinned ? "Unpin" : "Pin"}
          </button>
          <button type="button" onClick={() => startRename(menu.sessionId)}>
            <Icon name="file" size={14} /> Rename
          </button>
          <button
            type="button"
            onClick={() => {
              const session = state.sessions.find((item) => item.id === menu.sessionId);
              if (session) navigator.clipboard?.writeText(session.id).catch(() => {});
              notify("Chat ID copied");
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
              notify("Chat deleted");
            }}
          >
            <Icon name="trash" size={14} /> Delete
          </button>
        </div>
      )}

      {wsMenu && (
        <div
          className="row-menu ow-row-menu"
          ref={wsMenuRef}
          style={{ top: wsMenu.y, left: Math.min(wsMenu.x - 168, window.innerWidth - 184) }}
        >
          <button
            type="button"
            onClick={() => {
              const workspace = state.workspaces.find((item) => item.id === wsMenu.workspaceId);
              if (workspace) startRenameWorkspace(workspace);
            }}
          >
            <Icon name="pencil" size={14} /> Rename
          </button>
          <button
            type="button"
            onClick={() => {
              const workspace = state.workspaces.find((item) => item.id === wsMenu.workspaceId);
              if (workspace) navigator.clipboard?.writeText(workspace.root).catch(() => {});
              notify("Workspace path copied");
              setWsMenu(null);
            }}
          >
            <Icon name="copy" size={14} /> Copy path
          </button>
          <div className="row-menu-sep" />
          <button
            className="danger"
            type="button"
            onClick={() => {
              const workspace = state.workspaces.find((item) => item.id === wsMenu.workspaceId);
              deleteWorkspace(wsMenu.workspaceId);
              setWsMenu(null);
              notify(`${workspace?.name ?? "Workspace"} removed — files stay on disk`);
            }}
          >
            <Icon name="trash" size={14} /> Remove workspace
          </button>
        </div>
      )}
    </aside>
  );
}
