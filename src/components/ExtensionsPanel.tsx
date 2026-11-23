import { useCallback, useEffect, useMemo, useState } from "react";
import { openExternal } from "../lib/native";
import { useStore } from "../lib/store";
import {
  editorFromVSCode,
  extensionTags,
  keybindingCount,
  readVSCode,
  type VSCodeExtension,
  type VSCodeImport,
} from "../lib/vscode";
import { cx } from "../lib/util";
import { Icon } from "./Icons";

/**
 * VS Code setup, carried into Lantas.
 *
 * Monaco is VS Code's editor, so editor behaviour imports exactly. Extension
 * code needs VS Code's extension host; themes, snippets and language metadata
 * are read and shown, and the panel is explicit about the difference.
 */
export function ExtensionsPanel() {
  const { state, setSettings, notify } = useStore();
  const [data, setData] = useState<VSCodeImport | null>(null);
  const [busy, setBusy] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setBusy("read");
    setError("");
    try {
      setData(await readVSCode());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy("");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const importSettings = () => {
    if (!data) return;
    const mapped = editorFromVSCode(data.settings);
    if (!mapped.applied.length) {
      notify("No supported VS Code editor settings were found", "error");
      return;
    }
    setSettings({
      editor: { ...state.settings.editor, ...mapped.editor },
      ...(mapped.theme ? { theme: mapped.theme } : {}),
    });
    notify(
      `Imported ${mapped.applied.join(", ")}${
        mapped.ignored.length ? ` · ${mapped.ignored.length} ignored` : ""
      }`,
    );
  };

  const extensions = useMemo(() => {
    const list = data?.extensions ?? [];
    const term = query.trim().toLowerCase();
    return term
      ? list.filter((item) =>
          `${item.name} ${item.publisher} ${item.id} ${item.description}`
            .toLowerCase()
            .includes(term),
        )
      : list;
  }, [data, query]);

  const supported = (extensions ?? []).filter(
    (extension: VSCodeExtension) => extensionTags(extension).length > 0,
  ).length;

  return (
    <div className="ide-ext-panel">
      <div className="ide-side-head">
        <span>VS Code</span>
        <button
          type="button"
          className="ide-icon-button small"
          onClick={() => void load()}
          title="Read VS Code again"
          aria-label="Read VS Code again"
        >
          <Icon name="refresh" size={12} />
        </button>
      </div>

      {error && <p className="ide-git-error">{error}</p>}
      {busy === "read" && !data && <p className="ide-side-note">Reading your VS Code setup…</p>}

      {data && (
        <>
          {data.found ? (
            <div className="ide-ext-summary">
              <p className="ide-ext-found">
                <span className="status-dot is-ok" />
                VS Code settings found
              </p>
              <p className="ide-side-note">
                {keybindingCount(data.keybindings)} keybindings · {data.extensions.length} extensions
              </p>
              <button
                type="button"
                className="button-primary small"
                onClick={importSettings}
                disabled={busy === "import"}
              >
                Import editor settings
              </button>
              <p className="ide-ext-path" title={data.settings_path}>
                {data.settings_path}
              </p>
            </div>
          ) : (
            <div className="ide-ext-summary">
              <p className="ide-side-note">
                VS Code's settings folder was not found on this Mac. Lantas still works with its
                own defaults.
              </p>
            </div>
          )}

          <div className="ide-side-head is-sub">
            <span>Extensions</span>
            <span className="ide-count">{supported} supported</span>
          </div>

          <label className="ide-search-input">
            <Icon name="search" size={13} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter extensions"
              spellCheck={false}
            />
          </label>

          <div className="ide-ext-list">
            {extensions.map((extension) => {
              const tags = extensionTags(extension);
              return (
                <div className="ide-ext-row" key={`${extension.id}-${extension.path}`}>
                  <span className="ide-ext-mark" aria-hidden="true">
                    {extension.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="ide-ext-text">
                    <span className="ide-ext-name">{extension.name}</span>
                    <span className="ide-ext-meta">
                      {extension.publisher || "local"} · v{extension.version || "—"}
                    </span>
                  </span>
                  <span className={cx("ide-ext-tag", tags.length === 0 && "is-off")}>
                    {tags.length ? tags.join(" · ") : "Needs VS Code"}
                  </span>
                </div>
              );
            })}
            {extensions.length === 0 && (
              <p className="ide-side-note">
                {query ? "No extension matches that filter." : "No VS Code extensions installed."}
              </p>
            )}
          </div>

          <div className="ide-ext-note">
            <p>
              Monaco is VS Code's editor, so fonts, tabs, wrapping, minimap, theme and keybindings
              carry over. Extensions that run code need VS Code's extension host; Lantas shows
              what each one contributes instead of pretending to run it.
            </p>
            <button
              type="button"
              className="text-button"
              onClick={() => void openExternal("https://marketplace.visualstudio.com/vscode")}
            >
              Browse the VS Code marketplace
              <Icon name="external" size={11} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
