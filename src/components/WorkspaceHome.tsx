import { useStore } from "../lib/store";
import type { Attachment } from "../lib/types";
import { isConfigured } from "../lib/providers";
import { timeAgo } from "../lib/util";
import { Composer } from "./Composer";
import { Icon } from "./Icons";

interface WorkspaceHomeProps {
  onSend: (text: string, attachments?: Attachment[]) => void;
  onOpenSettings: () => void;
  onScreenToggle: () => void;
  onAddWorkspace: () => void;
  onOpenFile?: (path: string) => void;
}

/**
 * The project's front page. OpenWork opens a workspace and starts talking to
 * it; this keeps that one-composer feel while showing what already lives here.
 */
export function WorkspaceHome({
  onSend,
  onOpenSettings,
  onScreenToggle,
  onAddWorkspace,
  onOpenFile,
}: WorkspaceHomeProps) {
  const { state, selectSession, setSettings } = useStore();
  const workspace = state.workspaces.find((item) => item.id === state.activeWorkspaceId);
  const sessions = state.sessions
    .filter(
      (session) =>
        session.workspaceId === workspace?.id && (session.surface ?? "chat") === "chat",
    )
    .sort((a, b) => b.updated - a.updated);
  const files = state.workspace.filter((file) => !file.dir);
  const configured = isConfigured(
    state.settings.defaultProvider,
    state.settings.providers[state.settings.defaultProvider],
  );

  if (!workspace) {
    return (
      <div className="ow-workspace-home is-empty">
        <div className="ow-empty-card">
          <span className="ow-empty-icon">
            <Icon name="folderPlus" size={24} />
          </span>
          <h1>Add your first workspace</h1>
          <p>
            A workspace is a project folder. Every chat inside it can read, edit and run
            files there, and switching workspaces switches folders.
          </p>
          <button type="button" className="ow-primary" onClick={onAddWorkspace}>
            <Icon name="plus" size={15} />
            Choose a folder
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ow-workspace-home">
      <header className="ow-project-head">
        <span className="ow-ws-dot is-large" style={{ background: workspace.color }} />
        <div className="ow-project-copy">
          <h1>{workspace.name}</h1>
          <span className="ow-project-path">{workspace.root || "No folder selected"}</span>
        </div>
        <button type="button" className="ow-quiet-button" onClick={onAddWorkspace}>
          <Icon name="plus" size={14} />
          Add workspace
        </button>
      </header>

      <div className="ow-project-body">
        <div className="ow-project-main">
          <div className="ow-hero-copy">
            <h2>What should we build?</h2>
            <p>
              Ask for a change, a review, a bug fix or a page. The agent works in this
              folder, and every chat here keeps its own history.
            </p>
          </div>

          <Composer
            variant="home"
            agent={state.settings.defaultAgent}
            provider={state.settings.defaultProvider}
            model={state.settings.defaultModel}
            onAgentChange={(agent) => setSettings({ defaultAgent: agent })}
            onModelChange={(provider, model) =>
              setSettings({ defaultProvider: provider, defaultModel: model })
            }
            onOpenProviders={onOpenSettings}
            onSend={onSend}
            onScreenToggle={onScreenToggle}
          />

          <div className="ow-project-meta">
            <span className="ow-meta-item">
              <Icon name="folder" size={13} />
              {files.length} file{files.length === 1 ? "" : "s"}
            </span>
            <span className="ow-meta-item">
              <Icon name="message" size={13} />
              {sessions.length} chat{sessions.length === 1 ? "" : "s"}
            </span>
            <span className="ow-meta-item">
              <Icon name="branch" size={13} />
              {state.settings.defaultAgent === "build" ? "Writes files" : "Read-only"}
            </span>
            <span className="ow-meta-item">
              <span className={`status-dot ${configured ? "is-ok" : "is-idle"}`} />
              {configured ? "Model ready" : "No provider connected"}
            </span>
          </div>

          {sessions.length > 0 && (
            <section className="ow-recent">
              <div className="ow-recent-head">
                <span>Recent chats</span>
                <span className="ow-count">{sessions.length}</span>
              </div>
              {sessions.slice(0, 5).map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className="ow-recent-row"
                  onClick={() => selectSession(session.id)}
                >
                  <Icon name="message" size={14} />
                  <span className="ow-recent-title">{session.title}</span>
                  <span className="ow-recent-time">{timeAgo(session.updated)}</span>
                </button>
              ))}
            </section>
          )}
        </div>

        <aside className="ow-project-side">
          <section className="ow-side-card">
            <div className="ow-side-card-head">
              <span>Project</span>
            </div>
            <div className="ow-kv">
              <span>Folder</span>
              <span className="ow-kv-value mono" title={workspace.root}>
                {workspace.root.split("/").filter(Boolean).pop() ?? "—"}
              </span>
            </div>
            <div className="ow-kv">
              <span>Chats</span>
              <span className="ow-kv-value">{sessions.length}</span>
            </div>
            <div className="ow-kv">
              <span>Files</span>
              <span className="ow-kv-value">{files.length}</span>
            </div>
            <div className="ow-kv">
              <span>Agent</span>
              <span className="ow-kv-value">
                {state.settings.defaultAgent === "build" ? "Build" : "Plan"}
              </span>
            </div>
          </section>

          {files.length > 0 && (
            <section className="ow-side-card">
              <div className="ow-side-card-head">
                <span>Files</span>
                <span className="ow-count">{files.length}</span>
              </div>
              <div className="ow-file-list">
                {files.slice(0, 8).map((file) => (
                  <button
                    key={file.id}
                    type="button"
                    className="ow-file-row"
                    onClick={() => onOpenFile?.(file.path)}
                    title={file.path}
                  >
                    <Icon name="file" size={13} />
                    <span>{file.path}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
