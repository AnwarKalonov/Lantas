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
  { id: "chats", label: "Chats", icon: "message" },
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
  onNewProject,
  onOpenProject,
  historyCollapsed = false,
}: {
  onOpenSettings: () => void;
  /** Pick a folder and make it a new project. */
  onNewProject: () => void;
  /** Make this project's folder the active workspace. */
  onOpenProject: (root: string) => void;
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
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [projectsOpen, setProjectsOpen] = useState(true);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Chats holds every conversation that is not tied to a project, including
  // browser threads — clicking one opens the Browser surface. Code threads
  // live in the editor, not here.
  const surfaceSessions = useMemo(
    () => state.sessions.filter((session) => (session.surface ?? "chat") !== "code"),
    [state.sessions],
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
    () =>
      matched
        .filter((session) => session.pinned && !session.project)
        .sort((a, b) => b.updated - a.updated),
    [matched],
  );

  const chats = useMemo(
    () =>
      matched
        .filter((session) => !session.pinned && !session.project)
        .sort((a, b) => b.updated - a.updated),
    [matched],
  );

  // A project is its folder. Explicit projects appear even before a thread
  // exists, and a thread's project from an older build still gets a row.
  const projects = useMemo(() => {
    const map = new Map<
      string,
      { root: string; name: string; created: number; items: Session[] }
    >();
    state.projects.forEach((project) => {
      map.set(project.root, {
        root: project.root,
        name: project.name || projectName(project.root),
        created: project.created,
        items: [],
      });
    });
    matched
      .filter((session) => session.project)
      .forEach((session) => {
        const key = session.project as string;
        const entry = map.get(key) ?? {
          root: key,
          name: projectName(key),
          created: session.created,
          items: [],
        };
        entry.items.push(session);
        map.set(key, entry);
      });
    return Array.from(map.values())
      .map((project) => ({
        ...project,
        items: [...project.items].sort((a, b) => b.updated - a.updated),
      }))
      .filter(
        (project) =>
          !wanted ||
          project.name.toLowerCase().includes(wanted) ||
          project.root.toLowerCase().includes(wanted) ||
          project.items.length > 0,
      )
      .sort(
        (a, b) =>
          (b.items[0]?.updated ?? b.created) - (a.items[0]?.updated ?? a.created),
      );
  }, [matched, state.projects, wanted]);

  const provider = state.settings.defaultProvider;
  const providerMeta = PROVIDERS.find((item) => item.id === provider);
  const connected = isConfigured(provider, state.settings.providers[provider]);

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
    // A comparison is a view of one thread; opening any thread leaves it.
    window.dispatchEvent(new CustomEvent("lantas:compare-exit"));
    setView("chats");
    selectSession(id);
  };

  const newProjectThread = (folder: string, items: Session[] = []) => {
    // Opening a project row resumes its latest thread; the + always starts a
    // fresh one. Either way the project's folder becomes the build target.
    onOpenProject(folder);
    if (items.length === 0) {
      const id = createSession(undefined, undefined, undefined, {
        project: folder,
        surface: "chat",
      });
      window.dispatchEvent(new CustomEvent("lantas:compare-exit"));
      setView("chats");
      selectSession(id);
      return;
    }
    openSession(items[0].id);
  };

  const openNewProjectThread = (folder: string) => {
    onOpenProject(folder);
    const id = createSession(undefined, undefined, undefined, {
      project: folder,
      surface: "chat",
    });
    window.dispatchEvent(new CustomEvent("lantas:compare-exit"));
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
        onClick={() => {
          if (session.project) onOpenProject(session.project);
          openSession(session.id);
        }}
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
            {session.surface === "browser" && (
              <span className="thread-surface" title="Browser chat" aria-label="Browser chat">
                <Icon name="compass" size={11} />
              </span>
            )}
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

          <section className={cx("nav-part nav-chats", !projectsOpen && "is-last")}>
            <div className="nav-section-label nav-part-head">
              <Icon name="message" size={13} />
              <span>Chats</span>
              <span className="project-count">{chats.length}</span>
            </div>
            <div className="thread-rows">{chats.map(renderRow)}</div>
          </section>

          <section className={cx("nav-part nav-projects", projectsOpen && "is-open")}>
            <div className="nav-part-head nav-projects-head">
              <button
                type="button"
                className="nav-projects-toggle"
                onClick={() => setProjectsOpen((open) => !open)}
                aria-expanded={projectsOpen}
                aria-controls="nav-projects-body"
              >
                <Icon name="folder" size={13} />
                <span>Projects</span>
                <span className="project-count">{projects.length}</span>
                <Icon
                  name="chevronDown"
                  size={12}
                  className={cx("nav-projects-caret", projectsOpen && "is-open")}
                />
              </button>
              <button
                type="button"
                className="nav-project-add"
                onClick={onNewProject}
                title="New project — choose its folder"
                aria-label="New project"
              >
                <Icon name="plus" size={13} />
              </button>
            </div>

            {projectsOpen && (
              <div className="nav-projects-body" id="nav-projects-body">
                {projects.map((project) => {
                  const open = !collapsed[project.root];
                  return (
                    <div className="nav-project" key={project.root}>
                      <div className={cx("project-head", "project-head-row")}>
                        <button
                          type="button"
                          className="project-toggle"
                          onClick={() =>
                            setCollapsed((prev) => ({ ...prev, [project.root]: open }))
                          }
                          aria-expanded={open}
                          aria-label={`${open ? "Collapse" : "Expand"} ${project.name}`}
                        >
                          <Icon
                            name="chevronDown"
                            size={12}
                            className={cx("project-caret", !open && "is-closed")}
                          />
                        </button>
                        <button
                          type="button"
                          className="project-open"
                          onClick={() => newProjectThread(project.root, project.items)}
                          title={project.root}
                        >
                          <Icon name="folder" size={12} className="nav-project-folder" />
                          <span className="project-name">{project.name}</span>
                          <span className="project-count">{project.items.length}</span>
                        </button>
                        <button
                          type="button"
                          className="project-new"
                          title={`New chat in ${project.name}`}
                          aria-label={`New chat in ${project.name}`}
                          onClick={() => openNewProjectThread(project.root)}
                        >
                          <Icon name="plus" size={12} />
                        </button>
                      </div>

                      {open && project.items.length > 0 && (
                        <div className="project-body">
                          <div className="thread-rows">{project.items.map(renderRow)}</div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {projects.length === 0 && (
                  <div className="nav-projects-empty">
                    <p>Each project is a folder you build in.</p>
                    <button type="button" className="text-button" onClick={onNewProject}>
                      New project
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>

          {matched.length === 0 && (
            <div className="nav-empty">
              {wanted ? (
                <p>No chat matches “{query.trim()}”</p>
              ) : (
                <>
                  <p>
                    {state.mode === "browser"
                      ? "No browser chats yet"
                      : state.mode === "code"
                        ? "No code chats yet"
                        : "No chats yet"}
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
