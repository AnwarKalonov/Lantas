import { runToolLoop } from "./agentRuntime";
import { BROWSER_GUIDE, setBrowserEngineOverride } from "./browserAgent";
import type { ChromeElement, ChromePage } from "./chrome";
import type { PermissionRule } from "./permissions";
import type { ProviderConfig, ProviderId } from "./types";
import type { ChatTurn, StreamUsage } from "./providers";

/**
 * One browser turn, run through the same tool loop as the coding agent.
 *
 * Cheap models drive the browser badly when they have to emit a single magic
 * block at the end of a reply. Here the page is a live tool result, every
 * action returns the new controls, and the model can take several steps before
 * answering. The tool list is restricted to `browser`, so a side-panel turn can
 * never touch the filesystem.
 */

const ACT_RULES: PermissionRule[] = [{ tool: "browser", pattern: "*", effect: "allow" }];
/** Ask mode can read, and nothing else. Enforced, not just asked for in the prompt. */
const ASK_RULES: PermissionRule[] = [
  { tool: "browser", pattern: "*", effect: "deny" },
  { tool: "browser", pattern: "snapshot", effect: "allow" },
  { tool: "browser", pattern: "extract", effect: "allow" },
];

export interface BrowserTurnOptions {
  provider: ProviderId;
  config: ProviderConfig;
  model: string;
  prompt: string;
  page: ChromePage | null;
  elements: ChromeElement[] | null;
  mode: "ask" | "act";
  /** Earlier user/assistant turns for this panel, without page snapshots. */
  history?: ChatTurn[];
  signal: AbortSignal;
  onStatus?: (text: string) => void;
  onUsage?: (usage: StreamUsage) => void;
}

export interface BrowserTurnResult {
  text: string;
  steps: number;
  tools: number;
  stopped: "answer" | "limit" | "aborted";
  error?: string;
  /** The turn to keep for the next question in this panel. */
  history: ChatTurn[];
}

function pageBlock(page: ChromePage | null, elements: ChromeElement[] | null): string {
  if (!page) {
    return "<page>No page could be read. Ask the user to open a website, or navigate first.</page>";
  }
  const controls = (elements ?? [])
    .slice(0, 140)
    .map((el) => `${el.i}. [${el.kind}] ${el.label}`)
    .join("\n");
  return [
    `<page url="${page.url}" title="${page.title}">`,
    page.text.slice(0, 14_000),
    "</page>",
    controls ? `<controls>\n${controls}\n</controls>` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function systemPrompt(mode: "ask" | "act"): string {
  return [
    "You are Lantas, inside the Chrome side panel next to the tab the user is reading.",
    "The tab's live text and numbered controls are in the user message. Controls come from a real accessibility scan and their numbers are valid right now.",
    "You choose every destination. The app does not recognise site names, guess a route, repair an address or search for you.",
    "",
    "You have exactly one tool:",
    '  <tool_call>{"name":"browser","arguments":{"action":"..."}}</tool_call>',
    "",
    "Actions and arguments:",
    "  snapshot {} — re-read the page and controls",
    "  extract {} — the page text",
    "  click {ref} or {target} or {selector} — prefer ref from the latest controls",
    "  click_at {x, y} — real mouse click at viewport coordinates",
    "  type {text, selector?, submit?} — type into a field; submit:true presses Enter",
    "  evaluate {code} — run page JavaScript, for a site's documented API or verification",
    "  press {key} — Enter, Tab, Escape, arrows",
    "  scroll {dy} — pixels; positive is down",
    "  tabs {} — list tabs with ids",
    "  switch_tab {id} or {index} — target another tab",
    "  new_tab {url} — open a new tab",
    "  close_tab {id} or {index} — close a tab",
    "  navigate {url} — open a full address",
    "  back {}, forward {}, reload {}",
    "",
    BROWSER_GUIDE,
    "",
    "How to work:",
    "1. Answer from the page text when you can; do not act just because you can.",
    "2. When you act, make one tool call, read its result, then decide the next step. Every action result already includes the new URL, title and controls. Navigate only with a complete https:// URL; if the tool rejects one, choose the real page instead of repeating it.",
    "3. Use the control number (ref) rather than guessing a selector or coordinates.",
    "4. After signing in, submitting, or navigating, verify the new state before claiming success.",
    "5. Never claim an action ran unless a tool result says it did. If the tool fails, say what happened and try one different approach.",
    mode === "act"
      ? "6. The user put you in Act mode: you may click, type and navigate in this tab."
      : "6. The user put you in Ask mode: do not click, type, navigate or press keys. Read and explain only. If the request needs an action, say to switch to Act.",
    "",
    "Write like a person in a side panel: short paragraphs, no headings, no emoji, no markdown tables. Do not mention the tool protocol.",
  ].join("\n");
}

export async function runBrowserTurn(options: BrowserTurnOptions): Promise<BrowserTurnResult> {
  let visible = "";
  let tools = 0;

  // The panel always means the user's Chrome tab, whatever the app's own
  // browser engine is set to.
  setBrowserEngineOverride("chrome");
  try {
    options.onStatus?.("Reading the page");
    const result = await runToolLoop({
      provider: options.provider,
      config: options.config,
      model: options.model,
      system: systemPrompt(options.mode),
      messages: [
        ...(options.history ?? []).slice(-8),
        {
          role: "user",
          content: [options.prompt, pageBlock(options.page, options.elements)]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
      ctx: {
        files: [],
        root: "",
        agent: options.mode === "act" ? "build" : "plan",
        skills: [],
        saveFile: async () => false,
        drive: options.mode === "act",
        task: options.prompt,
      },
      rules: options.mode === "act" ? ACT_RULES : ASK_RULES,
      only: ["browser"],
      signal: options.signal,
      maxSteps: 8,
      approve: async () => true,
      onText: (chunk) => {
        visible += chunk;
      },
      onToolStart: (_id, call, label) => {
        tools += 1;
        options.onStatus?.(label || String(call.args.action ?? "Using the page"));
      },
      onToolDone: (_id, outcome) => {
        options.onStatus?.(outcome.ok ? "Checked the result" : "That did not work; trying another way");
      },
      onUsage: options.onUsage,
    });

    const text = visible.trim();
    const nextHistory: ChatTurn[] = [
      ...(options.history ?? []).slice(-8),
      { role: "user" as const, content: options.prompt },
      ...(text ? [{ role: "assistant" as const, content: text }] : []),
    ].slice(-10);
    return {
      text,
      steps: result.steps,
      tools,
      stopped: result.stopped,
      history: nextHistory,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        text: visible.trim(),
        steps: 0,
        tools,
        stopped: "aborted",
        history: options.history ?? [],
      };
    }
    return {
      text: visible.trim(),
      steps: 0,
      tools,
      stopped: "answer",
      error: error instanceof Error ? error.message : String(error),
      history: options.history ?? [],
    };
  } finally {
    setBrowserEngineOverride(null);
  }
}
