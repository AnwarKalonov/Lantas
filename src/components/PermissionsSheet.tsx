import { useEffect, useState } from "react";
import { inTauri, openPrivacySettings } from "../lib/native";
import { captureNativeScreen } from "../lib/screen";
import { useStore } from "../lib/store";
import { cx } from "../lib/util";
import { Icon, type IconName } from "./Icons";

type GrantKey = "fileAccess" | "terminalAccess" | "screenAccess" | "computerControl";

interface GrantItem {
  key: GrantKey;
  title: string;
  detail: string;
  note?: string;
  icon: IconName;
}

/**
 * The four things Lantas can touch. Nothing here is enabled as a side effect:
 * the sheet is the consent, the grants are what every tool checks.
 */
const ITEMS: GrantItem[] = [
  {
    key: "fileAccess",
    title: "Read and edit your files",
    detail: "Only the folder you open, never anything else on the disk.",
    icon: "folder",
  },
  {
    key: "terminalAccess",
    title: "Run commands in that folder",
    detail: "Builds, tests and git. Each command can still ask first.",
    icon: "terminal",
  },
  {
    key: "screenAccess",
    title: "See your screen",
    detail: "Adds a fresh screenshot to a turn while screen access is on.",
    note: "macOS asks for Screen Recording the first time.",
    icon: "screen",
  },
  {
    key: "computerControl",
    title: "Click and type for you",
    detail: "Lets Lantas click, type and scroll in the browser and in the floating screen card, including other apps. It stays off until you turn it on.",
    note: "macOS asks for Accessibility the first time it uses the pointer.",
    icon: "cursor",
  },
];

export function PermissionsSheet({ onClose }: { onClose: () => void }) {
  const { state, setSettings, notify } = useStore();
  const firstRun = !state.settings.permissionsReviewed;
  const [granted, setGranted] = useState<Record<GrantKey, boolean>>(() => {
    // On first launch the recommendation is on, so pressing the primary button
    // means "yes, all of this" — but every row is visible and can be turned off.
    if (firstRun) {
      return {
        fileAccess: true,
        terminalAccess: true,
        screenAccess: false,
        computerControl: false,
      };
    }
    return {
      fileAccess: state.settings.fileAccess,
      terminalAccess: state.settings.terminalAccess,
      screenAccess: state.settings.screenAccess,
      computerControl: state.settings.computerControl,
    };
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettings({ permissionsReviewed: true });
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, setSettings]);

  const [screenTest, setScreenTest] = useState<{ busy: boolean; message: string }>({
    busy: false,
    message: "",
  });
  const allowed = ITEMS.filter((item) => granted[item.key]).length;
  const desktop = inTauri();

  const openPane = async (pane: "screen" | "accessibility") => {
    const ok = await openPrivacySettings(pane);
    if (!ok) {
      notify(
        `System Settings only opens from the desktop app. On your Mac: Privacy & Security → ${
          pane === "screen" ? "Screen Recording" : "Accessibility"
        }.`,
        "error",
      );
    }
  };

  const testScreen = async () => {
    setScreenTest({ busy: true, message: "Taking one frame…" });
    try {
      const frame = await captureNativeScreen();
      setScreenTest({
        busy: false,
        message: frame
          ? "Screen Recording is allowed — Lantas can see the screen."
          : "No frame came back. Allow Lantas in Screen Recording, then try again.",
      });
    } catch (error) {
      setScreenTest({
        busy: false,
        message: `macOS blocked the capture. Turn Lantas on in Screen Recording, then relaunch Lantas. (${error instanceof Error ? error.message : String(error)})`,
      });
    }
  };

  const allowThese = () => {
    setSettings({ ...granted, permissionsReviewed: true });
    const newlyScreen = granted.screenAccess && !state.settings.screenAccess;
    const newlyControl = granted.computerControl && !state.settings.computerControl;
    // Hand over to macOS for the switch only the user can flip — one pane, so
    // System Settings does not open twice.
    if (desktop && (newlyScreen || newlyControl)) {
      void openPrivacySettings(newlyScreen ? "screen" : "accessibility");
      notify(
        newlyScreen
          ? "Turn Lantas on under Screen Recording, then relaunch Lantas"
          : "Turn Lantas on under Accessibility — no relaunch needed",
      );
    } else {
      notify(
        allowed === ITEMS.length
          ? "Permissions saved — everything you listed is allowed"
          : `Permissions saved — ${allowed} of ${ITEMS.length} allowed`,
      );
    }
    onClose();
  };

  const notNow = () => {
    setSettings({ permissionsReviewed: true });
    notify("You can allow things later in Settings → Permissions");
    onClose();
  };

  const savedRules = state.settings.allowedRules ?? [];

  const forgetRule = (tool: string, pattern: string) => {
    setSettings({
      allowedRules: savedRules.filter(
        (rule) => !(rule.tool === tool && rule.pattern === pattern),
      ),
    });
    notify("That action will ask again next time");
  };

  return (
    <div className="overlay" onMouseDown={notNow}>
      <div
        className="perm-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Permissions"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="perm-head">
          <p className="perm-kicker">Permissions</p>
          <h2>What Lantas may do</h2>
          <p className="perm-lede">
            Lantas asks once, here, instead of quietly using your folder, your screen or your
            pointer. Change any of it later in Settings → Permissions.
          </p>
        </div>

        <div className="perm-list">
          {ITEMS.map((item) => {
            const on = granted[item.key];
            return (
              <button
                key={item.key}
                type="button"
                className={cx("perm-row", on && "is-on")}
                aria-pressed={on}
                onClick={() => setGranted((current) => ({ ...current, [item.key]: !on }))}
              >
                <span className="perm-icon">
                  <Icon name={item.icon} size={15} />
                </span>
                <span className="perm-text">
                  <span className="perm-title">{item.title}</span>
                  <span className="perm-detail">{item.detail}</span>
                  {item.note && <span className="perm-note">{item.note}</span>}
                </span>
                <span className="perm-check" aria-hidden>
                  {on && <Icon name="check" size={12} />}
                </span>
              </button>
            );
          })}
        </div>

        {(granted.screenAccess || granted.computerControl) && (
          <div className="perm-mac">
            <div className="perm-mac-head">
              <Icon name="shield" size={13} />
              <span>
                macOS keeps its own switches for the screen and the pointer. Lantas can open the
                pane — the switch stays yours.
              </span>
            </div>
            <div className="perm-mac-actions">
              {granted.screenAccess && (
                <button type="button" className="button-quiet small" onClick={() => void openPane("screen")}>
                  Open Screen Recording
                </button>
              )}
              {granted.computerControl && (
                <button type="button" className="button-quiet small" onClick={() => void openPane("accessibility")}>
                  Open Accessibility
                </button>
              )}
              {granted.screenAccess && desktop && (
                <button type="button" className="button-quiet small" onClick={() => void testScreen()} disabled={screenTest.busy}>
                  {screenTest.busy ? "Testing…" : "Test capture"}
                </button>
              )}
            </div>
            {screenTest.message && <p className="perm-mac-note">{screenTest.message}</p>}
          </div>
        )}

        {savedRules.length > 0 && (
          <div className="perm-always">
            <div className="perm-always-head">
              <Icon name="shield" size={13} />
              <span>Always allowed</span>
              <span className="perm-always-count">{savedRules.length}</span>
            </div>
            <div className="perm-always-list">
              {savedRules.map((rule) => (
                <div className="perm-always-row" key={`${rule.tool}:${rule.pattern}`}>
                  <span className="perm-always-name" title={rule.pattern}>
                    {rule.pattern || rule.tool}
                  </span>
                  <span className="perm-always-tool">{rule.tool}</span>
                  <button
                    type="button"
                    onClick={() => forgetRule(rule.tool, rule.pattern)}
                    aria-label={`Stop always allowing ${rule.pattern}`}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <p className="perm-always-note">
              These skip the approval sheet. “Always allow” adds them, and removing one brings
              the question back.
            </p>
          </div>
        )}

        <div className="perm-foot">
          <span className="perm-foot-note">
            {allowed === 0
              ? "With nothing allowed, Lantas can only chat."
              : `${allowed} of ${ITEMS.length} selected. Nothing turns on until you press Allow these.`}
          </span>
          <div className="perm-actions">
            <button type="button" className="button-quiet" onClick={notNow}>
              Not now
            </button>
            <button type="button" className="button-primary" onClick={allowThese}>
              Allow these
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
