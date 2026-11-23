import { useStore } from "../lib/store";
import type { Attachment } from "../lib/types";
import { SUGGESTIONS } from "../lib/data";
import { isConfigured } from "../lib/providers";
import { Composer } from "./Composer";
import { MarkGlyph, Wordmark } from "./Brand";
import { Icon, type IconName } from "./Icons";

const SUGGESTION_ICONS: Record<string, IconName> = {
  compass: "compass",
  wrench: "wrench",
  diff: "diff",
};

interface HomeProps {
  onSend: (text: string, attachments?: Attachment[]) => void;
  onOpenSettings: () => void;
  onScreenToggle: () => void;
}

export function Home({ onSend, onOpenSettings, onScreenToggle }: HomeProps) {
  const { state, setSettings } = useStore();
  const configured = isConfigured(
    state.settings.defaultProvider,
    state.settings.providers[state.settings.defaultProvider],
  );

  return (
    <div className="home">
      <div className="home-inner">
        <div className="hero">
          <div className="brand-hero">
            <span className="brand-hero-mark">
              <MarkGlyph size={58} />
            </span>
            <Wordmark cell={4.2} className="brand-hero-word" />
          </div>
          <p className="hero-line">Work across your repo, your screen and your machine</p>
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

        <div className="suggestions">
          {SUGGESTIONS.map((item) => (
            <button
              key={item.title}
              type="button"
              className="suggestion"
              onClick={() => onSend(item.prompt)}
            >
              <span className="suggestion-icon">
                <Icon name={SUGGESTION_ICONS[item.icon]} size={15} />
              </span>
              <span className="suggestion-title">{item.title}</span>
              <span className="suggestion-body">{item.body}</span>
              <Icon name="chevronRight" size={14} className="suggestion-arrow" />
            </button>
          ))}
        </div>

        <div className="home-foot">
          <span className="home-foot-item">
            <Icon name="folder" size={13} /> {state.workspaceName || "No folder"}
          </span>
          <span className="home-foot-item">
            <Icon name="branch" size={13} /> {state.workspaceName ? "main" : "—"}
          </span>
          <span className="home-foot-item">
            <span className={`status-dot ${configured ? "is-ok" : "is-idle"}`} aria-hidden="true" />
            {configured ? "Provider configured" : "Demo runtime"}
          </span>
          <span className="home-foot-spacer" />
          <span className="home-foot-item dim">
            {state.skills.filter((skill) => skill.enabled).length} skills on
          </span>
        </div>
      </div>
    </div>
  );
}
