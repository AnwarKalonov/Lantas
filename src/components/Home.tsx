import { useStore } from "../lib/store";
import type { Attachment } from "../lib/types";
import { SUGGESTIONS } from "../lib/data";
import { isConfigured } from "../lib/providers";
import { Composer } from "./Composer";
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
        <div className="home-head">
          {state.workspaceName ? (
            <p className="home-kicker">Working in {state.workspaceName}</p>
          ) : null}
          <h1 className="home-title">What are we building?</h1>
          <p className="home-line">
            Lantas reads this folder, your screen and the page in front of you.
          </p>
        </div>

        <p className="home-try">Try Asking</p>
        <div className="suggestions">
          {SUGGESTIONS.map((item) => (
            <button
              key={item.title}
              type="button"
              className="suggestion"
              onClick={() => onSend(item.prompt)}
            >
              <span className="suggestion-icon">
                <Icon name={SUGGESTION_ICONS[item.icon]} size={13} />
              </span>
              <span className="suggestion-title">{item.title}</span>
              <Icon name="chevronRight" size={12} className="suggestion-arrow" />
            </button>
          ))}
        </div>

        <div className="home-spacer" />

        <div className="home-composer">
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
        </div>

        <div className="home-foot">
          <span className="home-foot-item">
            <Icon name="folder" size={12} /> {state.workspaceName || "No folder"}
          </span>
          <span className="home-foot-spacer" />
          <span className="home-foot-item">
            <span className={`status-dot ${configured ? "is-ok" : "is-idle"}`} aria-hidden="true" />
            {configured ? "Ready" : "No provider"}
          </span>
          <span className="home-foot-item dim">Lantas can make mistakes.</span>
        </div>
      </div>
    </div>
  );
}
