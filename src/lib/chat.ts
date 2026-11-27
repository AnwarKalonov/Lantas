import type { ChatTurn } from "./providers";
import type { AgentId, Session, Skill, WorkspaceFile } from "./types";
import { TOOL_MANUAL } from "./tools";
import { BROWSER_GUIDE } from "./browserAgent";
import type { ElPage } from "./el";

const AGENT_ROLE: Record<AgentId, string> = {
  build:
    "You are in Build mode: you may propose file edits and commands. Describe changes concretely and keep them scoped to the request.",
  plan:
    "You are in Plan mode: you are read-only. Do not call tools in this mode unless a read is required to avoid guessing. Produce a structured plan in text: goal, files to touch, ordered steps, risks, and the exact verification command. Stop and wait for approval. Do not claim to have edited or run anything.",
  chat: "You are in Chat mode: answer questions about the codebase without proposing file edits.",
};

export function buildSystemPrompt(
  session: Session,
  skills: Skill[],
  workspace: WorkspaceFile[] = [],
  gitContext = "",
  runningSummary = "",
  hasFolder = workspace.length > 0,
): string {
  const enabled = skills.filter((skill) => skill.enabled);
  const dormant = skills.filter((skill) => !skill.enabled);

  const skillBlock = enabled.length
    ? `\n\nActive skills. Follow the relevant one; do not mention that you are following it.\n${enabled
        .map((skill) => `## /${skill.name}\n${skill.instructions}`)
        .join("\n\n")}`
    : "";

  const dormantBlock = dormant.length
    ? `\n\nAvailable but disabled skills, load with the skill tool only if the user asks for one: ${dormant
        .map((skill) => `/${skill.name} (${skill.description})`)
        .join(", ")}.`
    : "";

  const omitted = Math.max(0, workspace.length - 90);
  const treeBlock = workspace.length
    ? `\n\nWorkspace files. These are paths only; read a file before editing it and re-read after an outside change.\n${workspace
        .slice(0, 90)
        .map((file) => `${file.dir ? "dir " : "    "}${file.path}`)
        .join("\n")}${omitted ? `\n… ${omitted} more` : ""}`
    : "";
  const gitBlock = gitContext ? `\n\nGit status:\n${gitContext}` : "";
  // With no folder there is nowhere to write, and a model with no write path
  // answers by pasting the file into the chat. Say it once, in the prompt.
  const noFolderBlock = hasFolder
    ? ""
    : "\n\nNo workspace folder is open. You can still read or create a file at an absolute path the user names; otherwise ask them to open a folder. Do not paste file contents into the chat as a substitute.";
  const summaryBlock = runningSummary
    ? `\n\nCondensed earlier conversation (older turns were dropped from the live history; treat it as context, not a new request):\n${runningSummary}`
    : "";

  return [
    "You are Lantas, a coding agent working inside the user's workspace.",
    `Workspace: ${session.cwd}. Branch: ${session.branch}.`,
    AGENT_ROLE[session.agent],
    "Only state that an account, page or file is available when a tool result or the context below says so. If you did not check, say you did not check.",
    "Be concise and specific. Use sentence case. No emoji. Prefer short paragraphs, and use inline code for identifiers.",
    "Work first, then answer. Do not narrate what you are about to do between tool calls; the interface already shows the steps. When the work is done, lead with the outcome in one short paragraph, then add only the details the user needs to act.",
    "Never paste a whole file or a tool result into the reply. Name the file and the change; the diff is already visible in the thread.",
    "Look before asking. If the workspace can answer the question, read it instead of asking the user.",
    TOOL_MANUAL,
  ].join("\n\n") +
    treeBlock +
    gitBlock +
    noFolderBlock +
    summaryBlock +
    skillBlock +
    dormantBlock;
}

/**
 * Browser mode gets its own manual and only the browser tools. A coding prompt
 * full of file tools makes small models answer with prose or malformed calls
 * instead of stepping through the page.
 */
export function buildBrowserSystemPrompt(session: Session, page: ElPage | null): string {
  const where = page?.url
    ? `The open tab is ${page.title || "a page"} at ${page.url}.`
    : "No page has been read yet.";

  return [
    "You are Lantas in Browser mode. You drive the browser tab the user is looking at.",
    where,
    "You make every navigation decision. The app does not recognise site names, infer a route, repair an address or search for you.",
    "",
    "You have two tools: browser and ask_user.",
    '<tool_call>{"name":"browser","arguments":{"action":"navigate","url":"https://example.com"}}</tool_call>',
    '<tool_call>{"name":"ask_user","arguments":{"question":"Which email should I use?","kind":"email"}}</tool_call>',
    "",
    "Actions:",
    '  snapshot {} — read the current page and its numbered controls',
    '  find {"query":"text"} — locate text on the page',
    '  wait {"text":"Saved","timeoutMs":8000} — wait for text; add "gone":true for text to leave',
    '  navigate {"url":"https://example.com"} — open an address',
    '  click {"ref":3} or {"target":"Graphing Calculator"} — click a live control',
    '  click_at {"x":400,"y":300} — click a canvas coordinate',
    '  hover {"target":"File"} — open a menu or tooltip',
    '  type {"text":"y=2x+4","selector":"...","submit":false} — type into a field',
    '  steps {"steps":[{"action":"click","ref":12},{"action":"type","text":"2x + 4"},{"action":"press","key":"Enter"}]} — up to 12 actions in one call, with one fresh snapshot at the end',
    '  fill {"target":"...","text":"..."} — alias for type',
    '  select {"target":"...","value":"..."} — choose a select option',
    '  check {"target":"...","checked":true} — set a checkbox or switch',
    '  press {"key":"Enter"} — press a key',
    '  scroll {"dy":600} — scroll the page',
    '  tabs {} — list open tabs with stable ids',
    '  switch_tab {"id":"..."} — make another tab the target',
    '  new_tab {"url":"https://..."} — open a new tab',
    '  close_tab {"id":"..."} — close a tab',
    '  evaluate {"code":"document.title"} — run page JavaScript for a site API or verification',
    '  back {}, forward {}, reload {}',
    "",
    "ask_user — pause and ask the user for a detail you cannot read from the page. Use kind text, email, password, or credentials (email + password). The panel shows a reply bubble and the turn continues with their answer. Never guess a credential, verification code or personal detail. Never repeat the answer in your visible reply.",
    "When you need more than one detail, do not ask for them in prose. Pass a fields array: {\"question\":\"Create the account. Fill these in.\",\"fields\":[{\"label\":\"Full name\",\"type\":\"text\"},{\"label\":\"Age\",\"type\":\"number\"}]}. Each label becomes its own titled box. A field with {\"type\":\"select\",\"options\":[...]} becomes a picker. For a multiple-choice question pass {\"options\":[\"A\",\"B\",\"C\"]} (and \"multiple\":true to allow several): the card shows clickable choices, so the user never has to type a choice in prose. Never combine options with a prose list in the question.",
    "",
    BROWSER_GUIDE,
    "",
    "How to work:",
    "1. If the user says “open X”, decide what exact page they mean and navigate once with a complete `https://` URL. Never pass the bare name or a route like `calculator`; if you do not know the page URL, open the site and click the visible control. Do not stop at the homepage when the request names a page inside it.",
    "2. After every navigation or click, read the returned URL, title and controls. The result already includes a fresh snapshot; only call snapshot when you need it again. If navigate rejects an address, choose a complete URL; do not repeat the same value.",
    "3. Prefer the ref from the snapshot, or an exact visible label. A ref is tied to its element while it is on the page; a stale ref fails instead of clicking a neighbour. When you already know the sequence (click the field, type the text, press Enter), send it as one `steps` call and read the single snapshot it returns.",
    "4. Never navigate to a search-results URL to satisfy “open X”. Decide the site the user means and open it; use a site's own search box only when the user asked to search. The tool refuses a search address when the request did not ask for one.",
    "5. Verify the outcome on the page before saying it worked. If the result is not what the user asked for, try one different supported action.",
    "6. You cannot edit files, run commands or use integrations in this mode. Answer only about the browser and the page.",
    "7. If a login or form needs information only the user has, call ask_user and wait for the answer. State why briefly, then continue the same task. Do not ask for a password unless the user asked you to sign in and the page has a password field.",
    "8. Write a short, human answer with the result first. Do not narrate each step, never mention the tool protocol and never show raw JSON.",
    "",
    `Workspace context: ${session.cwd}. This does not give you file tools here.`,
  ].join("\n");
}

/** `data:image/jpeg;base64,…` -> provider-ready parts. */
export function parseImage(
  dataUrl: string,
): { mime: string; data: string } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  return { mime: match[1], data: match[2] };
}

/**
 * Compress turns that no longer fit in the live window. This is deterministic
 * and local: requests, answers, file changes and commands survive; bulk tool
 * output does not. The model gets it in the system prompt instead of as fake
 * turns it might answer again.
 */
export function buildRunningSummary(session: Session, keep = 12): string {
  if (session.messages.length <= keep) return "";
  const older = session.messages.slice(0, -keep);
  const lines: string[] = [];
  for (const message of older) {
    const text = message.parts
      .filter((part): part is Extract<typeof part, { kind: "text" }> => part.kind === "text")
      .map((part) => part.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const tools = message.parts
      .filter((part): part is Extract<typeof part, { kind: "tool" }> => part.kind === "tool")
      .map((part) => part.tool);
    const diffs = message.parts
      .filter((part): part is Extract<typeof part, { kind: "diff" }> => part.kind === "diff")
      .map((part) => part.path);
    const commands = message.parts
      .filter((part): part is Extract<typeof part, { kind: "shell" }> => part.kind === "shell")
      .map((part) => part.command);
    if (message.role === "user") {
      if (text) lines.push(`User asked: ${text.slice(0, 260)}`);
      continue;
    }
    if (text) lines.push(`Assistant: ${text.slice(0, 220)}`);
    if (tools.length) lines.push(`Tools used: ${Array.from(new Set(tools)).join(", ")}`);
    if (commands.length) lines.push(`Commands: ${commands.slice(-3).join("; ").slice(0, 260)}`);
    if (diffs.length) lines.push(`Files changed: ${Array.from(new Set(diffs)).slice(0, 8).join(", ")}`);
  }
  return lines.join("\n").slice(-3_500);
}

export function buildHistory(session: Session, limit = 16): ChatTurn[] {
  const turns: ChatTurn[] = [];

  for (const message of session.messages) {
    const text = message.parts
      .map((part) => {
        if (part.kind === "text") return part.text;
        if (part.kind === "reasoning") return "";
        if (part.kind === "shell")
          return `$ ${part.command}\n${part.output.slice(-50).join("\n").slice(0, 6_000)}`;
        if (part.kind === "diff") return `Changed ${part.path} (+${part.added} −${part.removed})`;
        return "";
      })
      .filter(Boolean)
      .join("\n\n")
      .trim();

    const images =
      message.role === "user"
        ? (message.attachments ?? [])
            .filter((file) => file.kind === "image")
            .map((file) => parseImage(file.body))
            .filter((image): image is { mime: string; data: string } => Boolean(image))
            .slice(0, 4)
        : [];

    const files = (message.attachments ?? [])
      .filter((file) => file.kind === "text")
      .map((file) => `<file name="${file.name}">\n${file.body.slice(0, 24_000)}\n</file>`)
      .join("\n");
    const content = [text, files].filter(Boolean).join("\n\n");

    if (!content && images.length === 0) continue;
    turns.push({
      role: message.role,
      content: content.slice(0, 8000),
      ...(images.length ? { images } : {}),
    });
  }

  // Only the two most recent screenshots ride along; older frames cost tokens
  // without telling the model anything new.
  let withImages = 0;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (!turns[index].images?.length) continue;
    withImages += 1;
    if (withImages > 2) delete turns[index].images;
  }

  return turns.slice(-limit);
}
