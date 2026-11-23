import { useEffect, useMemo, useRef, useState } from "react";
import { PROVIDERS } from "../lib/data";
import { isConfigured, isFreeModel, prettyModel } from "../lib/providers";
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
}: {
  provider: ProviderId;
  model: string;
  onPick: (provider: ProviderId, model: string) => void;
  onConnect: () => void;
  className?: string;
  align?: "left" | "right";
}) {
  const { state } = useStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
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
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`${PROVIDERS.find((meta) => meta.id === provider)?.name ?? "Provider"} · ${prettyModel(model)}`}
      >
        <span className="mp-label">{prettyModel(model) || "Choose model"}</span>
        <Icon name="chevronDown" size={11} />
      </button>

      {open && (
        <div className={cx("mp-menu", align === "right" && "is-right")} role="listbox">
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
                  : "No provider connected yet. Add a key once and it appears here."}
              </p>
            )}
          </div>

          <button type="button" className="mp-manage" onClick={onConnect}>
            Manage providers
            <Icon name="chevronRight" size={11} />
          </button>
        </div>
      )}
    </div>
  );
}
