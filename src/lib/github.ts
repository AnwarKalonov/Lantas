import { httpFetch } from "./providers";
import type { WorkspaceFile } from "./types";

const TOKEN_KEY = "lantas.github.v1";
const API = "https://api.github.com";

export function getGithubToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setGithubToken(token: string) {
  if (token.trim()) localStorage.setItem(TOKEN_KEY, token.trim());
  else localStorage.removeItem(TOKEN_KEY);
}

export interface Repo {
  full_name: string;
  name: string;
  owner: string;
  private: boolean;
  default_branch: string;
  description: string | null;
  updated_at: string;
  html_url: string;
  clone_url: string;
}

export interface TreeEntry {
  path: string;
  type: "blob" | "tree";
  size?: number;
  sha: string;
}

export class GithubError extends Error {}

export async function gh<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getGithubToken();
  if (!token) throw new GithubError("Connect GitHub first — a personal access token with repo scope.");
  const response = await httpFetch(`${API}${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let detail = text.slice(0, 200);
    try {
      detail = JSON.parse(text)?.message ?? detail;
    } catch {
      /* keep raw */
    }
    throw new GithubError(`${response.status} · ${detail}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function whoami(): Promise<{ login: string; name: string | null; avatar_url: string }> {
  return gh("/user");
}

export async function listRepos(): Promise<Repo[]> {
  const data = await gh<any[]>(
    "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member",
  );
  return data.map((repo) => ({
    full_name: repo.full_name,
    name: repo.name,
    owner: repo.owner?.login ?? repo.full_name.split("/")[0],
    private: Boolean(repo.private),
    default_branch: repo.default_branch ?? "main",
    description: repo.description,
    updated_at: repo.updated_at,
    html_url: repo.html_url,
    clone_url: repo.clone_url,
  }));
}

export async function createRepo(name: string, isPrivate: boolean, description = ""): Promise<Repo> {
  const repo = await gh<any>("/user/repos", {
    method: "POST",
    // Empty on purpose: the first push from the open folder creates the branch.
    body: JSON.stringify({ name, private: isPrivate, description, auto_init: false }),
  });
  return {
    full_name: repo.full_name,
    name: repo.name,
    owner: repo.owner.login,
    private: repo.private,
    default_branch: repo.default_branch ?? "main",
    description: repo.description,
    updated_at: repo.updated_at,
    html_url: repo.html_url,
    clone_url: repo.clone_url,
  };
}

export async function getTree(fullName: string, branch: string): Promise<TreeEntry[]> {
  const info = await gh<any>(`/repos/${fullName}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  return (info.tree ?? []).filter((entry: any) => entry.type === "blob").map((entry: any) => ({
    path: entry.path,
    type: "blob",
    size: entry.size,
    sha: entry.sha,
  }));
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function fromBase64(value: string): string {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

const TEXT_FILE = /\.(md|mdx|txt|ts|tsx|js|jsx|json|css|scss|html|yml|yaml|toml|rs|py|go|rb|sh|swift|kt|java|c|h|cpp|sql|env\.example)$/i;

export async function getFile(
  fullName: string,
  path: string,
  branch: string,
): Promise<{ text: string; sha: string }> {
  const data = await gh<any>(
    `/repos/${fullName}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${encodeURIComponent(branch)}`,
  );
  return { text: fromBase64(data.content ?? ""), sha: data.sha };
}

export async function commitFile(
  fullName: string,
  path: string,
  content: string,
  message: string,
  branch: string,
  sha?: string,
): Promise<void> {
  await gh(`/repos/${fullName}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: toBase64(content),
      branch,
      ...(sha ? { sha } : {}),
    }),
  });
}

/** Pull a repo into the Code tab as a readable snapshot. */
export async function loadRepo(
  fullName: string,
  branch: string,
  limit = 32,
): Promise<WorkspaceFile[]> {
  const tree = await getTree(fullName, branch);
  const candidates = tree
    .filter((entry) => TEXT_FILE.test(entry.path) && (entry.size ?? 0) < 120_000)
    .sort((a, b) => (a.size ?? 0) - (b.size ?? 0))
    .slice(0, limit);

  const files: WorkspaceFile[] = [];
  for (const entry of candidates) {
    try {
      const file = await getFile(fullName, entry.path, branch);
      files.push({
        id: `${fullName}:${entry.path}`,
        name: entry.path.split("/").pop() ?? entry.path,
        path: `${fullName}/${entry.path}`,
        size: entry.size ?? file.text.length,
        text: file.text,
        added: 0,
      });
    } catch {
      /* skip unreadable blob */
    }
  }
  return files;
}
