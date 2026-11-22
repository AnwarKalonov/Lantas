import { useEffect, useState } from "react";
import { AGENTS, KEYBINDS, PROVIDERS } from "../lib/data";
import {
  getProvider,
  isConfigured,
  listModels,
  prettyModel,
  testProvider,
} from "../lib/providers";
import { useStore } from "../lib/store";
import type { AgentId, ProviderId, ProviderMeta, ThemeMode } from "../lib/types";
import { cx } from "../lib/util";
import { Lockup, Wordmark } from "./Brand";
import { Icon, type IconName } from "./Icons";
import { McpManager } from "./McpManager";

export type SettingsTab =
  | "general"
  | "providers"
  | "models"
  | "agents"
  | "permissions"
  | "skills"
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
              placeholder="Paste a key"
              autoComplete="off"
              spellCheck={false}
            />
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
}

export function SettingsModal({ open, initialTab = "general", onClose }: SettingsModalProps) {
  const { state, setSettings, updateSkill, setView, notify } = useStore();
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const settings = state.settings;

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

  const connected = PROVIDERS.filter((meta) =>
    isConfigured(meta.id, settings.providers[meta.id]),
  );

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
            <Wordmark cell={1.7} />
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

              {connected.length === 0 && (
                <div className="empty-state">
                  <p>No provider connected yet.</p>
                  <button type="button" className="button-primary" onClick={() => setTab("providers")}>
                    Connect a provider
                  </button>
                </div>
              )}

              {connected.map((meta) => {
                const config = settings.providers[meta.id];
                const models = Array.from(new Set([...config.models, ...meta.models]));
                return (
                  <div className="model-section" key={meta.id}>
                    <div className="model-section-head">
                      <span>{meta.name}</span>
                      <span className="model-section-meta">
                        {meta.local ? "local" : meta.kind}
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
                            <span className="model-name">{prettyModel(model)}</span>
                            <span className="model-sub mono">{model}</span>
                          </span>
                          {active && <Icon name="check" size={14} />}
                        </button>
                      );
                    })}
                    {models.length === 0 && (
                      <p className="empty-line">
                        No models found yet. Fetch them in Providers → {meta.name}.
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
              <p className="settings-lede">What a run may touch without asking.</p>

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
                label="Screen access"
                description="Reads the frontmost window and open files."
                checked={settings.screenAccess}
                onChange={(next) => setSettings({ screenAccess: next })}
              />
              <Toggle
                label="Computer control"
                description="Pointer and keyboard. macOS asks for Accessibility on first use."
                checked={settings.computerControl}
                onChange={(next) => setSettings({ computerControl: next })}
              />

              <div className="notice">
                <Icon name="alert" size={14} />
                <span>
                  Screen and Control are permissioned by macOS. The app requests Screen
                  Recording and Accessibility the first time either is used in the desktop build.
                </span>
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
              <p className="settings-lede">The interface follows one neutral palette in both modes.</p>

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
              <div className="about-lockup">
                <Lockup className="about-lockup" />
              </div>
              <h2>Lantas</h2>
              <p className="settings-lede">
                A coding agent for the desktop, built around sessions, providers and skills.
              </p>
              <div className="about-rows">
                <div className="kv">
                  <span className="kv-key">Version</span>
                  <span className="kv-val mono">0.1.0</span>
                </div>
                <div className="kv">
                  <span className="kv-key">Runtime</span>
                  <span className="kv-val mono">tauri 2 · webview</span>
                </div>
                <div className="kv">
                  <span className="kv-key">Providers</span>
                  <span className="kv-val mono">{connected.length} connected</span>
                </div>
                <div className="kv">
                  <span className="kv-key">Demo runtime</span>
                  <span className="kv-val mono">
                    {connected.length === 0 ? "active" : "fallback"}
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
