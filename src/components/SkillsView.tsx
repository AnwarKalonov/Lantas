import { useRef, useState } from "react";
import { useStore } from "../lib/store";
import { parseSkillZip } from "../lib/skills";
import type { Skill } from "../lib/types";
import { cx, uid } from "../lib/util";
import { Icon } from "./Icons";

export function SkillsView() {
  const { state, addSkill, updateSkill, deleteSkill, notify } = useStore();
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: "", description: "", instructions: "" });
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const importFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setImporting(true);
    let added = 0;
    for (const file of Array.from(list)) {
      try {
        const parsed = await parseSkillZip(file);
        parsed.forEach((item) => {
          const slug = item.name.replace(/\s+/g, "-").toLowerCase();
          if (state.skills.some((existing) => existing.name === slug)) return;
          addSkill({
            id: uid("skill"),
            name: slug,
            description: item.description,
            instructions: item.instructions,
            enabled: true,
          });
          added += 1;
        });
      } catch {
        notify(`${file.name} could not be read`, "error");
      }
    }
    setImporting(false);
    notify(
      added
        ? `${added} skill${added === 1 ? "" : "s"} learned`
        : "No SKILL.md found in that file",
      added ? "default" : "error",
    );
  };

  const startCreate = () => {
    setDraft({ name: "", description: "", instructions: "" });
    setCreating(true);
    setEditing(null);
  };

  const save = () => {
    const name = draft.name.trim();
    if (!name) {
      notify("A skill needs a name", "error");
      return;
    }
    const skill: Skill = {
      id: uid("skill"),
      name: name.replace(/\s+/g, "-").toLowerCase(),
      description: draft.description.trim() || "Custom skill",
      instructions: draft.instructions.trim(),
      enabled: true,
    };
    addSkill(skill);
    setCreating(false);
    notify(`${skill.name} added`);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Skills</h1>
          <p className="page-lede">
            Instructions attached to every run while enabled. They shape tone, process and what
            the agent checks before answering.
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

      <div className="page-body">
        {creating && (
          <div className="skill-editor">
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
                <span>Description</span>
                <input
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  placeholder="Verify a migration before it ships"
                />
              </label>
            </div>
            <label className="field">
              <span>Instructions</span>
              <textarea
                rows={5}
                value={draft.instructions}
                onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
                placeholder="When the task touches a migration, read the schema first, then list the steps that would fail on a populated table."
              />
            </label>
            <div className="form-actions">
              <button type="button" className="button-primary" onClick={save}>
                Save skill
              </button>
              <button type="button" className="button-quiet" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="skill-cards">
          {state.skills.map((skill) => (
            <div className={cx("skill-card", skill.enabled && "is-on")} key={skill.id}>
              <div className="skill-card-head">
                <span className="skill-name mono">/{skill.name}</span>
                {skill.builtin && <span className="tag">built-in</span>}
                <span className="skill-card-spacer" />
                <button
                  type="button"
                  className="text-button"
                  onClick={() => updateSkill(skill.id, { enabled: !skill.enabled })}
                >
                  {skill.enabled ? "Disable" : "Enable"}
                </button>
                {!skill.builtin && (
                  <button
                    type="button"
                    className="icon-button danger-hover"
                    aria-label={`Delete ${skill.name}`}
                    onClick={() => {
                      deleteSkill(skill.id);
                      notify(`${skill.name} deleted`);
                    }}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                )}
              </div>

              <p className="skill-description">{skill.description}</p>

              {editing === skill.id ? (
                <div className="skill-edit">
                  <textarea
                    rows={4}
                    value={skill.instructions}
                    onChange={(event) => updateSkill(skill.id, { instructions: event.target.value })}
                  />
                  <button type="button" className="button-quiet" onClick={() => setEditing(null)}>
                    Done
                  </button>
                </div>
              ) : (
                <p className="skill-instructions">{skill.instructions}</p>
              )}

              <div className="skill-card-foot">
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setEditing(editing === skill.id ? null : skill.id)}
                >
                  {editing === skill.id ? "Close editor" : "Edit instructions"}
                </button>
              </div>
            </div>
          ))}
        </div>

        {state.skills.length === 0 && (
          <p className="empty-line">No skills yet. Create one to shape how runs behave.</p>
        )}

        <p className="page-note">
          Skills live in this app's local data and are sent only to the provider you select for a
          run.
        </p>
      </div>
    </div>
  );
}
