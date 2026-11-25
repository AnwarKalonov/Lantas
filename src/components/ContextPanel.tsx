import type { Session } from "../lib/types";
import { AGENTS, MCP_TEMPLATES } from "../lib/data";
import { getProvider, isConfigured, prettyModel } from "../lib/providers";
import { useStore } from "../lib/store";
import { cx, formatCost, formatTokens } from "../lib/util";
import { Icon } from "./Icons";

export function ContextPanel({
  session,
  onOpenSettings,
  onOpenFile,
}: {
  session: Session | null;
  onOpenSettings: () => void;
  onOpenFile?: (path: string, line?: number) => void;
}) {
  const { state, setSettings, updateSession, updateMcp, togglePanel, setView, notify } = useStore();
  const settings = state.settings;
  const agent = session ? AGENTS.find((item) => item.id === session.agent) : null;
  const provider = session ? getProvider(session.provider) : null;
  const percent = session
    ? Math.min(100, Math.round((session.tokens / session.contextWindow) * 100))
    : 0;
  const skillsOn = state.skills.filter((skill) => skill.enabled).length;
  const workspaceFiles = state.workspace.filter((file) => !file.dir);

  const toggleTodo = (todoId: string) => {
    if (!session) return;
    updateSession(session.id, (current) => ({
      ...current,
      todos: current.todos.map((todo) =>
        todo.id === todoId ? { ...todo, done: !todo.done, active: false } : todo,
      ),
    }));
  };

  return (
    <aside className="context-panel">
      <div className="panel-head">
        <span className="panel-title">Context</span>
        <button
          className="icon-button"
          type="button"
          onClick={togglePanel}
          aria-label="Hide context panel"
          title="Hide panel (⌘⇧B)"
        >
          <Icon name="close" size={14} />
        </button>
      </div>

      <div className="panel-scroll">
        {session ? (
          <>
            <section className="panel-section">
              <h3>Session</h3>
              <div className="kv">
                <span className="kv-key">Agent</span>
                <span className="kv-val">
                  {agent?.name}
                  {agent?.readOnly && <span className="kv-tag">read-only</span>}
                </span>
              </div>
              <div className="kv">
                <span className="kv-key">Model</span>
                <span className="kv-val">
                  {prettyModel(session.model)}
                  {!isConfigured(session.provider, settings.providers[session.provider]) && (
                    <span className="kv-tag">offline</span>
                  )}
                </span>
              </div>
              <div className="kv">
                <span className="kv-key">Provider</span>
                <span className="kv-val">{provider?.name}</span>
              </div>
              <div className="kv">
                <span className="kv-key">Branch</span>
                <span className="kv-val mono">{session.branch}</span>
              </div>
              <div className="kv">
                <span className="kv-key">Folder</span>
                <span className="kv-val mono ellipsis" title={session.cwd}>
                  {session.cwd}
                </span>
              </div>
            </section>

            <section className="panel-section">
              <h3>Capabilities</h3>
              <button
                type="button"
                className="cap-row"
                onClick={() => setSettings({ fileAccess: !settings.fileAccess })}
              >
                <span className="cap-icon">
                  <Icon name="folder" size={14} />
                </span>
                <span className="cap-text">
                  <span className="cap-title">Files</span>
                  <span className="cap-sub">Reads the open folder</span>
                </span>
                <span className={cx("cap-state", settings.fileAccess && "is-on")}>
                  {settings.fileAccess ? "on" : "off"}
                </span>
              </button>
              <button
                type="button"
                className="cap-row"
                onClick={() => setSettings({ terminalAccess: !settings.terminalAccess })}
              >
                <span className="cap-icon">
                  <Icon name="terminal" size={14} />
                </span>
                <span className="cap-text">
                  <span className="cap-title">Commands</span>
                  <span className="cap-sub">Runs in that folder</span>
                </span>
                <span className={cx("cap-state", settings.terminalAccess && "is-on")}>
                  {settings.terminalAccess ? "on" : "off"}
                </span>
              </button>
              <button
                type="button"
                className="cap-row"
                onClick={() => setSettings({ screenAccess: !settings.screenAccess })}
              >
                <span className="cap-icon">
                  <Icon name="screen" size={14} />
                </span>
                <span className="cap-text">
                  <span className="cap-title">Screen</span>
                  <span className="cap-sub">Frontmost window</span>
                </span>
                <span className={cx("cap-state", settings.screenAccess && "is-on")}>
                  {settings.screenAccess ? "on" : "off"}
                </span>
              </button>
              <button
                type="button"
                className="cap-row"
                onClick={() => setSettings({ computerControl: !settings.computerControl })}
              >
                <span className="cap-icon">
                  <Icon name="cursor" size={14} />
                </span>
                <span className="cap-text">
                  <span className="cap-title">Control</span>
                  <span className="cap-sub">Pointer and keyboard</span>
                </span>
                <span className={cx("cap-state", settings.computerControl && "is-warn")}>
                  {settings.computerControl ? "on" : "off"}
                </span>
              </button>
              <button
                type="button"
                className="cap-row"
                onClick={() =>
                  setSettings({
                    permissionMode: settings.permissionMode === "auto" ? "ask" : "auto",
                  })
                }
              >
                <span className="cap-icon">
                  <Icon name="shield" size={14} />
                </span>
                <span className="cap-text">
                  <span className="cap-title">Approvals</span>
                  <span className="cap-sub">
                    {settings.permissionMode === "auto" ? "Auto-approve edits" : "Ask before edits"}
                  </span>
                </span>
                <span className="cap-state is-neutral">
                  {settings.permissionMode === "auto" ? "auto" : "ask"}
                </span>
              </button>
            </section>

            {session.todos.length > 0 && (
              <section className="panel-section">
                <h3>
                  Todos
                  <span className="section-count">
                    {session.todos.filter((todo) => todo.done).length}/{session.todos.length}
                  </span>
                </h3>
                <div className="todo-list">
                  {session.todos.map((todo) => (
                    <button
                      key={todo.id}
                      type="button"
                      className={cx("todo-row", todo.done && "is-done", todo.active && "is-active")}
                      onClick={() => toggleTodo(todo.id)}
                    >
                      <span className="todo-box">
                        {todo.done ? <Icon name="check" size={11} /> : null}
                      </span>
                      <span className="todo-text">{todo.text}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {session.files.length > 0 && (
              <section className="panel-section">
                <h3>Changed files</h3>
                <div className="file-list">
                  {session.files.map((file) => (
                    <button
                      key={file.path}
                      type="button"
                      className="file-row"
                      onClick={() =>
                        onOpenFile
                          ? onOpenFile(file.path)
                          : notify(`${file.path} · +${file.added} −${file.removed}`)
                      }
                    >
                      <Icon name="file" size={13} />
                      <span className="file-path">{file.path}</span>
                      <span className="file-stats">
                        <span className="diff-add">+{file.added}</span>
                        <span className="diff-del">−{file.removed}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <section className="panel-section panel-empty">
            <span className="panel-empty-icon">
              <Icon name="compass" size={18} />
            </span>
            <p>Start a session to see live context here</p>
            <span className="panel-empty-meta">
              {skillsOn} skills on · {state.mcpServers.filter((server) => server.enabled).length} integrations
            </span>
          </section>
        )}

        <section className="panel-section">
          <h3>
            Skills
            <button type="button" className="section-link" onClick={() => setView("skills")}>
              Manage
            </button>
          </h3>
          <div className="skill-mini-list">
            {state.skills.slice(0, 4).map((skill) => (
              <div className="skill-mini" key={skill.id}>
                <span className={cx("mini-dot", skill.enabled && "is-on")} />
                <span className="mono">{skill.name}</span>
                <span className="skill-mini-state">{skill.enabled ? "on" : "off"}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel-section">
          <h3>
            Integrations
            <button type="button" className="section-link" onClick={() => setView("integrations")}>
              Manage
            </button>
          </h3>
          <div className="mcp-list">
            {state.mcpServers.map((server) => (
              <button
                key={server.id}
                type="button"
                className="mcp-row"
                onClick={() => updateMcp(server.id, { enabled: !server.enabled })}
              >
                <span
                  className={cx(
                    "mcp-dot",
                    server.status === "connected" && "is-ok",
                    server.status === "error" && "is-err",
                    server.status === "untested" && "is-idle",
                  )}
                />
                <span className="mcp-name mono">{server.name}</span>
                <span className="mcp-detail">{server.enabled ? server.transport : "off"}</span>
              </button>
            ))}
            {state.mcpServers.length === 0 && (
              <button type="button" className="text-button" onClick={() => setView("integrations")}>
                Add an MCP server from {MCP_TEMPLATES.length} templates
              </button>
            )}
          </div>
        </section>

        <section className="panel-section">
          <h3>
            Files
            <button type="button" className="section-link" onClick={() => setView("chats")}>
              Open
            </button>
          </h3>
          {workspaceFiles.length > 0 ? (
            <div className="workspace-list">
              {workspaceFiles.slice(0, 6).map((file) => (
                <button
                  className="workspace-row"
                  key={file.id}
                  type="button"
                  onClick={() =>
                    onOpenFile
                      ? onOpenFile(file.path)
                      : notify(`${file.path} · ${Math.max(1, Math.round(file.size / 1024))} KB`)
                  }
                >
                  <Icon name="file" size={12} />
                  <span>{file.path}</span>
                </button>
              ))}
              {workspaceFiles.length > 6 && (
                <p className="panel-empty-meta">+{workspaceFiles.length - 6} more</p>
              )}
            </div>
          ) : (
            <p className="panel-empty-meta">No folder open. Pick one in the Code tab.</p>
          )}
        </section>
      </div>

      <div className="panel-foot">
        <div className="context-meter">
          <div className="context-meter-top">
            <span>Context</span>
            <span className="mono">
              {session
                ? `${formatTokens(session.tokens)} / ${formatTokens(session.contextWindow)}`
                : "—"}
            </span>
          </div>
          <div className="context-bar">
            <span style={{ width: `${Math.max(percent, 2)}%` }} />
          </div>
        </div>
        <div className="panel-foot-meta">
          <span>{session ? `${percent}% used` : "idle"}</span>
          <button type="button" className="section-link" onClick={onOpenSettings}>
            {session ? formatCost(session.cost) : "Providers"}
          </button>
        </div>
      </div>
    </aside>
  );
}
