import { strFromU8, unzipSync } from "fflate";

export interface ParsedSkill {
  name: string;
  description: string;
  instructions: string;
}

const MAX_TEXT = 240_000;

function baseName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function folderName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 2] ?? "";
}

function parseFrontmatter(text: string): {
  meta: Record<string, string>;
  body: string;
} {
  if (!text.startsWith("---")) return { meta: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { meta: {}, body: text };
  const head = text.slice(3, end).trim();
  const body = text.slice(end + 4).replace(/^\r?\n/, "");
  const meta: Record<string, string> = {};
  for (const line of head.split("\n")) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    meta[match[1].toLowerCase()] = match[2].replace(/^["']|["']$/g, "").trim();
  }
  return { meta, body };
}

/** A SKILL.md, or a plain markdown file with a `name:` header. */
export function parseSkillMarkdown(path: string, raw: string): ParsedSkill | null {
  const text = raw.slice(0, MAX_TEXT);
  const { meta, body } = parseFrontmatter(text);
  const fallback = folderName(path) || baseName(path).replace(/\.md$/i, "");
  const name = (meta.name || fallback).replace(/^\/+/, "").trim();
  const instructions = body.trim();
  if (!name || !instructions) return null;
  return {
    name,
    description: meta.description || instructions.split("\n").find(Boolean)?.slice(0, 160) || "Imported skill",
    instructions,
  };
}

/**
 * GitHub-style skill archives: either a repo zip (`repo-main/…/SKILL.md`) or a
 * single markdown file. Nested SKILL.md files each become their own skill.
 */
export async function parseSkillZip(file: File): Promise<ParsedSkill[]> {
  if (!/\.zip$/i.test(file.name)) {
    const text = await file.text();
    const skill = parseSkillMarkdown(file.name, text);
    return skill ? [skill] : [];
  }

  const buffer = new Uint8Array(await file.arrayBuffer());
  const entries = unzipSync(buffer);
  const found: ParsedSkill[] = [];

  for (const [path, bytes] of Object.entries(entries)) {
    if (path.endsWith("/") || bytes.length === 0) continue;
    if (!/\.md$/i.test(path)) continue;
    if (!/(^|\/)skill\.md$/i.test(path)) continue;
    const skill = parseSkillMarkdown(path, strFromU8(bytes));
    if (skill) found.push(skill);
  }

  if (found.length === 0) {
    for (const [path, bytes] of Object.entries(entries)) {
      if (path.endsWith("/") || !/\.md$/i.test(path) || bytes.length === 0) continue;
      const text = strFromU8(bytes);
      if (!/^---[\s\S]*?name:/i.test(text)) continue;
      const skill = parseSkillMarkdown(path, text);
      if (skill) found.push(skill);
    }
  }

  return found;
}
