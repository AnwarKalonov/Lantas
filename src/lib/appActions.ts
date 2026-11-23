import type { AgentId, Mode, ProviderId, ThemeMode, ViewId } from "./types";

export interface AppActionApi {
  theme: ThemeMode;
  providers: Array<{ id: ProviderId; name: string; models: string[] }>;
  models: string[];
  setTheme: (theme: ThemeMode) => void;
  setMode: (mode: Mode) => void;
  setView: (view: ViewId) => void;
  setBrowserUrl: (url: string) => void;
  openSettings: (tab: "general" | "providers" | "models" | "agents" | "permissions" | "appearance") => void;
  setDefaultAgent: (agent: AgentId) => void;
  setModel: (provider: ProviderId, model: string) => void;
  toggleFavorite: (key: string) => void;
  setFlag: (
    flag: "reduceMotion" | "notifications" | "sendOnEnter" | "screenAccess" | "computerControl",
    value: boolean,
  ) => void;
}

export interface AppAction {
  message: string;
}

const THEMES: ThemeMode[] = ["dark", "light", "system"];

/**
 * A small, deterministic layer that lets a sentence change the app, without
 * depending on a model supporting tool calls.
 */
export function runAppAction(input: string, api: AppActionApi): AppAction | null {
  const text = input.trim().toLowerCase();

  const theme = THEMES.find(
    (name) =>
      new RegExp(`\\b(theme|mode)\\b[^.]*\\b${name}\\b`).test(text) ||
      new RegExp(`\\b${name}\\b[^.]*\\b(theme|mode)\\b`).test(text),
  );
  if (theme && /(set|change|switch|make|use|turn|go|apply|put)/.test(text)) {
    api.setTheme(theme);
    return { message: `Theme set to ${theme}.` };
  }

  const flagMatch =
    /(turn|switch|set)\s+(reduce motion|motion|notifications?|send on enter|screen access|computer control)\s+(on|off)/.exec(
      text,
    ) ??
    /(turn|switch|set)\s+(on|off)\s+(reduce motion|motion|notifications?|send on enter|screen access|computer control)/.exec(
      text,
    ) ??
    /(disable|enable)\s+(reduce motion|motion|notifications?|send on enter|screen access|computer control)/.exec(text);
  if (flagMatch) {
    const reversed = flagMatch[1] === "on" || flagMatch[1] === "off";
    const label = reversed ? flagMatch[3] : flagMatch[2];
    const on = reversed
      ? flagMatch[1] === "on"
      : flagMatch[3] === "on" || flagMatch[1] === "enable";
    const flag =
      label === "motion" || label === "reduce motion"
        ? "reduceMotion"
        : label.startsWith("notification")
          ? "notifications"
          : label === "send on enter"
            ? "sendOnEnter"
            : label === "screen access"
              ? "screenAccess"
              : "computerControl";
    api.setFlag(flag, on);
    const shown = flag === "reduceMotion" ? "Reduce motion" : label;
    return { message: `${shown} ${on ? "on" : "off"}.` };
  }

  const agent = /\b(plan|build|chat)\s+agent\b/.exec(text);
  if (agent && /(use|switch|set)/.test(text)) {
    api.setDefaultAgent(agent[1] as AgentId);
    return { message: `Default agent is now ${agent[1]}.` };
  }

  const favorite = /(?:favorite|pin|star)\s+(?:the\s+)?(?:model\s+)?(.+)$/.exec(text);
  if (favorite) {
    const wanted = favorite[1].replace(/\bmodel\b/g, "").trim();
    const hit = api.models.find(
      (model) => model.toLowerCase() === wanted || model.toLowerCase().includes(wanted),
    );
    if (hit) {
      api.toggleFavorite(hit);
      return { message: `Pinned ${hit}.` };
    }
  }

  const useModel = /(?:use|switch to|set (?:the )?model to)\s+(.+)$/.exec(text);
  if (useModel) {
    const wanted = useModel[1].trim();
    const all = api.providers.flatMap((provider) =>
      provider.models.map((model) => ({ provider: provider.id, model })),
    );
    const hit =
      all.find((entry) => entry.model.toLowerCase() === wanted) ??
      all.find((entry) => entry.model.toLowerCase().includes(wanted)) ??
      all.find((entry) => entry.model.toLowerCase().replace(/[^a-z0-9]/g, "").includes(wanted.replace(/[^a-z0-9]/g, "")));
    if (hit) {
      api.setModel(hit.provider, hit.model);
      return { message: `Model set to ${hit.model}.` };
    }
  }

  const open = /(?:open|show|go to|switch to)\s+(settings|providers|models|agents|permissions|appearance|integrations|skills|browser|code|chat)\b/.exec(
    text,
  );
  if (open) {
    const target = open[1];
    if (target === "integrations") api.setView("integrations");
    else if (target === "skills") api.setView("skills");
    else if (target === "browser") api.setMode("browser");
    else if (target === "code") api.setMode("code");
    else if (target === "chat") api.setMode("chat");
    else api.openSettings(target as never);
    return { message: `Opened ${target}.` };
  }

  if (/\bgmail\b|\bgoogle (mail|workspace)\b|\bmy inbox\b/.test(text)) {
    api.setView("integrations");
    return {
      message:
        "I opened Integrations → Composio, which is how Freebuff-style connections work: one project key, hosted OAuth for Gmail, Slack, Notion and the rest. Paste the key, connect Gmail, then just say “summarize my inbox”. The Google card below it still works without Composio if you prefer your own OAuth client.",
    };
  }

  if (/\b(slack|notion|linear|calendar|drive|jira)\b/.test(text) && /(connect|integrate|link)/.test(text)) {
    api.setView("integrations");
    return {
      message:
        "Integrations currently speak GitHub (token) and Google/Gmail (OAuth client). Open Integrations to connect either; MCP servers cover the rest.",
    };
  }

  if (/\b(clone|pull|push)\b/.test(text) && /\b(repo|repository|github|code)\b/.test(text)) {
    api.setView("integrations");
    return {
      message:
        "Opened Integrations → GitHub. Connect a token to list and clone repos into the Code tab, or open a repo's file and commit straight back.",
    };
  }

  const browse = /(?:browse to|open|go to|navigate to)\s+((?:https?:\/\/)?[\w-]+(?:\.[\w-]+)+(?:\/\S*)?)$/.exec(
    text,
  );
  if (browse) {
    const raw = browse[1];
    const url = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
    api.setBrowserUrl(url);
    api.setMode("browser");
    return { message: `Opened ${url} in the browser tab.` };
  }

  return null;
}
