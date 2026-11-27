import { useEffect, useState } from "react";
import { AGENTS, KEYBINDS, PROVIDERS } from "../lib/data";
import {
  getProvider,
  isConfigured,
  isFreeModel,
  listModels,
  prettyModel,
  testProvider,
} from "../lib/providers";
import { useStore } from "../lib/store";
import { APP_VERSION, checkForUpdate, checkNativeUpdate } from "../lib/updates";
import { inTauri, openExternal, openInVsCode, openPrivacySettings } from "../lib/native";
import { clearAuditLog, getAuditLog, subscribeAudit } from "../lib/audit";
import { ringDone } from "../lib/chime";
import type { AgentId, ProviderId, ProviderMeta, ThemeMode } from "../lib/types";
import { cx, uid } from "../lib/util";
import { MarkGlyph } from "./Brand";
import { Icon, type IconName } from "./Icons";
import { McpManager } from "./McpManager";

export type SettingsTab =
  | "general"
  | "providers"
  | "models"
  | "agents"
  | "permissions"
  | "skills"
  | "commands"
  | "integrations"
  | "appearance"
  | "keybinds"
  | "about";

const TABS: Array<{ id: SettingsTab; label: string; icon: IconName }> = [
  { id: "general", label: "General", icon: "settings" },
  { id: "providers", label: "Providers", icon: "key" },
  { id: "models", label: "Models", icon: "cpu" },
  { id: "agents", label: "Agents", icon: "sparkle" },
  { id: "permissions", label: "Permissions", icon: "shield" },
  { id: "skills", label: "Skills", icon: "book" },
  { id: "commands", label: "Commands", icon: "terminal" },
  { id: "integrations", label: "Integrations", icon: "plug" },
  { id: "appearance", label: "Appearance", icon: "palette" },
  { id: "keybinds", label: "Keybinds", icon: "keyboard" },
  { id: "about", label: "About", icon: "frame" },
];

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button type="button" className="toggle-row" onClick={() => onChange(!checked)}>
      <span className="toggle-text">
        <span className="toggle-label">{label}</span>
        {description && <span className="toggle-desc">{description}</span>}
      </span>
      <span className={cx("switch", checked && "is-on")} aria-hidden="true">
        <span className="switch-knob" />
      </span>
    </button>
  );
}

function ProviderCard({ meta }: { meta: ProviderMeta }) {
  const { state, updateProvider, setSettings, notify } = useStore();
  const config = state.settings.providers[meta.id];
  const [busy, setBusy] = useState<"test" | "models" | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const ready = isConfigured(meta.id, config);
  const models = Array.from(new Set([...config.models, ...meta.models]));

  const runTest = async () => {
    setBusy("test");
    setStatus(null);
    const result = await testProvider(meta.id, config);
    setBusy(null);
    setStatus(result.ok ? `Connected · ${result.detail}` : result.detail);
    if (result.ok && result.models?.length) updateProvider(meta.id, { models: result.models });
    notify(
      result.ok ? `${meta.name} connected` : `${meta.name}: ${result.detail}`,
      result.ok ? "default" : "error",
    );
  };

  const fetchModels = async () => {
    setBusy("models");
    const result = await listModels(meta.id, config);
    setBusy(null);
    setStatus(result.ok ? result.detail : result.detail);
    if (result.ok && result.models?.length) {
      updateProvider(meta.id, { models: result.models });
      notify(`${result.models.length} models from ${meta.name}`);
    } else if (!result.ok) {
      notify(result.detail, "error");
    }
  };

  return (
    <article className="provider-card">
      <header className="provider-head">
        <div className="provider-title">
          <span className="provider-name">{meta.name}</span>
          {meta.local && <span className="tag">local</span>}
          {ready ? (
            <span className="provider-status is-ready">ready</span>
          ) : (
            <span className="provider-status">{meta.needsKey ? "no key" : "not connected"}</span>
          )}
        </div>
        <span className="provider-desc">{meta.description}</span>
      </header>

      <div className="provider-body">
        {meta.needsKey && (
          <label className="field">
            <span>API key</span>
            <input
              type="password"
              value={config.apiKey}
              onChange={(event) => updateProvider(meta.id, { apiKey: event.target.value })}
              onBlur={(event) => updateProvider(meta.id, { apiKey: event.target.value.trim() })}
              placeholder="Paste a key"
              autoComplete="off"
              spellCheck={false}
            />
            {meta.docs && (
              <a
                className="text-button provider-link"
                href={`https://${meta.docs}`}
                target="_blank"
                rel="noreferrer"
              >
                Get a key
              </a>
            )}
          </label>
        )}

        <label className="field">
          <span>Base URL</span>
          <input
            value={config.baseUrl}
            onChange={(event) => updateProvider(meta.id, { baseUrl: event.target.value })}
            placeholder={meta.baseUrl || "https://your-endpoint/v1"}
            spellCheck={false}
          />
        </label>

        <div className="provider-actions">
          <button
            type="button"
            className="button-quiet"
            onClick={runTest}
            disabled={busy !== null || (meta.needsKey && !config.apiKey.trim())}
          >
            {busy === "test" ? "Testing" : "Test connection"}
          </button>
          <button type="button" className="button-quiet" onClick={fetchModels} disabled={busy !== null}>
            {busy === "models" ? "Loading" : "Fetch models"}
          </button>
          <button
            type="button"
            className="text-button provider-link"
            onClick={() => setAdvanced(!advanced)}
          >
            {advanced ? "Hide details" : "Details"}
          </button>
        </div>

        {status && <p className="status-line">{status}</p>}

        {advanced && (
          <div className="provider-detail">
            <div className="kv">
              <span className="kv-key">Adapter</span>
              <span className="kv-val mono">
                {meta.kind === "anthropic"
                  ? "messages"
                  : meta.kind === "google"
                    ? "generateContent"
                    : meta.kind === "ollama"
                      ? "ollama /api/chat"
                      : "openai chat/completions"}
              </span>
            </div>
            <div className="kv">
              <span className="kv-key">Get a key</span>
              <span className="kv-val mono">{meta.docs}</span>
            </div>
            {meta.local && (
              <p className="provider-hint">
                For Ollama, allow this app's origin:{" "}
                <code>OLLAMA_ORIGINS=* ollama serve</code>. In the desktop build the HTTP bridge
                bypasses this.
              </p>
            )}
          </div>
        )}

        {models.length > 0 && (
          <div className="model-chips">
            {models.slice(0, 8).map((model) => (
              <button
                key={model}
                type="button"
                className={cx(
                  "model-chip",
                  state.settings.defaultProvider === meta.id &&
                    state.settings.defaultModel === model &&
                    "is-active",
                )}
                onClick={() => {
                  setSettings({ defaultProvider: meta.id, defaultModel: model });
                  notify(`Default model: ${prettyModel(model)}`);
                }}
              >
                {prettyModel(model)}
              </button>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

interface SettingsModalProps {
  open: boolean;
  initialTab?: SettingsTab;
  onClose: () => void;
  /** Reopens the consent sheet so the user can review every capability at once. */
  onReviewPermissions?: () => void;
}

export function SettingsModal({
  open,
  initialTab = "general",
  onClose,
  onReviewPermissions,
}: SettingsModalProps) {
  const { state, setSettings, updateSkill, setView, setCommands, recoverSession, notify } =
    useStore();
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [audit, setAudit] = useState(getAuditLog);
  const [draft, setDraft] = useState({ name: "", description: "", template: "" });
  const [modelQuery, setModelQuery] = useState("");
  const [freeOnly, setFreeOnly] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const settings = state.settings;

  useEffect(() => subscribeAudit(() => setAudit(getAuditLog())), []);

  const openWorkspaceInCode = async () => {
    if (!state.workspaceRoot) {
      notify("Open a folder in Lantas first", "error");
      return;
    }
    const ok = await openInVsCode(state.workspaceRoot);
    notify(
      ok ? "Opening the workspace in VS Code" : "VS Code was not found on this Mac",
      ok ? "default" : "error",
    );
  };

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const checkUpdates = async () => {
    setCheckingUpdate(true);
    try {
      const native = await checkNativeUpdate();
      if (native) {
        notify(`Lantas ${native.version} is available — install it from the title bar`);
        return;
      }
      const next = await checkForUpdate(APP_VERSION, { ignoreDismissed: true });
      if (next) {
        notify(`Lantas ${next.version} is available — opening the release`);
        openExternal(next.url);
      } else {
        notify(`You are on the newest release (${APP_VERSION})`);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not reach GitHub", "error");
    } finally {
      setCheckingUpdate(false);
    }
  };

  const favoriteKey = (provider: ProviderId, model: string) => `${provider}/${model}`;
  const isFavorite = (provider: ProviderId, model: string) =>
    settings.favoriteModels.includes(favoriteKey(provider, model));
  const toggleFavorite = (provider: ProviderId, model: string) => {
    const key = favoriteKey(provider, model);
    setSettings({
      favoriteModels: settings.favoriteModels.includes(key)
        ? settings.favoriteModels.filter((entry) => entry !== key)
        : [...settings.favoriteModels, key],
    });
  };

  const query = modelQuery.trim().toLowerCase();
  const matches = (provider: ProviderId, model: string) => {
    if (freeOnly && !isFreeModel(provider, model)) return false;
    if (!query) return true;
    return (
      model.toLowerCase().includes(query) || prettyModel(model).toLowerCase().includes(query)
    );
  };
  const activeModels = PROVIDERS.filter((meta) =>
    isConfigured(meta.id, settings.providers[meta.id]),
  ).flatMap((meta) =>
    Array.from(new Set([...settings.providers[meta.id].models, ...meta.models])).map((model) => ({
      provider: meta.id,
      providerName: meta.name,
      model,
    })),
  );
  const pinned = activeModels.filter(
    (entry) => isFavorite(entry.provider, entry.model) && matches(entry.provider, entry.model),
  );

  const configured = PROVIDERS.filter((meta) =>
    isConfigured(meta.id, settings.providers[meta.id]),
  );
  // Local servers need no key, so they count as configured before they are
  // running. A non-local endpoint is the one that makes hosted calls.
  const remote = configured.filter((meta) => !meta.local);

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="settings"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Settings"
      >
        <aside className="settings-nav">
          <div className="settings-brand">
            <span>Settings</span>
          </div>
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cx("settings-tab", tab === item.id && "is-active")}
              onClick={() => setTab(item.id)}
            >
              <Icon name={item.icon} size={14} />
              {item.label}
            </button>
          ))}
          <button type="button" className="settings-close" onClick={onClose} aria-label="Close settings">
            <Icon name="close" size={14} />
          </button>
        </aside>

        <div className="settings-body">
          {tab === "general" && (
            <section className="settings-section">
              <h2>General</h2>
              <p className="settings-lede">How the composer and the app behave.</p>

              <Toggle
                label="Send on Enter"
                description="Shift+Enter adds a new line. ⌘Enter always sends."
                checked={settings.sendOnEnter}
                onChange={(next) => setSettings({ sendOnEnter: next })}
              />
              <Toggle
                label="Reduce motion"
                description="Turns off the streaming caret and panel transitions."
                checked={settings.reduceMotion}
                onChange={(next) => setSettings({ reduceMotion: next })}
              />
              <Toggle
                label="Completion chime"
                description="A soft two-note bell when a reply finishes."
                checked={settings.sound}
                onChange={(next) => {
                  setSettings({ sound: next });
                  if (next) ringDone();
                }}
              />
              <Toggle
                label="Usage telemetry"
                description="Off. This build sends nothing anywhere."
                checked={settings.telemetry}
                onChange={(next) => {
                  setSettings({ telemetry: next });
                  if (next) notify("Nothing is collected in this build");
                }}
              />

              <div className="settings-field">
                <span className="field-label">Default agent</span>
                <div className="segmented">
                  {(["build", "plan", "chat"] as AgentId[]).map((agent) => (
                    <button
                      key={agent}
                      type="button"
                      className={cx(settings.defaultAgent === agent && "is-active")}
                      onClick={() => setSettings({ defaultAgent: agent })}
                    >
                      {agent.charAt(0).toUpperCase() + agent.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-field">
                <span className="field-label">Workspace</span>
                <div className="settings-inline">
                  <span className="settings-muted mono">
                    {state.workspaceRoot || "No folder open"}
                  </span>
                  <button
                    type="button"
                    className="button-quiet"
                    onClick={() => void openWorkspaceInCode()}
                    disabled={!state.workspaceRoot}
                  >
                    <Icon name="external" size={13} />
                    Open in VS Code
                  </button>
                </div>
              </div>

              <div className="settings-field">
                <span className="field-label">Session backup</span>
                <div className="settings-inline">
                  <span className="settings-muted settings-note">
                    The desktop app saves to a disk file after every turn. Restore it if
                    browser storage was cleared or corrupted.
                  </span>
                  <button
                    type="button"
                    className="button-quiet"
                    onClick={() => void recoverSession()}
                  >
                    <Icon name="refresh" size={13} />
                    Restore from disk
                  </button>
                </div>
              </div>
            </section>
          )}

          {tab === "providers" && (
            <section className="settings-section">
              <h2>Providers</h2>
              <p className="settings-lede">
                Bring your own keys, or point at a local server. Keys are saved in this app's
                local data, not a server.
              </p>

              <div className="notice">
                <Icon name="shield" size={14} />
                <span>
                  Stored unencrypted on this machine. Use a scoped key you can rotate. The
                  desktop build sends provider requests through the native HTTP client.
                </span>
              </div>

              {PROVIDERS.map((meta) => (
                <ProviderCard key={meta.id} meta={meta} />
              ))}
            </section>
          )}

          {tab === "models" && (
            <section className="settings-section">
              <h2>Models</h2>
              <p className="settings-lede">
                The default for new sessions. Each session can override it from the composer.
              </p>

              {configured.length === 0 && (
                <div className="empty-state">
                  <p>No provider configured yet.</p>
                  <button type="button" className="button-primary" onClick={() => setTab("providers")}>
                    Configure a provider
                  </button>
                </div>
              )}

              {configured.length > 0 && (
                <div className="model-toolbar">
                  <label className="code-filter model-search">
                    <Icon name="search" size={13} />
                    <input
                      value={modelQuery}
                      onChange={(event) => setModelQuery(event.target.value)}
                      placeholder="Search models — try “free”"
                      spellCheck={false}
                    />
                  </label>
                  <button
                    type="button"
                    className={cx("chip", freeOnly && "is-active")}
                    onClick={() => setFreeOnly((value) => !value)}
                  >
                    <Icon name="sparkle" size={12} />
                    Free only
                  </button>
                  {modelQuery && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setModelQuery("")}
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}

              {pinned.length > 0 && (
                <div className="model-section pinned-section">
                  <div className="model-section-head">
                    <span>Pinned</span>
                    <span className="model-section-meta">{pinned.length}</span>
                  </div>
                  {pinned.map(({ provider, providerName, model }) => {
                    const active =
                      settings.defaultProvider === provider && settings.defaultModel === model;
                    return (
                      <button
                        key={`pin-${provider}-${model}`}
                        type="button"
                        className={cx("model-row", active && "is-active")}
                        onClick={() => setSettings({ defaultProvider: provider, defaultModel: model })}
                      >
                        <span className="model-radio">{active && <span />}</span>
                        <span className="model-text">
                          <span className="model-name">
                            {prettyModel(model)}
                            {isFreeModel(provider, model) && <span className="model-free">free</span>}
                          </span>
                          <span className="model-sub mono">
                            {providerName} · {model}
                          </span>
                        </span>
                        <span
                          className="model-star is-pinned"
                          role="button"
                          aria-label={`Unpin ${model}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleFavorite(provider, model);
                          }}
                        >
                          <Icon name="sparkle" size={13} />
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {configured.map((meta) => {
                const config = settings.providers[meta.id];
                const models = Array.from(new Set([...config.models, ...meta.models]))
                  .filter((model) => matches(meta.id, model))
                  .sort((a, b) => a.localeCompare(b));
                const total = Array.from(new Set([...config.models, ...meta.models])).length;

                return (
                  <div className="model-section" key={meta.id}>
                    <div className="model-section-head">
                      <span>{meta.name}</span>
                      <span className="model-section-meta">
                        {query || freeOnly ? `${models.length} of ${total}` : `${total} models`}
                      </span>
                    </div>
                    {models.map((model) => {
                      const active =
                        settings.defaultProvider === meta.id && settings.defaultModel === model;
                      return (
                        <button
                          key={model}
                          type="button"
                          className={cx("model-row", active && "is-active")}
                          onClick={() =>
                            setSettings({ defaultProvider: meta.id, defaultModel: model })
                          }
                        >
                          <span className="model-radio">{active && <span />}</span>
                          <span className="model-text">
                            <span className="model-name">
                              {prettyModel(model)}
                              {isFreeModel(meta.id, model) && <span className="model-free">free</span>}
                            </span>
                            <span className="model-sub mono">{model}</span>
                          </span>
                          <span
                            className={cx("model-star", isFavorite(meta.id, model) && "is-pinned")}
                            role="button"
                            aria-label={`Pin ${model}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleFavorite(meta.id, model);
                            }}
                          >
                            <Icon name="sparkle" size={13} />
                          </span>
                          {active && <Icon name="check" size={14} />}
                        </button>
                      );
                    })}
                    {models.length === 0 && (
                      <p className="empty-line">
                        {total === 0
                          ? `No models found yet. Fetch them in Providers → ${meta.name}.`
                          : "Nothing matches that filter."}
                      </p>
                    )}
                  </div>
                );
              })}
            </section>
          )}

          {tab === "agents" && (
            <section className="settings-section">
              <h2>Agents</h2>
              <p className="settings-lede">What a run is allowed to do by default.</p>

              <div className="agent-list">
                {AGENTS.map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    className={cx("agent-row", settings.defaultAgent === agent.id && "is-active")}
                    onClick={() => setSettings({ defaultAgent: agent.id })}
                  >
                    <span className="model-radio">
                      {settings.defaultAgent === agent.id && <span />}
                    </span>
                    <span className="agent-text">
                      <span className="agent-name">
                        {agent.name}
                        {agent.readOnly && <span className="tag">read-only</span>}
                      </span>
                      <span className="agent-desc">{agent.description}</span>
                    </span>
                  </button>
                ))}
              </div>

              <p className="page-note">
                Plan and Chat never write. Build may propose edits and commands, and follows the
                approval mode set in Permissions.
              </p>
            </section>
          )}

          {tab === "permissions" && (
            <section className="settings-section">
              <h2>Permissions</h2>
              <p className="settings-lede">What Lantas may touch. Nothing here is on by default.</p>

              {onReviewPermissions && (
                <div className="settings-inline permissions-review">
                  <span className="field-help">
                    Show the same list Lantas asks about on first launch.
                  </span>
                  <button type="button" className="button-quiet small" onClick={onReviewPermissions}>
                    Review permissions
                  </button>
                </div>
              )}

              <div className="settings-field">
                <span className="field-label">Edits and commands</span>
                <div className="segmented">
                  <button
                    type="button"
                    className={cx(settings.permissionMode === "auto" && "is-active")}
                    onClick={() => setSettings({ permissionMode: "auto" })}
                  >
                    Auto-approve
                  </button>
                  <button
                    type="button"
                    className={cx(settings.permissionMode === "ask" && "is-active")}
                    onClick={() => setSettings({ permissionMode: "ask" })}
                  >
                    Ask first
                  </button>
                </div>
                <span className="field-help">
                  {settings.permissionMode === "auto"
                    ? "Read, edit and shell tools run without a prompt inside the workspace."
                    : "Every file edit and command waits for approval."}
                </span>
              </div>

              <Toggle
                label="File access"
                description="Read and edit files in the folder you open. Off blocks every file tool."
                checked={settings.fileAccess}
                onChange={(next) => setSettings({ fileAccess: next })}
              />
              <Toggle
                label="Run commands"
                description="Run builds, tests and git in that folder."
                checked={settings.terminalAccess}
                onChange={(next) => setSettings({ terminalAccess: next })}
              />
              <Toggle
                label="Screen access"
                description="Attach a fresh screenshot to a turn while it is on."
                checked={settings.screenAccess}
                onChange={(next) => setSettings({ screenAccess: next })}
              />
              <Toggle
                label="Computer control"
                description="Lets Lantas click, type and scroll in the browser and in the floating screen card, including other apps. Off by default."
                checked={settings.computerControl}
                onChange={(next) => setSettings({ computerControl: next })}
              />

              <div className="notice">
                <Icon name="alert" size={14} />
                <span>
                  Screen and Control are also permissioned by macOS. The app requests Screen
                  Recording and Accessibility the first time either is used in the desktop build.
                </span>
              </div>

              <div className="settings-inline permissions-review">
                <span className="field-help">Open the switch yourself — macOS will not let an app grant it.</span>
                <div className="perm-actions">
                  <button
                    type="button"
                    className="button-quiet small"
                    onClick={() => void openPrivacySettings("screen").then((ok) => {
                      if (!ok) notify("System Settings only opens from the desktop app", "error");
                    })}
                  >
                    Screen Recording
                  </button>
                  <button
                    type="button"
                    className="button-quiet small"
                    onClick={() => void openPrivacySettings("accessibility").then((ok) => {
                      if (!ok) notify("System Settings only opens from the desktop app", "error");
                    })}
                  >
                    Accessibility
                  </button>
                </div>
              </div>

              <div className="settings-field">
                <div className="settings-inline">
                  <span className="field-label">Recent decisions</span>
                  {audit.length > 0 && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        clearAuditLog();
                        setAudit([]);
                      }}
                    >
                      Clear log
                    </button>
                  )}
                </div>
                {audit.length === 0 ? (
                  <span className="field-help">
                    No approvals or denials yet. Tool calls that need permission appear here.
                  </span>
                ) : (
                  <div className="audit-list">
                    {audit.slice(0, 40).map((entry) => (
                      <div className="audit-row" key={entry.id}>
                        <span className="audit-tool">{entry.tool}</span>
                        <span className="audit-resource" title={entry.resource}>
                          {entry.resource}
                        </span>
                        <span
                          className={cx(
                            "audit-decision",
                            entry.decision === "allowed" ? "is-allowed" : "is-denied",
                          )}
                        >
                          {entry.decision}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {tab === "skills" && (
            <section className="settings-section">
              <h2>Skills</h2>
              <p className="settings-lede">
                Enabled skills are appended to the system prompt of every run.
              </p>

              <div className="settings-skill-list">
                {state.skills.map((skill) => (
                  <div className="settings-skill" key={skill.id}>
                    <span className="mono">/{skill.name}</span>
                    <span className="settings-skill-desc">{skill.description}</span>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => updateSkill(skill.id, { enabled: !skill.enabled })}
                    >
                      {skill.enabled ? "On" : "Off"}
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                className="button-quiet"
                onClick={() => {
                  onClose();
                  setView("skills");
                }}
              >
                Edit skills
              </button>
            </section>
          )}

          {tab === "commands" && (
            <section className="settings-section">
              <h2>Commands</h2>
              <p className="settings-lede">
                Your own slash commands. The body is sent as the prompt, and{" "}
                <code>$ARGUMENTS</code> is replaced with whatever you type after the command.
              </p>

              {state.commands.length > 0 ? (
                <div className="settings-skill-list">
                  {state.commands.map((item) => (
                    <div className="settings-skill" key={item.id}>
                      <span className="mono">/{item.name}</span>
                      <span className="settings-skill-desc">{item.description || item.template}</span>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() =>
                          setCommands(state.commands.filter((entry) => entry.id !== item.id))
                        }
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="panel-empty-meta">
                  Nothing custom yet. The built-in commands are listed in ⌘K and in the composer.
                </p>
              )}

              <div className="cmd-form">
                <div className="cmd-form-row">
                  <label className="settings-field">
                    <span className="field-label">Name</span>
                    <input
                      className="text-input"
                      value={draft.name}
                      placeholder="ship"
                      spellCheck={false}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    />
                  </label>
                  <label className="settings-field">
                    <span className="field-label">Description</span>
                    <input
                      className="text-input"
                      value={draft.description}
                      placeholder="Commit, push and open the PR"
                      onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                    />
                  </label>
                </div>
                <label className="settings-field">
                  <span className="field-label">Prompt template</span>
                  <textarea
                    className="text-input cmd-template"
                    rows={4}
                    value={draft.template}
                    placeholder={"Review the diff for $ARGUMENTS and fix what is wrong."}
                    onChange={(event) => setDraft({ ...draft, template: event.target.value })}
                  />
                </label>
                <button
                  type="button"
                  className="button-primary"
                  disabled={!draft.name.trim() || !draft.template.trim()}
                  onClick={() => {
                    const name = draft.name.replace(/^\/+/, "").replace(/\s+/g, "-").toLowerCase();
                    if (!name) return;
                    if (state.commands.some((item) => item.name === name)) {
                      notify(`/${name} already exists`, "error");
                      return;
                    }
                    setCommands([
                      ...state.commands,
                      {
                        id: uid("cmd"),
                        name,
                        description: draft.description.trim() || "Custom command",
                        template: draft.template.trim(),
                      },
                    ]);
                    setDraft({ name: "", description: "", template: "" });
                    notify(`/${name} added`);
                  }}
                >
                  Add command
                </button>
              </div>
            </section>
          )}

          {tab === "integrations" && (
            <section className="settings-section">
              <h2>Integrations</h2>
              <p className="settings-lede">
                MCP servers add tools. HTTP servers can be tested with a real handshake.
              </p>
              <McpManager compact />
            </section>
          )}

          {tab === "appearance" && (
            <section className="settings-section">
              <h2>Appearance</h2>
              <p className="settings-lede">
                One neutral palette for every surface, with a single ink accent for the
                primary action.
              </p>

              <div className="settings-field">
                <span className="field-label">Theme</span>
                <div className="theme-options">
                  {(
                    [
                      { id: "dark", label: "Dark", icon: "moon" },
                      { id: "light", label: "Light", icon: "sun" },
                      { id: "system", label: "System", icon: "monitor" },
                    ] as Array<{ id: ThemeMode; label: string; icon: IconName }>
                  ).map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={cx("theme-option", settings.theme === option.id && "is-active")}
                      onClick={() => setSettings({ theme: option.id })}
                    >
                      <Icon name={option.icon} size={16} />
                      <span>{option.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <Toggle
                label="Reduce motion"
                description="No caret blink, no panel transitions."
                checked={settings.reduceMotion}
                onChange={(next) => setSettings({ reduceMotion: next })}
              />

              <div className="settings-divider" />
              <h3 className="settings-subhead">Editor</h3>
              <p className="settings-lede compact">
                These apply to the Lantas editor now and stay with the workspace when you open it
                in VS Code.
              </p>

              <div className="settings-field">
                <span className="field-label">Font size</span>
                <div className="settings-inline">
                  <input
                    className="settings-range"
                    type="range"
                    min={11}
                    max={20}
                    step={1}
                    value={settings.editor.fontSize}
                    onChange={(event) =>
                      setSettings({
                        editor: { ...settings.editor, fontSize: Number(event.target.value) },
                      })
                    }
                    aria-label="Editor font size"
                  />
                  <span className="settings-mono-value">{settings.editor.fontSize}px</span>
                </div>
              </div>

              <div className="settings-field">
                <span className="field-label">Tab size</span>
                <div className="segmented">
                  {[2, 4, 8].map((size) => (
                    <button
                      key={size}
                      type="button"
                      className={cx(settings.editor.tabSize === size && "is-active")}
                      onClick={() =>
                        setSettings({ editor: { ...settings.editor, tabSize: size } })
                      }
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-field">
                <span className="field-label">Font</span>
                <select
                  className="settings-select mono"
                  value={settings.editor.fontFamily}
                  onChange={(event) =>
                    setSettings({
                      editor: { ...settings.editor, fontFamily: event.target.value },
                    })
                  }
                >
                  <option value={'"SF Mono", ui-monospace, Menlo, monospace'}>
                    SF Mono / system mono
                  </option>
                  <option value={'"JetBrains Mono", ui-monospace, monospace'}>
                    JetBrains Mono
                  </option>
                  <option value={'"IBM Plex Mono", ui-monospace, monospace'}>
                    IBM Plex Mono
                  </option>
                  <option value={'Menlo, Monaco, monospace'}>Menlo</option>
                </select>
              </div>

              <Toggle
                label="Word wrap"
                description="Wrap long lines instead of scrolling sideways."
                checked={settings.editor.wordWrap === "on"}
                onChange={(next) =>
                  setSettings({
                    editor: { ...settings.editor, wordWrap: next ? "on" : "off" },
                  })
                }
              />
              <Toggle
                label="Minimap"
                description="Show the overview map on the right edge."
                checked={settings.editor.minimap}
                onChange={(next) =>
                  setSettings({ editor: { ...settings.editor, minimap: next } })
                }
              />
            </section>
          )}

          {tab === "keybinds" && (
            <section className="settings-section">
              <h2>Keybinds</h2>
              <p className="settings-lede">Active shortcuts in this build.</p>
              <div className="keybind-table">
                {KEYBINDS.map((bind) => (
                  <div className="keybind-row" key={bind.keys + bind.action}>
                    <span className="keybind-action">{bind.action}</span>
                    <kbd>{bind.keys}</kbd>
                  </div>
                ))}
              </div>
            </section>
          )}

          {tab === "about" && (
            <section className="settings-section about">
              <div className="about-mark">
                <MarkGlyph size={48} />
              </div>
              <h2>Lantas</h2>
              <p className="settings-lede">
                A coding agent for the desktop, built around sessions, providers and skills.
              </p>
              <div className="about-rows">
                <div className="kv">
                  <span className="kv-key">Version</span>
                  <span className="kv-val mono">{APP_VERSION}</span>
                </div>
                <div className="kv">
                  <span className="kv-key">Updates</span>
                  <span className="kv-val">
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => void checkUpdates()}
                      disabled={checkingUpdate}
                    >
                      {checkingUpdate ? "Checking…" : "Check for updates"}
                    </button>
                  </span>
                </div>
                <div className="kv">
                  <span className="kv-key">Runtime</span>
                  <span className="kv-val mono">
                    {inTauri() ? "tauri 2 · webview" : "browser preview"}
                  </span>
                </div>
                <div className="kv">
                  <span className="kv-key">Providers</span>
                  <span className="kv-val mono">{configured.length} configured</span>
                </div>
                <div className="kv">
                  <span className="kv-key">Agent runtime</span>
                  <span className="kv-val mono">
                    {remote.length > 0
                      ? "live model calls"
                      : configured.length > 0
                        ? "local servers only"
                        : "waiting for a provider"}
                  </span>
                </div>
              </div>
              <p className="page-note">
                Sessions, skills, keys and server config live in this app's local storage. Reset
                removes all of it.
              </p>
              <button
                type="button"
                className="danger-button"
                onClick={() => {
                  localStorage.removeItem("lantas.app.v2");
                  notify("Local data cleared");
                  window.setTimeout(() => window.location.reload(), 400);
                }}
              >
                Reset local data
              </button>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
