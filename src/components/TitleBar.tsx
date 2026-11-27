import { motion } from "motion/react";
import { useStore } from "../lib/store";
import type { Mode } from "../lib/types";
import { cx } from "../lib/util";
import { Icon } from "./Icons";
import { MarkGlyph } from "./Brand";
import { UpdatePill } from "./UpdatePill";

interface TitleBarProps {
  title: string;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  onOpenPalette: () => void;
  onOpenSettings: () => void;
  onOpenCli: () => void;
}

export function TitleBar({
  title,
  mode,
  onModeChange,
  onOpenPalette,
  onOpenSettings,
  onOpenCli,
}: TitleBarProps) {
  const { state, toggleSidebar, togglePanel, setSettings } = useStore();
  const nextTheme = state.settings.theme === "light" ? "dark" : "light";

  return (
    <header className={cx("titlebar", mode === "code" && "is-code")} data-tauri-drag-region>
      <div className="titlebar-left" data-tauri-drag-region>
        <MarkGlyph size={14} className="titlebar-mark" />
        <span className="crumb-current">{title}</span>
        <UpdatePill />
      </div>

      <div className="mode-tabs" role="tablist" aria-label="Workspace mode">
        {(
          [
            // Chat sits in the middle on purpose: it is the app's home, and
            // the switcher reads symmetrically from either side of it.
            { id: "code", label: "Code", icon: "terminal" },
            { id: "chat", label: "Chat", icon: "message" },
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
            {mode === item.id ? (
              <motion.span
                layoutId="mode-tab-pill"
                className="mode-tab-pill"
                transition={{ type: "spring", stiffness: 520, damping: 38, mass: 0.7 }}
                aria-hidden="true"
              />
            ) : null}
            <span className="mode-tab-icon">
              <Icon name={item.icon} size={14} />
            </span>
            <span className="mode-tab-label">{item.label}</span>
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
          onClick={onOpenCli}
          title="Open the Lantas CLI in Terminal"
          aria-label="Open the Lantas CLI in Terminal"
          type="button"
        >
          <Icon name="terminal" size={15} />
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
        {mode !== "code" && (
          <>
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
          </>
        )}
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
