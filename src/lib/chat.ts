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

/** `data:image/jpeg;base64,…` -> provider-ready parts. */
export function parseImage(
  dataUrl: string,
): { mime: string; data: string } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  return { mime: match[1], data: match[2] };
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
