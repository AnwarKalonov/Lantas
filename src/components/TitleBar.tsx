import { useStore } from "../lib/store";
import type { Mode } from "../lib/types";
import { cx } from "../lib/util";
import { Icon } from "./Icons";
import { UpdatePill } from "./UpdatePill";

interface TitleBarProps {
  title: string;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  onOpenPalette: () => void;
  onOpenSettings: () => void;
}

export function TitleBar({
  title,
  mode,
  onModeChange,
  onOpenPalette,
  onOpenSettings,
}: TitleBarProps) {
  const { state, toggleSidebar, togglePanel, setSettings } = useStore();
  const nextTheme = state.settings.theme === "light" ? "dark" : "light";

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-left" data-tauri-drag-region>
        <span className="crumb-current">{title}</span>
        <UpdatePill />
      </div>

      <div className="mode-tabs" role="tablist" aria-label="Workspace mode">
        {(
          [
            { id: "chat", label: "Chat", icon: "message" },
            { id: "code", label: "Code", icon: "terminal" },
            { id: "browser", label: "Browser", icon: "compass" },
          ] as Array<{ id: Mode; label: string; icon: "message" | "terminal" | "compass" }>
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={mode === item.id}
            className={cx("mode-tab", mode === item.id && "is-active")}
            onClick={() => onModeChange(item.id)}
          >
            <Icon name={item.icon} size={14} />
            {item.label}
          </button>
        ))}
      </div>

      <div className="titlebar-right">
        <button
          className="icon-button"
          onClick={onOpenPalette}
          title="Command palette (⌘K)"
          aria-label="Command palette"
          type="button"
        >
          <Icon name="search" size={15} />
        </button>
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
