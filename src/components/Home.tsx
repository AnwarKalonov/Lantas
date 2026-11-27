import { useStore } from "../lib/store";
import type { Attachment } from "../lib/types";
import { SUGGESTIONS } from "../lib/data";
import { isConfigured, prettyModel } from "../lib/providers";
import { Composer } from "./Composer";
import { Lockup } from "./Brand";
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
          <Lockup className="home-lockup" />
          <h1 className="home-title">Ask, build or browse</h1>
          <p className="home-line">
            One thread for the folder, the screen and the page in front of you.
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

        <div className="suggestions">
          {SUGGESTIONS.map((item) => (
            <button
              key={item.title}
              type="button"
              className="suggestion"
              onClick={() => onSend(item.prompt)}
              title={item.body}
            >
              <span className="suggestion-icon">
                <Icon name={SUGGESTION_ICONS[item.icon]} size={15} />
              </span>
              <span className="suggestion-title">{item.title}</span>
            </button>
          ))}
        </div>

        <div className="home-foot">
          <span className="home-foot-item">
            <Icon name="folder" size={13} /> {state.workspaceName || "No folder open"}
          </span>
          {state.workspaceName ? (
            <span className="home-foot-item">
              <Icon name="branch" size={13} /> main
            </span>
          ) : null}
          <span className="home-foot-spacer" />
          <span className="home-foot-item">
            <span className={`status-dot ${configured ? "is-ok" : "is-idle"}`} aria-hidden="true" />
            {configured ? prettyModel(state.settings.defaultModel) : "No provider connected"}
          </span>
        </div>
      </div>
    </div>
  );
}
