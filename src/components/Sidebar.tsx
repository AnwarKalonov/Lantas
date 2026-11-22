import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { AGENTS } from "../lib/data";
import { isConfigured, prettyModel } from "../lib/providers";
import { cx, groupSessions, timeAgo } from "../lib/util";
import { Wordmark } from "./Brand";
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

export function Sidebar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const {
    state,
    createSession,
    selectSession,
    deleteSession,
    renameSession,
    setView,
    notify,
  } = useStore();
  const [menu, setMenu] = useState<RowMenu | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);

  const groups = useMemo(() => groupSessions(state.sessions), [state.sessions]);
  const skillsOn = state.skills.filter((skill) => skill.enabled).length;
  const mcpOn = state.mcpServers.filter((server) => server.enabled).length;

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
      notify("Session renamed");
    }
    setRenaming(null);
  };

  const openSession = (id: string) => {
    setView("chats");
    selectSession(id);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand">
          <Wordmark cell={2} />
          <span className="brand-version">0.1.0</span>
        </div>

        <button className="button-primary new-session" onClick={() => createSession()} type="button">
          <Icon name="plus" size={14} />
          New session
          <kbd>⌘N</kbd>
        </button>

        <nav className="sidebar-nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cx("nav-row", state.view === item.id && "is-active")}
              onClick={() => setView(item.id)}
            >
              <Icon name={item.icon} size={15} />
              <span>{item.label}</span>
              {item.id === "skills" && <span className="nav-count">{skillsOn}</span>}
              {item.id === "integrations" && <span className="nav-count">{mcpOn}</span>}
            </button>
          ))}
        </nav>
      </div>

      <div className="sidebar-scroll">
        {groups.map((group) => (
          <section className="session-group" key={group.label}>
            <div className="group-label">
              <span>{group.label}</span>
              <span className="group-count">{group.items.length}</span>
            </div>
            <div className="group-rows">
              {group.items.map((session) => {
                const agent = AGENTS.find((item) => item.id === session.agent);
                const available = isConfigured(session.provider, state.settings.providers[session.provider]);
                return (
                  <div
                    key={session.id}
                    className={cx(
                      "session-row",
                      session.id === state.activeId && state.view === "chats" && "is-active",
                    )}
                    onClick={() => openSession(session.id)}
                    onDoubleClick={() => startRename(session.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") openSession(session.id);
                    }}
                  >
                    <div className="session-row-main">
                      {renaming === session.id ? (
                        <input
                          className="rename-input"
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
                        <div className="session-title">{session.title}</div>
                      )}
                      <div className="session-meta">
                        <span>{prettyModel(session.model)}</span>
                        <span className="meta-dot">·</span>
                        <span>{agent?.name}</span>
                        <span className="meta-dot">·</span>
                        <span>{timeAgo(session.updated)}</span>
                        {!available && <span className="session-flag">demo</span>}
                      </div>
                    </div>
                    <button
                      className="row-menu-button"
                      aria-label="Session actions"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        const rect = event.currentTarget.getBoundingClientRect();
                        setMenu({ sessionId: session.id, x: rect.right, y: rect.bottom + 4 });
                      }}
                    >
                      <Icon name="more" size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        {state.sessions.length === 0 && (
          <div className="sidebar-empty">
            <p>No sessions yet</p>
            <button className="text-button" onClick={() => createSession()} type="button">
              Start one
            </button>
          </div>
        )}
      </div>

      <div className="sidebar-foot">
        <button className="foot-row" type="button" onClick={onOpenSettings}>
          <Icon name="settings" size={15} />
          <span>Settings</span>
          <kbd>⌘,</kbd>
        </button>
        <div className="foot-meta">
          <span>{state.sessions.length} sessions</span>
          <span>Local workspace</span>
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
              notify("Session ID copied");
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
              notify("Session deleted");
            }}
          >
            <Icon name="trash" size={14} /> Delete
          </button>
        </div>
      )}
    </aside>
  );
}
