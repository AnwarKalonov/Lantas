def edit(path, pairs):
    s = open(path).read()
    for old, new in pairs:
        if new and new in s:
            continue
        if old not in s:
            raise SystemExit(f"MISS in {path}: {old[:80]!r}")
        s = s.replace(old, new, 1)
    open(path, "w").write(s)
    print("edited", path)


# ---- App: turn a delivered artifact into a transcript card -------------------
edit("src/App.tsx", [
    (
        '''                  if (
                    outcome.shell &&
                    !message.parts.some((item) => item.id === `${id}:shell`)
                  ) {''',
        '''                  if (outcome.artifact) {
                    additions.push({
                      id: uid("part"),
                      kind: "artifact",
                      artifactId: outcome.artifact.id,
                      name: outcome.artifact.name,
                      format: outcome.artifact.format,
                      bytes: outcome.artifact.bytes,
                    });
                  }
                  if (
                    outcome.shell &&
                    !message.parts.some((item) => item.id === `${id}:shell`)
                  ) {''',
    ),
])

# ---- Transcript: render the card --------------------------------------------
edit("src/components/Transcript.tsx", [
    (
        'import { PATH_RE, looksLikePath, maskUrls, pathFrom } from "../lib/paths";',
        'import { PATH_RE, looksLikePath, maskUrls, pathFrom } from "../lib/paths";\nimport { formatBytes, saveArtifact } from "../lib/artifacts";',
    ),
    (
        '  plan: "compass",\n  web: "compass",\n};',
        '  plan: "compass",\n  web: "compass",\n  deliver: "download",\n};',
    ),
    (
        '    case "note":',
        '''    case "artifact":
      return <ArtifactBlock part={part} />;
    case "note":''',
    ),
    (
        'function UserMessage({ message, compact }: { message: Message; compact?: boolean }) {',
        '''function ArtifactBlock({ part }: { part: Extract<Part, { kind: "artifact" }> }) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "gone">("idle");
  const icon = part.format === "zip" ? "archive" : part.format === "pdf" ? "doc" : "file";

  const save = async () => {
    setState("saving");
    const result = await saveArtifact(part.artifactId);
    if (result === "missing") {
      setState("gone");
      return;
    }
    if (result === "cancelled") {
      setState("idle");
      return;
    }
    setState("saved");
    window.setTimeout(() => setState("idle"), 2200);
  };

  const label =
    state === "gone"
      ? "Expired"
      : state === "saved"
        ? "Saved"
        : state === "saving"
          ? "Saving…"
          : "Download";

  return (
    <div className={cx("artifact-card", `is-${part.format}`, state === "saved" && "is-saved")}>
      <span className="artifact-icon" aria-hidden="true">
        <Icon name={icon} size={16} />
      </span>
      <span className="artifact-copy">
        <span className="artifact-name" title={part.name}>
          {part.name}
        </span>
        <span className="artifact-meta">
          {part.format.toUpperCase()} · {formatBytes(part.bytes)}
        </span>
      </span>
      <button
        type="button"
        className="artifact-save"
        onClick={save}
        disabled={state === "saving" || state === "gone"}
        title={
          state === "gone"
            ? "This file was built earlier in the session. Ask again to rebuild it."
            : `Save ${part.name}`
        }
      >
        <Icon name={state === "saved" ? "check" : "download"} size={13} />
        {label}
      </button>
    </div>
  );
}

function UserMessage({ message, compact }: { message: Message; compact?: boolean }) {''',
    ),
])
