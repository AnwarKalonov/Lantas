import { useEffect, useRef, useState } from "react";
import { openExternal } from "../lib/native";
import {
  RELEASES_URL,
  checkForUpdate,
  checkNativeUpdate,
  dismissUpdate,
  type NativeUpdate,
} from "../lib/updates";

type Stage =
  | { kind: "idle"; version: string; notes: string; native: boolean }
  | { kind: "installing"; version: string; percent: number }
  | { kind: "ready"; version: string }
  | { kind: "failed"; version: string; message: string };

/**
 * One small pill in the title bar.
 *
 * In the desktop build it installs: check, download with progress, verify the
 * signature, replace the bundle, then offer the restart. In a browser tab there
 * is no shell to install into, so it opens the release instead.
 */
export function UpdatePill() {
  const [stage, setStage] = useState<Stage | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const pending = useRef<NativeUpdate | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const native = await checkNativeUpdate();
      if (!live) return;
      if (native) {
        pending.current = native;
        setStage({ kind: "idle", version: native.version, notes: native.notes, native: true });
        return;
      }
      try {
        const release = await checkForUpdate();
        if (live && release) {
          setStage({
            kind: "idle",
            version: release.version,
            notes: release.notes,
            native: false,
          });
        }
      } catch {
        /* offline or rate-limited: no notice */
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  if (!stage || dismissed) return null;

  const start = async () => {
    if (stage.kind === "ready") {
      await pending.current?.restart();
      return;
    }
    if (stage.kind === "failed") {
      openExternal(RELEASES_URL);
      return;
    }
    if (stage.kind !== "idle") return;

    const update = pending.current;
    if (!stage.native || !update) {
      openExternal(RELEASES_URL);
      return;
    }

    setStage({ kind: "installing", version: update.version, percent: 0 });
    try {
      await update.install(({ downloaded, total }) => {
        const percent = total > 0 ? Math.min(99, Math.round((downloaded / total) * 100)) : 0;
        setStage({ kind: "installing", version: update.version, percent });
      });
      setStage({ kind: "ready", version: update.version });
    } catch (error) {
      setStage({
        kind: "failed",
        version: update.version,
        message: error instanceof Error ? error.message : "The update did not install",
      });
    }
  };

  const label =
    stage.kind === "installing"
      ? stage.percent > 0
        ? `Downloading ${stage.percent}%`
        : "Downloading update"
      : stage.kind === "ready"
        ? "Restart to update"
        : stage.kind === "failed"
          ? "Update failed"
          : `${stage.version} available`;

  const title =
    stage.kind === "installing"
      ? "Lantas is downloading the update"
      : stage.kind === "ready"
        ? `Lantas ${stage.version} is installed — restart to use it`
        : stage.kind === "failed"
          ? `${stage.message} — click to download it by hand`
          : stage.native
            ? `Install Lantas ${stage.version}${stage.notes ? ` — ${stage.notes}` : ""}`
            : `Lantas ${stage.version} is out — click to open the release`;

  const tone = stage.kind === "failed" ? " is-error" : "";

  return (
    <div className={`update-pill${tone}`} title={title}>
      <button
        type="button"
        className="update-pill-main"
        onClick={() => void start()}
        disabled={stage.kind === "installing"}
      >
        <span
          className={`update-dot${stage.kind === "installing" ? " is-busy" : ""}${
            stage.kind === "failed" ? " is-error" : ""
          }`}
          aria-hidden="true"
        />
        {label}
      </button>
      <button
        type="button"
        className="update-pill-x"
        onClick={() => {
          dismissUpdate(stage.version);
          setDismissed(true);
        }}
        aria-label="Dismiss the update notice"
        title="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
