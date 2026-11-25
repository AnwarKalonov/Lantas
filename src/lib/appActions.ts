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
  apply: () => void;
  /**
   * Reversible app changes apply at once. Permission grants keep the approval
   * card, because they widen what the agent may touch rather than change how
   * the window looks.
   */
  immediate?: boolean;
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
    return {
      message: `Switch the theme to ${theme}.`,
      apply: () => api.setTheme(theme),
      immediate: true,
    };
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
    const shown = flag === "reduceMotion" ? "Reduce motion" : label;
    const permission = flag === "screenAccess" || flag === "computerControl";
    return {
      message: `Turn ${shown.toLowerCase()} ${on ? "on" : "off"}.`,
      apply: () => api.setFlag(flag, on),
      immediate: !permission,
    };
  }

  const agent = /\b(plan|build|chat)\s+agent\b/.exec(text);
  if (agent && /(use|switch|set)/.test(text)) {
    return {
      message: `Use the ${agent[1]} agent by default.`,
      apply: () => api.setDefaultAgent(agent[1] as AgentId),
      immediate: true,
    };
  }

  const favorite = /(?:favorite|pin|star)\s+(?:the\s+)?(?:model\s+)?(.+)$/.exec(text);
  if (favorite) {
    const wanted = favorite[1].replace(/\bmodel\b/g, "").trim();
    const hit = api.models.find(
      (model) => model.toLowerCase() === wanted || model.toLowerCase().includes(wanted),
    );
    if (hit) {
      return { message: `Pin ${hit}.`, apply: () => api.toggleFavorite(hit), immediate: true };
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
      return {
        message: `Switch the model to ${hit.model}.`,
        apply: () => api.setModel(hit.provider, hit.model),
        immediate: true,
      };
    }
  }

  const open = /(?:open|show|go to|switch to)\s+(settings|providers|models|agents|permissions|appearance|integrations|skills|browser|code|chat)\b/.exec(
    text,
  );
  if (open) {
    const target = open[1];
    const go = () => {
      if (target === "integrations") api.setView("integrations");
      else if (target === "skills") api.setView("skills");
      else if (target === "browser") api.setMode("browser");
      else if (target === "code") api.setMode("code");
      else if (target === "chat") api.setMode("chat");
      else api.openSettings(target as never);
    };
    return { message: `Open ${target}.`, apply: go, immediate: true };
  }

  // Nothing here opens a web page. "Open desmos" is a request the assistant
  // answers with its browser tool, so the model decides the address instead of
  // a regex in the app opening an approximation of it.
  return null;
}
