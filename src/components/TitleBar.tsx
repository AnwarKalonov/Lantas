import { useStore } from "../lib/store";
import { Icon } from "./Icons";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

interface TitleBarProps {
  title: string;
  onOpenPalette: () => void;
  onOpenSettings: () => void;
}

export function TitleBar({ title, onOpenPalette, onOpenSettings }: TitleBarProps) {
  const { state, toggleSidebar, togglePanel, setSettings } = useStore();
  const nextTheme = state.settings.theme === "light" ? "dark" : "light";

  return (
    <header className="titlebar" data-tauri-drag-region>
      {!inTauri && (
        <div className="traffic" aria-hidden="true">
          <span className="light light-close" />
          <span className="light light-min" />
          <span className="light light-zoom" />
        </div>
      )}

      <div className="titlebar-left" data-tauri-drag-region>
        <span className="crumb">lantas</span>
        <span className="crumb-sep">/</span>
        <span className="crumb-current">{title}</span>
      </div>

      <button className="titlebar-search" onClick={onOpenPalette} type="button">
        <Icon name="search" size={14} />
        <span>Search</span>
        <kbd>⌘K</kbd>
      </button>

      <div className="titlebar-right">
        <button
          className="icon-button"
          onClick={() => setSettings({ theme: nextTheme })}
          title={`Switch to ${nextTheme} theme`}
          aria-label={`Switch to ${nextTheme} theme`}
          type="button"
        >
          <Icon name={state.settings.theme === "light" ? "moon" : "sun"} size={15} />
        </button>
        <button
          className={`icon-button ${state.sidebarOpen ? "is-on" : ""}`}
          onClick={toggleSidebar}
          title="Toggle sidebar (⌘B)"
          aria-label="Toggle sidebar"
          type="button"
        >
          <Icon name="panelLeft" size={16} />
        </button>
        <button
          className={`icon-button ${state.panelOpen ? "is-on" : ""}`}
          onClick={togglePanel}
          title="Toggle context panel (⌘⇧B)"
          aria-label="Toggle context panel"
          type="button"
        >
          <Icon name="panelRight" size={16} />
        </button>
        <button
          className="icon-button"
          onClick={onOpenSettings}
          title="Settings (⌘,)"
          aria-label="Settings"
          type="button"
        >
          <Icon name="settings" size={16} />
        </button>
      </div>
    </header>
  );
}
