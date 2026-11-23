import { useMemo, useRef, useState } from "react";
import { PLUGIN_CATALOG, installedPlugins, pluginSkills } from "../lib/plugins";
import { useStore } from "../lib/store";
import { parseSkillZip } from "../lib/skills";
import type { Plugin, Skill, SkillCategory } from "../lib/types";
import { cx, uid } from "../lib/util";
import { Icon } from "./Icons";

const CATEGORIES: Array<{ id: SkillCategory | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "engineering", label: "Engineering" },
  { id: "security", label: "Security" },
  { id: "data", label: "Data" },
  { id: "writing", label: "Writing" },
  { id: "design", label: "Design" },
  { id: "product", label: "Product" },
];

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  CATEGORIES.filter((item) => item.id !== "all").map((item) => [item.id, item.label]),
);

interface Draft {
  id: string | null;
  name: string;
  description: string;
  instructions: string;
  category: SkillCategory;
}

const EMPTY_DRAFT: Draft = {
  id: null,
  name: "",
  description: "",
  instructions: "",
  category: "engineering",
};

function slug(name: string) {
  return name
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9/_-]/g, "")
    .toLowerCase();
}

export function SkillsView() {
  const { state, addSkill, updateSkill, deleteSkill, notify } = useStore();
  const [tab, setTab] = useState<"library" | "plugins">("library");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<SkillCategory | "all">("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const installed = useMemo(() => installedPlugins(state.skills), [state.skills]);
  const activeCount = state.skills.filter((skill) => skill.enabled).length;

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return state.skills.filter((skill) => {
      if (category !== "all" && (skill.category ?? "engineering") !== category) return false;
      if (!term) return true;
      return `${skill.name} ${skill.description} ${skill.instructions.slice(0, 400)}`
        .toLowerCase()
        .includes(term);
    });
  }, [state.skills, query, category]);

  const current =
    state.skills.find((skill) => skill.id === selected) ?? visible[0] ?? null;

  const plugins = useMemo(() => {
    const term = query.trim().toLowerCase();
    return PLUGIN_CATALOG.filter((plugin) => {
      if (category !== "all" && plugin.category !== category) return false;
      if (!term) return true;
      return `${plugin.name} ${plugin.description} ${plugin.skills.map((skill) => skill.name).join(" ")}`
        .toLowerCase()
        .includes(term);
    });
  }, [query, category]);

  const importFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setImporting(true);
    let added = 0;
    for (const file of Array.from(list)) {
      try {
        const parsed = await parseSkillZip(file);
        parsed.forEach((item) => {
          const name = slug(item.name);
          if (!name || state.skills.some((existing) => existing.name === name)) return;
          addSkill({
            id: uid("skill"),
            name,
            description: item.description,
            instructions: item.instructions,
            enabled: true,
            category: "engineering",
            source: "custom",
          });
          added += 1;
        });
      } catch {
        notify(`${file.name} could not be read`, "error");
      }
    }
    setImporting(false);
    notify(
      added ? `${added} skill${added === 1 ? "" : "s"} added` : "No SKILL.md found in that file",
      added ? "default" : "error",
    );
  };

  const startCreate = () => {
    setTab("library");
    setSelected(null);
    setDraft({ ...EMPTY_DRAFT });
  };

  const saveDraft = () => {
    if (!draft) return;
    const name = slug(draft.name);
    if (!name) {
      notify("A skill needs a name", "error");
      return;
    }
    if (!draft.instructions.trim()) {
      notify("Write the instructions the agent should follow", "error");
      return;
    }
    if (draft.id) {
      updateSkill(draft.id, {
        name,
        description: draft.description.trim() || "Custom skill",
        instructions: draft.instructions.trim(),
        category: draft.category,
      });
      notify(`/${name} updated`);
      setSelected(draft.id);
    } else {
      const skill: Skill = {
        id: uid("skill"),
        name,
        description: draft.description.trim() || "Custom skill",
        instructions: draft.instructions.trim(),
        enabled: true,
        category: draft.category,
        source: "custom",
      };
      addSkill(skill);
      setSelected(skill.id);
      notify(`/${name} added`);
    }
    setDraft(null);
  };

  const startEdit = (skill: Skill) => {
    setDraft({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      instructions: skill.instructions,
      category: skill.category ?? "engineering",
    });
  };

  const install = (plugin: Plugin) => {
    let added = 0;
    pluginSkills(plugin).forEach((skill) => {
      if (state.skills.some((existing) => existing.name === skill.name)) return;
      addSkill(skill);
      added += 1;
    });
    notify(
      added
        ? `${plugin.name}: ${added} skill${added === 1 ? "" : "s"} installed`
        : `${plugin.name} is already installed`,
    );
  };

  const removePlugin = (plugin: Plugin) => {
    state.skills
      .filter((skill) => skill.pluginId === plugin.id)
      .forEach((skill) => deleteSkill(skill.id));
    notify(`${plugin.name} removed`);
  };

  const useSkill = (skill: Skill) => {
    navigator.clipboard?.writeText(`/${skill.name} `).catch(() => {});
    notify(`/${skill.name} copied — paste it in the composer with your task`);
  };

  return (
    <div className="page skills-page">
      <header className="page-head">
        <div>
          <h1>Skills</h1>
          <p className="page-lede">
            Procedures the agent follows while they are on. Each one names what to read, the order
            to work in, and what to verify before it answers.
          </p>
        </div>
        <div className="page-head-actions">
          <input
            ref={fileRef}
            type="file"
            accept=".zip,.md"
            multiple
            hidden
            onChange={(event) => {
              void importFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            className="button-quiet"
            disabled={importing}
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="plus" size={14} />
            {importing ? "Reading" : "Import .zip"}
          </button>
          <button type="button" className="button-primary" onClick={startCreate}>
            <Icon name="plus" size={14} />
            New skill
          </button>
        </div>
      </header>

      <div className="page-body skills-body">
        <div className="skills-stats">
          <div className="skills-stat">
            <span className="skills-stat-value">{activeCount}</span>
            <span className="skills-stat-label">Active in every run</span>
          </div>
          <div className="skills-stat">
            <span className="skills-stat-value">{state.skills.length}</span>
            <span className="skills-stat-label">In the library</span>
          </div>
          <div className="skills-stat">
            <span className="skills-stat-value">{installed.size}</span>
            <span className="skills-stat-label">Plugin packs installed</span>
          </div>
          <div className="skills-stats-note">
            Enabled skills are added to the system prompt. Disabled ones stay available through the
            <code> skill </code> tool.
          </div>
        </div>

        <div className="skills-toolbar">
          <div className="skills-tabs" role="tablist" aria-label="Skills sections">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "library"}
              className={cx("skills-tab", tab === "library" && "is-active")}
              onClick={() => setTab("library")}
            >
              Library
              <span className="skills-tab-count">{state.skills.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "plugins"}
              className={cx("skills-tab", tab === "plugins" && "is-active")}
              onClick={() => setTab("plugins")}
            >
              Plugins
              <span className="skills-tab-count">{PLUGIN_CATALOG.length}</span>
            </button>
          </div>

          <label className="skills-search">
            <Icon name="search" size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tab === "library" ? "Search skills" : "Search plugins"}
              spellCheck={false}
            />
          </label>
        </div>

        <div className="skills-filters" role="group" aria-label="Filter by category">
          {CATEGORIES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cx("skills-filter", category === item.id && "is-active")}
              onClick={() => setCategory(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {draft && tab === "library" && (
          <div className="skill-editor-panel">
            <div className="skill-editor-head">
              <h2>{draft.id ? "Edit skill" : "New skill"}</h2>
              <button
                type="button"
                className="icon-button"
                onClick={() => setDraft(null)}
                aria-label="Close editor"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
            <div className="field-row">
              <label className="field">
                <span>Name</span>
                <input
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder="migration-check"
                  autoFocus
                />
              </label>
              <label className="field">
                <span>Category</span>
                <select
                  value={draft.category}
                  onChange={(event) =>
                    setDraft({ ...draft, category: event.target.value as SkillCategory })
                  }
                >
                  {CATEGORIES.filter((item) => item.id !== "all").map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field">
              <span>Description</span>
              <input
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                placeholder="Verify a migration before it ships"
              />
            </label>
            <label className="field">
              <span>Instructions</span>
              <textarea
                rows={9}
                value={draft.instructions}
                onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
                placeholder={
                  "Purpose: …\nProcedure: read …, then …\nCheck: …\nReport: …\nVerify: …"
                }
              />
            </label>
            <div className="form-actions">
              <button type="button" className="button-primary" onClick={saveDraft}>
                {draft.id ? "Save changes" : "Add skill"}
              </button>
              <button type="button" className="button-quiet" onClick={() => setDraft(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {tab === "library" ? (
          <div className="skills-split">
            <div className="skills-list">
              {visible.map((skill) => (
                <div
                  key={skill.id}
                  role="button"
                  tabIndex={0}
                  className={cx(
                    "skill-row",
                    skill.id === current?.id && "is-selected",
                    skill.enabled && "is-on",
                  )}
                  onClick={() => {
                    setSelected(skill.id);
                    setDraft(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelected(skill.id);
                      setDraft(null);
                    }
                  }}
                >
                  <span className="skill-row-main">
                    <span className="skill-row-name">
                      <code>/{skill.name}</code>
                      {skill.builtin && <span className="tag">built-in</span>}
                      {skill.pluginId && <span className="tag">plugin</span>}
                    </span>
                    <span className="skill-row-desc">{skill.description}</span>
                  </span>
                  <span className="skill-row-side">
                    <span className="skill-row-cat">{CATEGORY_LABEL[skill.category ?? "engineering"]}</span>
                    <span
                      role="switch"
                      aria-checked={skill.enabled}
                      aria-label={`${skill.enabled ? "Disable" : "Enable"} ${skill.name}`}
                      className={cx("switch", skill.enabled && "is-on")}
                      onClick={(event) => {
                        event.stopPropagation();
                        updateSkill(skill.id, { enabled: !skill.enabled });
                      }}
                    >
                      <span className="switch-knob" />
                    </span>
                  </span>
                </div>
              ))}
              {visible.length === 0 && (
                <p className="empty-line">No skills match that filter.</p>
              )}
            </div>

            <div className="skill-detail">
              {current ? (
                <>
                  <div className="skill-detail-head">
                    <div>
                      <p className="skill-detail-kicker">
                        {CATEGORY_LABEL[current.category ?? "engineering"]}
                        {current.source === "plugin" ? " · plugin" : current.builtin ? " · built-in" : " · custom"}
                      </p>
                      <h2>/{current.name}</h2>
                      <p className="skill-detail-desc">{current.description}</p>
                    </div>
                    <span
                      role="switch"
                      aria-checked={current.enabled}
                      aria-label={`Toggle ${current.name}`}
                      className={cx("switch", current.enabled && "is-on")}
                      onClick={() => updateSkill(current.id, { enabled: !current.enabled })}
                    >
                      <span className="switch-knob" />
                    </span>
                  </div>

                  <div className="skill-detail-meta">
                    <span>{current.enabled ? "On — sent with every turn" : "Off — available on request"}</span>
                    {current.tags?.length ? <span>{current.tags.join(" · ")}</span> : null}
                  </div>

                  <div className="skill-detail-actions">
                    <button
                      type="button"
                      className="button-quiet"
                      onClick={() => useSkill(current)}
                    >
                      <Icon name="copy" size={13} />
                      Copy command
                    </button>
                    <button
                      type="button"
                      className="button-quiet"
                      onClick={() => startEdit(current)}
                    >
                      Edit
                    </button>
                    {!current.builtin && (
                      <button
                        type="button"
                        className="button-quiet danger"
                        onClick={() => {
                          deleteSkill(current.id);
                          setSelected(null);
                          notify(`/${current.name} deleted`);
                        }}
                      >
                        <Icon name="trash" size={13} />
                        Delete
                      </button>
                    )}
                  </div>

                  <pre className="skill-detail-code">{current.instructions}</pre>
                </>
              ) : (
                <div className="skill-detail-empty">
                  <p>Select a skill to read its procedure.</p>
                  <button type="button" className="text-button" onClick={startCreate}>
                    Create one
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="plugin-area">
            <div className="plugin-feature">
              <div className="plugin-feature-copy">
                <p className="plugin-kicker">Curated by Lantas</p>
                <h2>Packs, not prompts</h2>
                <p>
                  A pack is two to four skills that belong together, written to be read by an agent
                  that can read files and run tools. Install one and its skills appear in the
                  library, on by default.
                </p>
              </div>
              <div className="plugin-feature-list">
                {PLUGIN_CATALOG.filter((plugin) => plugin.featured)
                  .slice(0, 2)
                  .map((plugin) => (
                    <button
                      key={plugin.id}
                      type="button"
                      className="plugin-feature-item"
                      onClick={() => {
                        setQuery(plugin.name);
                        setCategory("all");
                      }}
                    >
                      <span>{plugin.name}</span>
                      <small>{plugin.skills.length} skills</small>
                    </button>
                  ))}
              </div>
            </div>

            <div className="plugin-grid">
              {plugins.map((plugin) => {
                const isInstalled = installed.has(plugin.id) || plugin.skills.every((skill) =>
                  state.skills.some((existing) => existing.name === skill.name),
                );
                return (
                  <article className={cx("plugin-card", isInstalled && "is-installed")} key={plugin.id}>
                    <div className="plugin-card-head">
                      <div>
                        <h3>{plugin.name}</h3>
                        <p className="plugin-publisher">
                          {plugin.publisher} · v{plugin.version}
                        </p>
                      </div>
                      {isInstalled ? (
                        <span className="plugin-installed">
                          <Icon name="check" size={12} /> Installed
                        </span>
                      ) : (
                        <button type="button" className="button-primary small" onClick={() => install(plugin)}>
                          Install
                        </button>
                      )}
                    </div>
                    <p className="plugin-desc">{plugin.description}</p>
                    <ul className="plugin-skills">
                      {plugin.skills.map((skill) => (
                        <li key={skill.name}>
                          <code>/{skill.name}</code>
                          <span>{skill.description}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="plugin-card-foot">
                      <span className="plugin-cat">{CATEGORY_LABEL[plugin.category]}</span>
                      {isInstalled && (
                        <button type="button" className="text-button" onClick={() => removePlugin(plugin)}>
                          Remove
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
              {plugins.length === 0 && <p className="empty-line">No plugins match that search.</p>}
            </div>
            <p className="page-note">
              Plugins install skills only — never code, never a network request. The catalog ships
              with this build and every instruction is in <code>src/lib/plugins.ts</code>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
