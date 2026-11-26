import { useEffect } from "react";
import { describeAction } from "../lib/permissions";
import type { ToolCall } from "../lib/tools";
import { Icon, type IconName } from "./Icons";

/**
 * The permission sheet for one tool call.
 *
 * It replaces a raw JSON dump with what the action is, the handful of details
 * that matter, and three choices: decline, run it once, or stop being asked
 * about this exact action. "Always allow" is stored as a literal rule, so a
 * saved command that contains `*` never widens into a wildcard.
 */

interface Approval {
  call: ToolCall;
  resource: string;
  label: string;
}

const TOOL_NAMES: Record<string, string> = {
  integrations: "Connected app",
  terminal: "Terminal",
  browser: "Browser",
  write: "Workspace file",
  edit: "Workspace file",
  read: "Workspace file",
  grep: "Workspace search",
};

const TOOL_ICONS: Record<string, IconName> = {
  integrations: "plug",
  terminal: "terminal",
  browser: "compass",
  write: "doc",
  edit: "wrench",
  read: "file",
  grep: "search",
};

function actionOf(approval: Approval): string {
  return String(approval.call.args.action ?? approval.resource.split(" ")[0] ?? "").toLowerCase();
}

function titleOf(approval: Approval): string {
  if (approval.call.name === "integrations") {
    switch (actionOf(approval)) {
      case "inbox":
        return "Read your inbox";
      case "search_email":
        return "Search your email";
      case "run":
        return "Run a connected app";
      case "apps":
      case "tools":
        return "Look at your connected apps";
      default:
        return "Use a connected app";
    }
  }
  switch (approval.call.name) {
    case "terminal":
      return "Run a command";
    case "browser":
      return "Act in the browser";
    case "write":
    case "edit":
      return "Change a file";
    default:
      return "Lantas wants to act";
  }
}

function subtitleOf(approval: Approval): string {
  if (approval.call.name === "integrations" && actionOf(approval) === "inbox") {
    const query = String(approval.call.args.query ?? "").trim();
    return query
      ? `Lantas wants to look through your inbox for “${query}”.`
      : "Lantas wants to look through your inbox.";
  }
  if (approval.call.name === "terminal") {
    return "Lantas wants to run this in the open workspace.";
  }
  return `${approval.label}.`;
}

function keyLabel(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

function valueText(key: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    return key === "limit" ? `${value} results` : String(value);
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") {
    if (key === "content" && value.length > 420) {
      return `${value.slice(0, 420)}…\n(${value.length.toLocaleString()} characters)`;
    }
    return value.length > 320 ? `${value.slice(0, 320)}…` : value;
  }
  try {
    const json = JSON.stringify(value);
    return json.length > 320 ? `${json.slice(0, 320)}…` : json;
  } catch {
    return String(value);
  }
}

export function ApprovalCard({
  approval,
  onSettle,
}: {
  approval: Approval;
  onSettle: (allowed: boolean, remember?: boolean) => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onSettle(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSettle]);

  const icon = TOOL_ICONS[approval.call.name] ?? "shield";
  const toolName = TOOL_NAMES[approval.call.name] ?? approval.call.name;
  const fields = Object.entries(approval.call.args ?? {}).filter(
    ([key]) => key !== "action" && key !== "slug" && key !== "toolkit",
  );
  const shown = fields.slice(0, 6);
  const browserAction =
    approval.call.name === "browser" ? String(approval.call.args.action ?? "").toLowerCase() : "";

  return (
    <div className="overlay" onMouseDown={() => onSettle(false)}>
      <div
        className="confirm-card tool-approval"
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="approval-head">
          <span className="approval-mark" aria-hidden="true">
            <Icon name={icon} size={17} />
          </span>
          <div className="approval-heading">
            <p className="approval-kicker">Permission request</p>
            <h2 id="approval-title">{titleOf(approval)}</h2>
            <p className="approval-sub">{subtitleOf(approval)}</p>
          </div>
        </div>

        <div className="approval-request">
          <div className="approval-target">
            <span className="approval-target-icon" aria-hidden="true">
              <Icon name={icon} size={13} />
            </span>
            <span className="approval-target-name">{toolName}</span>
            <code className="approval-target-resource" title={approval.resource}>
              {approval.resource || toolName}
            </code>
          </div>
          {shown.length > 0 && (
            <dl className="approval-fields">
              {shown.map(([key, value]) => (
                <div className="approval-field" key={key}>
                  <dt>{keyLabel(key)}</dt>
                  <dd className={typeof value === "string" ? "is-text" : undefined}>
                    {valueText(key, value)}
                  </dd>
                </div>
              ))}
              {fields.length > shown.length && (
                <p className="approval-more">+{fields.length - shown.length} more details</p>
              )}
            </dl>
          )}
        </div>

        <p className="approval-note">
          {browserAction
            ? `Allow once runs only this step. Always allow stops asking for every browser ${browserAction}; remove it later in Settings → Permissions.`
            : "Allow once runs only this step. Always allow remembers this exact action and stops asking; remove it later in Settings → Permissions."}
        </p>

        <div className="approval-actions">
          <button type="button" className="button-quiet" onClick={() => onSettle(false)}>
            Decline
          </button>
          <span className="approval-spacer" />
          <button
            type="button"
            className="button-ghost approval-always"
            onClick={() => onSettle(true, true)}
          >
            <Icon name="shield" size={12} />
            Always allow
          </button>
          <button
            type="button"
            className="button-primary"
            onClick={() => onSettle(true)}
            autoFocus
          >
            Allow once
          </button>
        </div>
      </div>
    </div>
  );
}
