import type { ChatTurn } from "./providers";
import type { AgentId, Session, Skill, WorkspaceFile } from "./types";
import { TOOL_MANUAL } from "./tools";

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
  const summaryBlock = runningSummary
    ? `\n\nCondensed earlier conversation (older turns were dropped from the live history; treat it as context, not a new request):\n${runningSummary}`
    : "";

  return [
    "You are Lantas, a coding agent working inside the user's workspace.",
    `Workspace: ${session.cwd}. Branch: ${session.branch}.`,
    AGENT_ROLE[session.agent],
    "Only state that an account, page or file is available when a tool result or the context below says so. If you did not check, say you did not check.",
    "Be concise and specific. Use sentence case. No emoji. Prefer short paragraphs, and use inline code for identifiers.",
    TOOL_MANUAL,
  ].join("\n\n") + treeBlock + gitBlock + summaryBlock + skillBlock + dormantBlock;
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
