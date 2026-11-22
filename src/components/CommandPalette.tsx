import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { cx } from "../lib/util";
import { Icon, type IconName } from "./Icons";
import type { SettingsTab } from "./SettingsModal";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onOpenSettings: (tab: SettingsTab) => void;
  onPrompt: (text: string) => void;
}

interface Item {
  id: string;
  group: string;
  title: string;
  hint?: string;
  icon: IconName;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  onOpenSettings,
  onPrompt,
}: CommandPaletteProps) {
  const { state, createSession, selectSession, toggleSidebar, togglePanel, setView, setSettings, notify } =
    useStore();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo<Item[]>(() => {
    const actions: Item[] = [
      {
        id: "new",
        group: "Actions",
        title: "New session",
        hint: "⌘N",
        icon: "plus",
        run: () => createSession(),
      },
      {
        id: "theme",
        group: "Actions",
        title: state.settings.theme === "light" ? "Switch to dark theme" : "Switch to light theme",
        icon: state.settings.theme === "light" ? "moon" : "sun",
        run: () => setSettings({ theme: state.settings.theme === "light" ? "dark" : "light" }),
      },
      {
        id: "providers",
        group: "Actions",
        title: "Connect a provider",
        icon: "key",
        run: () => onOpenSettings("providers"),
      },
      {
        id: "skills-nav",
        group: "Actions",
        title: "Open skills",
        icon: "book",
        run: () => setView("skills"),
      },
      {
        id: "integrations-nav",
        group: "Actions",
        title: "Open integrations",
        icon: "plug",
        run: () => setView("integrations"),
      },
      {
        id: "sidebar",
        group: "Actions",
        title: state.sidebarOpen ? "Hide sidebar" : "Show sidebar",
        hint: "⌘B",
        icon: "panelLeft",
        run: () => toggleSidebar(),
      },
      {
        id: "panel",
        group: "Actions",
        title: state.panelOpen ? "Hide context panel" : "Show context panel",
        hint: "⌘⇧B",
        icon: "panelRight",
        run: () => togglePanel(),
      },
      {
        id: "settings",
        group: "Actions",
        title: "Open settings",
        hint: "⌘,",
        icon: "settings",
        run: () => onOpenSettings("general"),
      },
    ];

    const sessions: Item[] = state.sessions.slice(0, 8).map((session) => ({
      id: `s-${session.id}`,
      group: "Sessions",
      title: session.title,
      hint: session.branch,
      icon: "message",
      run: () => {
        setView("chats");
        selectSession(session.id);
      },
    }));

    const commands: Item[] = [
      {
        id: "c-init",
        group: "Commands",
        title: "/init",
        hint: "Write AGENTS.md",
        icon: "file",
        run: () =>
          onPrompt(
            "Scan this repository and write an AGENTS.md covering architecture, commands and conventions.",
          ),
      },
      {
        id: "c-review",
        group: "Commands",
        title: "/review",
        hint: "Review the working tree",
        icon: "diff",
        run: () =>
          onPrompt(
            "Review the uncommitted changes and flag anything that would break in production.",
          ),
      },
      {
        id: "c-fix",
        group: "Commands",
        title: "/fix",
        hint: "Reproduce and fix a failing check",
        icon: "wrench",
        run: () => onPrompt("The typecheck is failing. Reproduce it, find the cause and fix it."),
      },
      {
        id: "c-compact",
        group: "Commands",
        title: "/compact",
        hint: "Free context",
        icon: "refresh",
        run: () => notify("Session compacted"),
      },
      {
        id: "c-clear",
        group: "Commands",
        title: "/clear",
        hint: "Start fresh",
        icon: "close",
        run: () => createSession(),
      },
    ];

    return [...actions, ...sessions, ...commands];
  }, [
    state.sessions,
    state.sidebarOpen,
    state.panelOpen,
    state.settings.theme,
    createSession,
    selectSession,
    toggleSidebar,
    togglePanel,
    setView,
    setSettings,
    notify,
    onOpenSettings,
    onPrompt,
  ]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) =>
      `${item.title} ${item.hint ?? ""} ${item.group}`.toLowerCase().includes(term),
    );
  }, [items, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => setIndex(0), [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(".palette-row.is-selected");
    el?.scrollIntoView({ block: "nearest" });
  }, [index]);

  if (!open) return null;

  const groups = filtered.reduce<Record<string, Item[]>>((acc, item) => {
    (acc[item.group] ??= []).push(item);
    return acc;
  }, {});

  let flatIndex = -1;

  const choose = (item: Item) => {
    onClose();
    item.run();
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="palette"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Command palette"
      >
        <div className="palette-input">
          <Icon name="search" size={15} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search sessions, actions and commands"
            spellCheck={false}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setIndex((value) => Math.min(value + 1, filtered.length - 1));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setIndex((value) => Math.max(value - 1, 0));
              }
              if (event.key === "Enter") {
                event.preventDefault();
                const item = filtered[index];
                if (item) choose(item);
              }
            }}
          />
          <kbd>esc</kbd>
        </div>

        <div className="palette-list" ref={listRef}>
          {Object.entries(groups).map(([group, groupItems]) => (
            <div className="palette-group" key={group}>
              <div className="palette-group-label">{group}</div>
              {groupItems.map((item) => {
                flatIndex += 1;
                const isSelected = flatIndex === index;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={cx("palette-row", isSelected && "is-selected")}
                    onMouseEnter={() => setIndex(flatIndex)}
                    onClick={() => choose(item)}
                  >
                    <span className="palette-icon">
                      <Icon name={item.icon} size={14} />
                    </span>
                    <span className="palette-title">{item.title}</span>
                    {item.hint && <span className="palette-hint">{item.hint}</span>}
                  </button>
                );
              })}
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="palette-empty">Nothing matches “{query}”</div>
          )}
        </div>

        <div className="palette-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span className="palette-foot-right">Lantas commands</span>
        </div>
      </div>
    </div>
  );
}
