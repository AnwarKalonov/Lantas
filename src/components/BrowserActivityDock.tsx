import { useEffect, useRef } from "react";
import { useBrowserActivity, dismissBrowserActivity } from "../lib/browserActivity";
import { hostOf } from "../lib/el";
import { cx } from "../lib/util";
import { Icon } from "./Icons";
import { MarkGlyph } from "./Brand";

/**
 * The mini browser window above the composer. The desktop build places the
 * hidden native webview directly over the page area while an agent task runs,
 * so this is the real page plus the verified step stream around it.
 */
export function BrowserActivityDock({
  onOpen,
}: {
  onOpen: (url: string) => void;
}) {
  const activity = useBrowserActivity();
  const pageRef = useRef<HTMLDivElement | null>(null);
  const hasSteps = activity.steps.length > 0;

  // The native webview can sit exactly over this card, so the mini window is
  // the real page the agent is changing, not a re-creation of it.
  useEffect(() => {
    if (!hasSteps) return;
    const send = () => {
      const node = pageRef.current;
      const rect = node?.getBoundingClientRect();
      window.dispatchEvent(
        new CustomEvent("lantas:mini-screen", {
          detail: rect
            ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
            : null,
        }),
      );
    };
    send();
    const observer = new ResizeObserver(send);
    if (pageRef.current) observer.observe(pageRef.current);
    window.addEventListener("resize", send);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", send);
      window.dispatchEvent(new CustomEvent("lantas:mini-screen", { detail: null }));
    };
  }, [hasSteps]);

  if (!hasSteps) return null;

  const host = activity.url ? hostOf(activity.url) : "Browser";
  const recent = activity.steps.slice(-3);

  return (
    <aside className={cx("browser-dock", activity.active && "is-live")} aria-live="polite">
      <button
        type="button"
        className="browser-dock-screen"
        onClick={() => onOpen(activity.url)}
        title="Open this page in Lantas Browser"
      >
        <div className="browser-dock-window">
          <div className="browser-dock-chrome">
            <span className="browser-dock-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="browser-dock-host">{host}</span>
            {activity.active && <span className="browser-dock-live">live</span>}
          </div>
          <div className="browser-dock-page" ref={pageRef}>
            <span className="browser-dock-mark">
              <MarkGlyph size={15} />
            </span>
            <span className="browser-dock-title">{activity.title || host}</span>
            <span className="browser-dock-url">{activity.url || "Waiting for the page"}</span>
            <span className="browser-dock-scan" aria-hidden="true" />
          </div>
        </div>
        <span className="browser-dock-open">
          <Icon name="external" size={11} />
          Open browser
        </span>
      </button>

      <div className="browser-dock-copy">
        <div className="browser-dock-heading">
          <span className="browser-dock-kicker">
            {activity.active ? "Lantas is browsing" : "Browser session"}
          </span>
          {activity.active && <span className="browser-dock-spinner" />}
        </div>
        <p className="browser-dock-status">{activity.status || "Working in the browser"}</p>
        <div className="browser-dock-steps">
          {recent.map((step) => (
            <span key={step.id} className={cx("browser-dock-step", `is-${step.tone}`)}>
              <span className="browser-dock-step-dot" />
              {step.text}
            </span>
          ))}
        </div>
      </div>

      <button
        type="button"
        className="browser-dock-close"
        onClick={dismissBrowserActivity}
        aria-label="Hide browser activity"
      >
        <Icon name="close" size={12} />
      </button>
    </aside>
  );
}
