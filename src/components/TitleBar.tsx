import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import type { Mode, Scope, Workspace } from "../lib/types";
import { cx } from "../lib/util";
import { Icon } from "./Icons";
import { MarkGlyph } from "./Brand";
import { UpdatePill } from "./UpdatePill";

interface TitleBarProps {
  title: string;
  mode: Mode;
  scope: Scope;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  onModeChange: (mode: Mode) => void;
  onScopeChange: (scope: Scope) => void;
  onSelectWorkspace: (id: string) => void;
  onAddWorkspace: () => void;
  onOpenPalette: () => void;
  onOpenSettings: () => void;
  onOpenCli: () => void;
}

/**
 * OpenWork-style title bar: the surface switch sits where the old Chat tab
 * was, and a workspace switcher appears beside it while a project is open.
 */
export function TitleBar({
  title,
  mode,
  scope,
  workspaces,
  activeWorkspaceId,
  onModeChange,
  onScopeChange,
  onSelectWorkspace,
  onAddWorkspace,
  onOpenPalette,
  onOpenSettings,
  onOpenCli,
}: TitleBarProps) {
  const { state, toggleSidebar, togglePanel, setSettings } = useStore();
  const nextTheme = state.settings.theme === "light" ? "dark" : "light";
  const [menu, setMenu] = useState<"scope" | "workspace" | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const active = workspaces.find((workspace) => workspace.id === activeWorkspaceId);

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [menu]);

  return (
    <header className={cx("titlebar ow-titlebar", mode === "code" && "is-code")} data-tauri-drag-region>
      <div className="titlebar-left ow-title-left" data-tauri-drag-region>
        <MarkGlyph size={16} className="titlebar-mark" />
        <span className="ow-title-text">{title}</span>
        <span className="ow-title-crumb">
          {scope === "workspace" ? (active?.name ?? "Workspace") : "Chat"}
        </span>
        <UpdatePill />
      </div>

      <div className="ow-surface-switch" ref={menuRef}>
        <button
          type="button"
          className={cx("ow-scope-button", menu === "scope" && "is-open")}
          onClick={() => setMenu(menu === "scope" ? null : "scope")}
          aria-haspopup="menu"
          aria-expanded={menu === "scope"}
        >
          <Icon name={scope === "workspace" ? "folder" : "message"} size={14} />
          <span>{scope === "workspace" ? "Workspace" : "Chat"}</span>
          <Icon name="chevronDown" size={12} />
        </button>

        {scope === "workspace" && (
          <button
            type="button"
            className={cx("ow-workspace-switch", menu === "workspace" && "is-open")}
            onClick={() => setMenu(menu === "workspace" ? null : "workspace")}
            aria-haspopup="menu"
            aria-expanded={menu === "workspace"}
          >
            <span
              className="ow-ws-dot"
              style={{ background: active?.color ?? "var(--text-4)" }}
              aria-hidden="true"
            />
            <span>{active?.name ?? "Choose workspace"}</span>
            <Icon name="chevronDown" size={12} />
          </button>
        )}

        {menu === "scope" && (
          <div className="ow-menu ow-scope-menu" role="menu">
            <button
              type="button"
              role="menuitemradio"
              aria-checked={scope === "chat"}
              className={cx("ow-menu-row", scope === "chat" && "is-active")}
              onClick={() => {
                onScopeChange("chat");
                setMenu(null);
              }}
            >
              <span className="ow-menu-icon">
                <Icon name="message" size={15} />
              </span>
              <span className="ow-menu-copy">
                <span className="ow-menu-title">Chat</span>
                <span className="ow-menu-sub">One-off questions, no project attached</span>
              </span>
              {scope === "chat" && <Icon name="check" size={14} />}
            </button>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={scope === "workspace"}
              className={cx("ow-menu-row", scope === "workspace" && "is-active")}
              onClick={() => {
                onScopeChange("workspace");
                setMenu(null);
              }}
            >
              <span className="ow-menu-icon">
                <Icon name="folder" size={15} />
              </span>
              <span className="ow-menu-copy">
                <span className="ow-menu-title">Workspace</span>
                <span className="ow-menu-sub">A project folder with its own chats</span>
              </span>
              {scope === "workspace" && <Icon name="check" size={14} />}
            </button>
            <div className="ow-menu-sep" />
            <button
              type="button"
              className="ow-menu-row ow-menu-quiet"
              onClick={() => {
                setMenu(null);
                onAddWorkspace();
              }}
            >
              <span className="ow-menu-icon">
                <Icon name="plus" size={15} />
              </span>
              <span className="ow-menu-copy">
                <span className="ow-menu-title">New workspace</span>
              </span>
            </button>
          </div>
        )}

        {menu === "workspace" && (
          <div className="ow-menu ow-workspace-menu" role="menu">
            <div className="ow-menu-label">Workspaces</div>
            {workspaces.map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                role="menuitemradio"
                aria-checked={workspace.id === activeWorkspaceId}
                className={cx(
                  "ow-menu-row",
                  workspace.id === activeWorkspaceId && "is-active",
                )}
                onClick={() => {
                  onSelectWorkspace(workspace.id);
                  setMenu(null);
                }}
              >
                <span className="ow-ws-dot" style={{ background: workspace.color }} />
                <span className="ow-menu-copy">
                  <span className="ow-menu-title">{workspace.name}</span>
                  <span className="ow-menu-sub ow-path">{workspace.root || "No folder yet"}</span>
                </span>
                {workspace.id === activeWorkspaceId && <Icon name="check" size={14} />}
              </button>
            ))}
            <div className="ow-menu-sep" />
            <button
              type="button"
              className="ow-menu-row"
              onClick={() => {
                setMenu(null);
                onAddWorkspace();
              }}
            >
              <span className="ow-menu-icon">
                <Icon name="plus" size={15} />
              </span>
              <span className="ow-menu-copy">
                <span className="ow-menu-title">New workspace</span>
                <span className="ow-menu-sub">Pick a folder to work in</span>
              </span>
            </button>
          </div>
        )}
      </div>

      <div className="mode-tabs ow-mode-tabs" role="tablist" aria-label="Surface">
        {(
          [
            { id: "code", label: "Code", icon: "terminal" },
            { id: "browser", label: "Browser", icon: "compass" },
          ] as Array<{ id: Mode; label: string; icon: "terminal" | "compass" }>
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={mode === item.id}
            className={cx("mode-tab", mode === item.id && "is-active")}
            onClick={() => onModeChange(item.id)}
          >
            <Icon name={item.icon} size={13} />
            {item.label}
          </button>
        ))}
      </div>

      <div className="titlebar-right ow-title-right">
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
              title="Toggle sidebar panel (⌘⇧B)"
              aria-label="Toggle right panel"
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
