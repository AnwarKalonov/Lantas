import type { ChatTurn } from "./providers";
import type { AgentId, Session, Skill } from "./types";

const AGENT_ROLE: Record<AgentId, string> = {
  build:
    "You are in Build mode: you may propose file edits and commands. Describe changes concretely and keep them scoped to the request.",
  plan:
    "You are in Plan mode: you are read-only. Do not claim to have edited files. Produce a plan the user can approve.",
  chat: "You are in Chat mode: answer questions about the codebase without proposing file edits.",
};

export function buildSystemPrompt(session: Session, skills: Skill[]): string {
  const enabled = skills.filter((skill) => skill.enabled);
  const skillBlock = enabled.length
    ? `\n\nSkills you follow when relevant:\n${enabled
        .map((skill) => `- ${skill.name}: ${skill.instructions}`)
        .join("\n")}`
    : "";

  return [
    "You are Lantas, a coding agent working inside the user's workspace.",
    `Workspace: ${session.cwd}. Branch: ${session.branch}.`,
    AGENT_ROLE[session.agent],
    "Be concise and specific. Use sentence case. No emoji. Prefer short paragraphs, and use inline code for identifiers.",
  ].join(" ") + skillBlock;
}

export function buildHistory(session: Session, limit = 16): ChatTurn[] {
  const turns: ChatTurn[] = [];

  for (const message of session.messages) {
    const text = message.parts
      .map((part) => {
        if (part.kind === "text") return part.text;
        if (part.kind === "shell") return `$ ${part.command}\n${part.output.join("\n")}`;
        if (part.kind === "diff") return `Changed ${part.path} (+${part.added} −${part.removed})`;
        return "";
      })
      .filter(Boolean)
      .join("\n\n")
      .trim();

    if (!text) continue;
    turns.push({ role: message.role, content: text.slice(0, 8000) });
  }

  return turns.slice(-limit);
}
