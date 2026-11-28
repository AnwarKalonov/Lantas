import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PROVIDERS } from "../lib/data";
import { isConfigured, isFreeModel, listModels, prettyModel } from "../lib/providers";
import { useStore } from "../lib/store";
import type { ProviderId } from "../lib/types";
import { cx } from "../lib/util";
import { Icon } from "./Icons";

/**
 * Compact model picker for side panels. One button, one list, grouped by
 * provider; providers that are not connected point at Settings instead of
 * pretending to work.
 */
export function ModelPicker({
  provider,
  model,
  onPick,
  onConnect,
  className,
  align = "left",
  placement = "up",
}: {
  provider: ProviderId;
  model: string;
  onPick: (provider: ProviderId, model: string) => void;
  onConnect: () => void;
  className?: string;
  align?: "left" | "right";
  /** Open below the trigger for pickers that sit at the top of a panel. */
  placement?: "up" | "down";
}) {
  const { state, setSettings } = useStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const asked = useRef<Set<string>>(new Set());
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  // A side panel can sit anywhere: at the top of the window, beside a rail or
  // under the composer. The list is rendered in a portal at a measured spot,
  // so a rail's overflow can never clip it and it always fits on screen.
  const [place, setPlace] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    maxHeight: number;
  }>({ left: 0, maxHeight: 424 });

  const openMenu = () => {
    const rect = root.current?.getBoundingClientRect();
    if (rect) {
      const width = Math.min(306, window.innerWidth - 24);
      const left = Math.min(
        Math.max(align === "right" ? rect.right - width : rect.left, 12),
        Math.max(12, window.innerWidth - width - 12),
      );
      const above = Math.max(0, rect.top - 16);
      const below = Math.max(0, window.innerHeight - rect.bottom - 16);
      const down = placement === "down" ? below > 180 : below > above;
      setPlace({
        left,
        ...(down
          ? { top: rect.bottom + 7, bottom: undefined }
          : { bottom: window.innerHeight - rect.top + 7, top: undefined }),
        maxHeight: Math.min(424, down ? below : above),
      });
    }
    setOpen(true);
  };

  // A provider can be connected but still show an empty list until its
  // "Test connection" has run. Asking its /models endpoint when the picker
  // opens is what lets a model be chosen from the IDE or the chat without a
  // detour through Settings.
  useEffect(() => {
    if (!open) return;
    const missing = PROVIDERS.filter((meta) => {
      const config = state.settings.providers[meta.id];
      return (
        isConfigured(meta.id, config) &&
        config.models.length === 0 &&
        !asked.current.has(meta.id)
      );
    });
    if (!missing.length) return;
    let alive = true;
    setDiscovering(true);
    void Promise.all(
      missing.map(async (meta) => {
        asked.current.add(meta.id);
        const config = state.settings.providers[meta.id];
        try {
          const result = await listModels(meta.id, config);
          if (!alive || !result.ok || !result.models?.length) return null;
          return { id: meta.id, models: result.models, config };
        } catch {
          return null;
        }
      }),
    ).then((found) => {
      if (!alive) return;
      setDiscovering(false);
      const updates = found.filter(Boolean) as Array<{
        id: ProviderId;
        models: string[];
        config: (typeof state.settings.providers)[ProviderId];
      }>;
      if (!updates.length) return;
      const providers = { ...state.settings.providers };
      for (const update of updates) {
        providers[update.id] = { ...update.config, models: update.models };
      }
      setSettings({ providers });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, state.settings.providers]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !menu.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const term = query.trim().toLowerCase();
  const groups = useMemo(
    () =>
      PROVIDERS.map((meta) => {
        const config = state.settings.providers[meta.id];
        const ready = isConfigured(meta.id, config);
        const models = Array.from(new Set([...config.models, ...meta.models]))
          .filter(
            (entry) =>
              !term ||
              entry.toLowerCase().includes(term) ||
              prettyModel(entry).toLowerCase().includes(term) ||
              meta.name.toLowerCase().includes(term),
          )
          .slice(0, 40);
        return { meta, ready, models };
      }).filter((group) => group.ready && group.models.length > 0),
    [state.settings.providers, term],
  );

  return (
    <div className={cx("mp", className)} ref={root}>
      <button
        type="button"
        className={cx("mp-trigger", open && "is-open")}
        onClick={() => (open ? setOpen(false) : openMenu())}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`${PROVIDERS.find((meta) => meta.id === provider)?.name ?? "Provider"} · ${prettyModel(model)}`}
      >
        <span className="mp-label">{prettyModel(model) || "Choose model"}</span>
        <Icon name="chevronDown" size={11} />
      </button>

      {open && createPortal(
        <div
          ref={menu}
          className="mp-menu is-portal"
          style={{
            left: place.left,
            top: place.top ?? "auto",
            bottom: place.bottom ?? "auto",
            maxHeight: place.maxHeight,
          }}
          role="listbox"
        >
          <label className="mp-search">
            <Icon name="search" size={12} />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter models"
              spellCheck={false}
              aria-label="Filter models"
            />
          </label>

          <div className="mp-list">
            {groups.map(({ meta, models }) => (
              <div className="mp-group" key={meta.id}>
                <div className="mp-group-head">{meta.name}</div>
                {models.map((entry) => {
                  const active = meta.id === provider && entry === model;
                  return (
                    <button
                      key={`${meta.id}-${entry}`}
                      type="button"
                      className={cx("mp-row", active && "is-active")}
                      role="option"
                      aria-selected={active}
                      onClick={() => {
                        onPick(meta.id, entry);
                        setOpen(false);
                        setQuery("");
                      }}
                    >
                      <span className="mp-row-name">{prettyModel(entry)}</span>
                      {isFreeModel(meta.id, entry) && <span className="mp-free">free</span>}
                      {active && <Icon name="check" size={12} />}
                    </button>
                  );
                })}
              </div>
            ))}

            {groups.length === 0 && (
              <p className="mp-empty">
                {term
                  ? "No connected model matches that filter."
                  : discovering
                    ? "Reading this provider's model list…"
                    : "No provider connected yet. Add a key once and it appears here."}
              </p>
            )}
          </div>

          <button type="button" className="mp-manage" onClick={onConnect}>
            Manage providers
            <Icon name="chevronRight" size={11} />
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
