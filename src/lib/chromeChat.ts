import { chromeCommand, openChromeUrl } from "./chrome";

/**
 * The Chrome side panel asks in plain language; the model may end its reply
 * with one action tag. This file turns that tag into a real browser command so
 * the answer the user sees matches what actually happened.
 */

export interface BrowserAction {
  action: string;
  target?: string;
  selector?: string;
  text?: string;
  submit?: boolean;
  dy?: number;
  url?: string;
}

/** Splits the reply from its action tag. */
export function takeAction(reply: string): { text: string; action: BrowserAction | null } {
  const match = /<action>([\s\S]*?)<\/action>/i.exec(reply);
  if (!match) return { text: reply, action: null };

  let action: BrowserAction | null = null;
  try {
    const parsed = JSON.parse(match[1].trim()) as BrowserAction;
    if (parsed && typeof parsed.action === "string") action = parsed;
  } catch {
    action = null;
  }

  return { text: reply.replace(match[0], "").trim(), action };
}

export async function runBrowserAction(action: BrowserAction): Promise<string> {
  try {
    switch (action.action) {
      case "click": {
        const result = await chromeCommand("act", {
          action: "click",
          text: action.selector ? undefined : action.target,
          selector: action.selector,
        });
        return result.detail || `Clicked ${action.target || "the page"}`;
      }
      case "type": {
        const result = await chromeCommand("act", {
          action: "type",
          text: action.text ?? "",
          selector: action.selector,
          submit: Boolean(action.submit),
        });
        return result.detail || "Typed into the page";
      }
      case "enter": {
        const result = await chromeCommand("act", { action: "enter" });
        return result.detail || "Pressed Enter";
      }
      case "scroll": {
        const dy = Number(action.dy) || 700;
        const result = await chromeCommand("act", { action: "scroll", dy });
        return result.detail || (dy > 0 ? "Scrolled down" : "Scrolled up");
      }
      case "open": {
        if (!action.url) return "No address was given.";
        const result = await openChromeUrl(action.url);
        return result.detail || `Opened ${action.url}`;
      }
      case "back":
      case "forward": {
        const result = await chromeCommand("history", { direction: action.action });
        return result.detail || `Went ${action.action}`;
      }
      case "reload": {
        const result = await chromeCommand("reload");
        return result.detail || "Reloaded the page";
      }
      default:
        return `Lantas does not know the ${action.action} action.`;
    }
  } catch (error) {
    return `Action failed. ${error instanceof Error ? error.message : String(error)}`;
  }
}
