import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { isConfigured } from "../lib/providers";
import type { Session } from "../lib/types";
import { cx, timeAgo } from "../lib/util";
import { MarkGlyph, Wordmark } from "./Brand";
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

export function Sidebar({
  onOpenSettings,
  historyCollapsed = false,
}: {
  onOpenSettings: () => void;
  historyCollapsed?: boolean;
}) {
  const {
    state,
    createSession,
    selectSession,
    deleteSession,
    renameSession,
    setView,
    setMode,
    notify,
    toggleSidebar,
  } = useStore();
  const [menu, setMenu] = useState<RowMenu | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Chat, browser and code keep separate thread lists; the sidebar shows the
  // ones that belong to the surface you are in.
  const surfaceSessions = useMemo(
    () => state.sessions.filter((session) => (session.surface ?? "chat") === state.mode),
    [state.sessions, state.mode],
  );

  const projects = useMemo(() => {
    const map = new Map<string, Session[]>();
    surfaceSessions.forEach((session) => {
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
  }, [surfaceSessions]);

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
          <Icon name="plus" size={17} />
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
              <Icon name={item.icon} size={17} />
            </button>
          ))}
        </div>

        <span className="rail-spacer" />

        <button
          type="button"
          className="rail-button"
          onClick={() => {
            setMode("chat");
            setView("skills");
          }}
          title="Skills"
          aria-label="Skills"
        >
          <Icon name="sparkle" size={16} />
        </button>
        <button
          type="button"
          className="rail-button"
          onClick={onOpenSettings}
          title="Settings (⌘,)"
          aria-label="Settings"
        >
          <Icon name="settings" size={17} />
        </button>
      </div>

      <div
        className={cx("nav-panel", historyCollapsed && "is-collapsed")}
        inert={historyCollapsed ? true : undefined}
        aria-hidden={historyCollapsed}
      >
        <div className="nav-panel-head">
          <div className="nav-panel-brand">
            <MarkGlyph size={17} className="nav-panel-mark" />
            <Wordmark cell={3} className="nav-wordmark" />
          </div>
          <h1 className="nav-heading-label">Threads</h1>
        </div>

        <div className="nav-scroll">
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
                >
                  <Icon name="folder" size={14} />
                  <span className="project-name">{project.label}</span>
                  <Icon
                    name="chevronDown"
                    size={13}
                    className={cx("project-caret", !open && "is-closed")}
                  />
                </button>

                {open && (
                  <div className="project-body">
                    <button
                      type="button"
                      className="new-thread"
                      onClick={() => createSession()}
                    >
                      <Icon name="plus" size={13} />
                      New thread
                    </button>

                    <div className="thread-rows">
                      {project.items.map((session) => {
                        const available = isConfigured(
                          session.provider,
                          state.settings.providers[session.provider],
                        );
                        const active =
                          session.id === state.activeId && state.view === "chats";
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
                            <span className="thread-mark" aria-hidden="true">
                              <Icon name="message" size={13} />
                            </span>
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
                                <span className="thread-title">{session.title}</span>
                                {!available && <span className="thread-dot" title="Provider not connected" />}
                                <span className="thread-time">{timeAgo(session.updated)}</span>
                                <button
                                  type="button"
                                  className="thread-menu"
                                  aria-label="Thread actions"
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
                      })}
                    </div>
                  </div>
                )}
              </section>
            );
          })}

          {surfaceSessions.length === 0 && (
            <div className="nav-empty">
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
            </div>
          )}
        </div>

        <div className="nav-panel-foot">
          <button className="nav-foot-row" type="button" onClick={onOpenSettings}>
            <Icon name="settings" size={15} />
            <span>Settings</span>
            <kbd>⌘,</kbd>
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
