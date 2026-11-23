import { useStore } from "../lib/store";
import { Icon } from "./Icons";
import { McpManager } from "./McpManager";
import { ComposioPanel } from "./ComposioPanel";
import { GitHubPanel } from "./GitHubPanel";
import { GooglePanel } from "./GooglePanel";

export function IntegrationsView() {
  const { state, setView } = useStore();
  const active = state.mcpServers.filter((server) => server.enabled).length;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Integrations</h1>
          <p className="page-lede">
            Model Context Protocol servers bring tools into a run: issue trackers, error
            monitoring, databases and the filesystem.
          </p>
        </div>
        <span className="page-meta">
          {active} of {state.mcpServers.length} enabled
        </span>
      </header>

      <div className="page-body">
        <ComposioPanel />
        <GitHubPanel />
        <GooglePanel />

        <section className="page-section">
          <div className="section-head">
            <h2>MCP servers</h2>
            <span className="section-meta">HTTP servers can be tested here</span>
          </div>
          <McpManager />
        </section>

        <section className="page-section">
          <div className="section-head">
            <h2>How this works</h2>
          </div>
          <ul className="plain-list">
            <li>
              <span className="plain-term">HTTP</span>
              <span>
                Streamable HTTP servers are called through the app's HTTP bridge, which bypasses
                browser CORS in the desktop build. Test sends a real <code>initialize</code>{" "}
                handshake.
              </span>
            </li>
            <li>
              <span className="plain-term">Stdio</span>
              <span>
                Stdio servers spawn a local process. The configuration is stored now; starting
                them needs the Tauri runtime.
              </span>
            </li>
            <li>
              <span className="plain-term">Scope</span>
              <span>Servers are enabled per app, not per session, and never leave this device.</span>
            </li>
          </ul>
        </section>

        <section className="page-section">
          <div className="section-head">
            <h2>Skills</h2>
            <button type="button" className="text-button" onClick={() => setView("skills")}>
              Open skills
            </button>
          </div>
          <p className="page-note">
            {state.skills.filter((skill) => skill.enabled).length} skills are attached to new runs.
            Integrations add tools; skills change how those tools are used.
          </p>
        </section>

        <p className="page-note with-icon">
          <Icon name="shield" size={14} />
          Server tokens are stored in this app's local data. Treat them like any other local
          credential.
        </p>
      </div>
    </div>
  );
}
