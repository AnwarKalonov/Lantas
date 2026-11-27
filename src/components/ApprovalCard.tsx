import { useEffect, useState } from "react";
import type { ToolCall } from "../lib/tools";
import { brandFromText, type BrandId } from "../lib/brands";
import { BrandMark } from "./BrandMark";
import { Icon, type IconName } from "./Icons";
import { cx } from "../lib/util";

/**
 * The permission card for one tool call.
 *
 * It reads like a sentence about the action, not a debug view of the tool:
 * a mark for the app involved, the consequence in plain words, then Deny and
 * one primary button that names what will happen. The quieter choices live
 * behind “Other options”, so the common decision stays two buttons wide.
 */

interface Approval {
  call: ToolCall;
  resource: string;
  label: string;
}

const TOOL_NAMES: Record<string, string> = {
  integrations: "Connected app",
  terminal: "Terminal",
  git: "Git",
  preview: "Preview",
  browser: "Browser",
  write: "Workspace file",
  edit: "Workspace file",
  read: "Workspace file",
  grep: "Workspace search",
};

const TOOL_ICONS: Record<string, IconName> = {
  integrations: "plug",
  terminal: "terminal",
  git: "branch",
  preview: "compass",
  browser: "compass",
  write: "doc",
  edit: "wrench",
  read: "file",
  grep: "search",
};

const APP_NAMES: Record<BrandId, string> = {
  gmail: "Gmail",
  drive: "Google Drive",
  slack: "Slack",
  linear: "Linear",
  notion: "Notion",
  github: "GitHub",
  figma: "Figma",
  vercel: "Vercel",
  browser: "the browser",
};

function actionOf(approval: Approval): string {
  return String(approval.call.args.action ?? approval.resource.split(" ")[0] ?? "").toLowerCase();
}

function pathOf(approval: Approval): string {
  return String(
    approval.call.args.path ?? approval.call.args.file_path ?? approval.resource ?? "",
  ).trim();
}

function fileName(approval: Approval): string {
  const path = pathOf(approval);
  return path.split("/").pop() || path || "this file";
}

function appOf(approval: Approval): string {
  const brand = brandFromText(
    approval.label,
    String(approval.call.args.toolkit ?? ""),
    String(approval.call.args.slug ?? ""),
    String(approval.call.args.query ?? ""),
  );
  return brand ? APP_NAMES[brand] : "";
}

function titleOf(approval: Approval): string {
  switch (approval.call.name) {
    case "write":
    case "edit":
      return `Keep changes to ${fileName(approval)}?`;
    case "terminal":
      return "Run this command?";
    case "git": {
      const action = actionOf(approval);
      if (action === "push") return "Push this branch?";
      if (action === "pull") return "Pull the latest changes?";
      if (action === "commit") return "Commit these changes?";
      return "Run this git command?";
    }
    case "preview":
      return actionOf(approval) === "start" ? "Run this app?" : "Open this preview?";
    case "browser":
      return "Allow this action?";
    case "integrations": {
      const app = appOf(approval);
      switch (actionOf(approval)) {
        case "inbox":
          return "Read your inbox?";
        case "search_email":
          return "Search your email?";
        case "run":
          return app ? `Use ${app}?` : "Run this connected app?";
        case "tools":
          return app ? `Look up ${app} tools?` : "Look up connected app tools?";
        default:
          return "Use a connected app?";
      }
    }
    default:
      return "Allow this action?";
  }
}

function subtitleOf(approval: Approval): string {
  switch (approval.call.name) {
    case "terminal":
      return "Runs in the open workspace and returns its output.";
    case "git":
      return "Runs in the open repository. Nothing is forced or reset.";
    case "preview":
      return actionOf(approval) === "start"
        ? "Starts the dev server and opens it in Lantas' browser panel. The process keeps running after this turn."
        : "Opens the address in Lantas' browser panel.";
    case "browser":
      return "Acts on the page in front of you. You can take control at any time.";
    case "write":
    case "edit":
      return "Nothing is written until you keep it. Discard restores the file.";
    case "integrations": {
      const app = appOf(approval);
      if (actionOf(approval) === "inbox") {
        const query = String(approval.call.args.query ?? "").trim();
        return query
          ? `Looks for “${query}” in your inbox.`
          : "Looks through your inbox and returns a summary.";
      }
      return app
        ? `Lantas will use ${app} for this step. You can revoke it in Integrations.`
        : "Lantas will use a connected app for this step.";
    }
    default:
      return approval.label;
  }
}

function primaryLabel(approval: Approval): string {
  switch (approval.call.name) {
    case "write":
    case "edit":
      return "Keep changes";
    case "terminal":
      return "Run command";
    case "git":
      return actionOf(approval) === "push" ? "Push branch" : "Run git";
    case "preview":
      return actionOf(approval) === "start" ? "Run and open" : "Open preview";
    case "browser":
      return "Allow action";
    case "read":
    case "grep":
      return "Allow read";
    case "integrations": {
      const app = appOf(approval);
      return app && actionOf(approval) === "run" ? `Allow ${app}` : "Allow";
    }
    default:
      return "Allow";
  }
}

function declineLabel(approval: Approval): string {
  return approval.call.name === "write" || approval.call.name === "edit"
    ? "Discard changes"
    : "Deny";
}

/** SLACK_SEND_MESSAGE → “Send message”, with the app prefix removed. */
function prettySlug(slug: string): string {
  const cleaned = slug
    .replace(/^(gmail|google_drive|googledrive|slack|linear|notion|github|figma)_/i, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return cleaned ? `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}` : "Run a tool";
}

function appAction(approval: Approval): string {
  switch (actionOf(approval)) {
    case "inbox":
      return "Read your inbox";
    case "search_email":
      return "Search your email";
    case "tools":
      return "List the available tools";
    case "apps":
      return "List your connected apps";
    case "run":
      return prettySlug(String(approval.call.args.slug ?? ""));
    default:
      return approval.label || "Use this app";
  }
}

function Preview({ approval }: { approval: Approval }) {
  const command = String(approval.call.args.command ?? "").trim();
  const diff = String(approval.call.args.diff ?? "").trim();
  const path = pathOf(approval);
  const action = String(approval.call.args.action ?? "").trim();
  const fields = Object.entries(approval.call.args ?? {}).filter(
    ([key]) =>
      !["command", "diff", "path", "file_path", "action", "slug", "toolkit"].includes(key),
  );

  if (approval.call.name === "integrations") {
    const brand = brandFromText(
      approval.label,
      String(approval.call.args.toolkit ?? ""),
      String(approval.call.args.slug ?? ""),
    );
    return (
      <div className="approval-preview is-app">
        <span className="approval-app-mark" aria-hidden="true">
          {brand ? <BrandMark id={brand} size={18} /> : <Icon name="plug" size={15} />}
        </span>
        <span className="approval-app-copy">
          <span className="approval-app-name">
            {appOf(approval) || TOOL_NAMES.integrations}
          </span>
          <span className="approval-app-action">{appAction(approval)}</span>
        </span>
      </div>
    );
  }

  if (approval.call.name === "terminal" && command) {
    return (
      <div className="approval-preview is-command">
        <span className="approval-prompt" aria-hidden="true">
          $
        </span>
        <code>{command}</code>
      </div>
    );
  }

  if (approval.call.name === "git" && command) {
    return (
      <div className="approval-preview is-command">
        <span className="approval-prompt" aria-hidden="true">
          git
        </span>
        <code>{command}</code>
      </div>
    );
  }

  if ((approval.call.name === "write" || approval.call.name === "edit") && (diff || path)) {
    return (
      <div className="approval-preview is-file">
        <div className="approval-file-head">
          <Icon name="file" size={13} />
          <span title={path}>{path || TOOL_NAMES[approval.call.name]}</span>
        </div>
        {diff ? (
          <pre className="approval-diff">
            {diff
              .slice(0, 2_400)
              .split("\n")
              .map((line, index) => (
                <span
                  key={index}
                  className={
                    line.startsWith("+") && !line.startsWith("+++")
                      ? "is-add"
                      : line.startsWith("-") && !line.startsWith("---")
                        ? "is-del"
                        : line.startsWith("@@")
                          ? "is-hunk"
                          : undefined
                  }
                >
                  {line || " "}
                </span>
              ))}
          </pre>
        ) : null}
      </div>
    );
  }

  return (
    <div className="approval-preview">
      {path ? (
        <div className="approval-file-head">
          <Icon name={TOOL_ICONS[approval.call.name] ?? "file"} size={13} />
          <span title={path}>{path}</span>
        </div>
      ) : null}
      {action ? (
        <div className="approval-action-line">
          <span className="approval-action-name">{action.replace(/[_-]+/g, " ")}</span>
          {fields.slice(0, 4).map(([key, value]) => (
            <span className="approval-action-value" key={key}>
              {key}: {String(value).slice(0, 180)}
            </span>
          ))}
        </div>
      ) : fields.length ? (
        <dl className="approval-fields">
          {fields.slice(0, 5).map(([key, value]) => (
            <div key={key}>
              <dt>{key.replace(/[_-]+/g, " ")}</dt>
              <dd>{String(value).slice(0, 360)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="approval-action-line">
          <span className="approval-action-value" title={approval.resource}>
            {approval.resource || approval.label}
          </span>
        </div>
      )}
    </div>
  );
}

export function ApprovalCard({
  approval,
  onSettle,
}: {
  approval: Approval;
  onSettle: (allowed: boolean, remember?: boolean) => void;
}) {
  const [optionsOpen, setOptionsOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onSettle(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSettle]);

  const brand = brandFromText(
    approval.label,
    String(approval.call.args.toolkit ?? ""),
    String(approval.call.args.slug ?? ""),
    String(approval.call.args.query ?? ""),
  );
  const icon = TOOL_ICONS[approval.call.name] ?? "shield";
  const canRemember = !["read", "grep"].includes(approval.call.name);
  const app = appOf(approval);

  return (
    <div className="overlay approval-overlay" onMouseDown={() => onSettle(false)}>
      <div
        className="approval-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="approval-head">
          <span className={cx("approval-icon", brand && "has-brand")} aria-hidden="true">
            {brand ? <BrandMark id={brand} size={20} /> : <Icon name={icon} size={16} />}
          </span>
          <div className="approval-heading">
            <h2 id="approval-title">{titleOf(approval)}</h2>
            <p>{subtitleOf(approval)}</p>
          </div>
          <button
            type="button"
            className="approval-close"
            onClick={() => onSettle(false)}
            aria-label="Close"
          >
            <Icon name="close" size={13} />
          </button>
        </div>

        <Preview approval={approval} />

        <div className="approval-foot">
          {canRemember ? (
            <div className="approval-other-wrap">
              <button
                type="button"
                className={cx("approval-other", optionsOpen && "is-open")}
                onClick={() => setOptionsOpen((value) => !value)}
                aria-expanded={optionsOpen}
              >
                Other options
                <Icon
                  name="chevronDown"
                  size={10}
                  className={cx("approval-other-caret", optionsOpen && "is-open")}
                />
              </button>
              {optionsOpen && (
                <div className="approval-other-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => onSettle(true, true)}
                  >
                    <Icon name="check" size={12} />
                    <span>
                      <strong>Always allow{app ? ` ${app}` : ""}</strong>
                      <small>
                        Runs this action without asking. You can change it in Settings →
                        Permissions.
                      </small>
                    </span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <span className="approval-hint">Esc to close</span>
          )}
          <span className="approval-spacer" />
          <button
            type="button"
            className="approval-decline"
            onClick={() => onSettle(false)}
          >
            {declineLabel(approval)}
          </button>
          <button
            type="button"
            className="approval-allow"
            onClick={() => onSettle(true)}
            autoFocus
          >
            {primaryLabel(approval)}
            <Icon name="external" size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
