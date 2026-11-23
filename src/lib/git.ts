import { inTauri } from "./native";

/**
 * Local git through Tauri. The app never handles credentials: git uses the
 * user's existing Keychain / `gh` / credential-helper setup.
 */

async function call<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!inTauri()) {
    throw new Error("Source control needs the desktop app. A browser tab cannot run git.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export interface GitFile {
  path: string;
  status: string;
  staged: boolean;
}

export interface GitCommit {
  hash: string;
  subject: string;
  author: string;
  when: string;
}

export interface GitStatus {
  repo: boolean;
  branch: string;
  upstream: string;
  ahead: number;
  behind: number;
  files: GitFile[];
  remotes: [string, string][];
  commits: GitCommit[];
}

export async function gitStatus(root: string): Promise<GitStatus> {
  if (!root) {
    return {
      repo: false,
      branch: "",
      upstream: "",
      ahead: 0,
      behind: 0,
      files: [],
      remotes: [],
      commits: [],
    };
  }
  const raw = await call<string>("git_status", { root });
  return JSON.parse(raw) as GitStatus;
}

export const gitDiff = (root: string, path: string | null, staged = false) =>
  call<string>("git_diff", { root, path, staged });

export const gitStage = (root: string, paths: string[] = []) =>
  call<string>("git_stage", { root, paths });

export const gitUnstage = (root: string, paths: string[] = []) =>
  call<string>("git_unstage", { root, paths });

export const gitCommit = (root: string, message: string) =>
  call<string>("git_commit", { root, message });

export const gitPush = (root: string) => call<string>("git_push", { root });

export const gitPull = (root: string) => call<string>("git_pull", { root });

export const gitInit = (root: string) => call<string>("git_init", { root });

export const gitSetRemote = (root: string, url: string) =>
  call<string>("git_set_remote", { root, url });

export const gitBranches = (root: string) => call<string[]>("git_branches", { root });

export const gitCheckout = (root: string, branch: string, create = false) =>
  call<string>("git_checkout", { root, branch, create });

/** `owner/repo` from an https or ssh remote, for a GitHub link. */
export function repoNamespace(remote: string | undefined): string | null {
  if (!remote) return null;
  const https = /^https?:\/\/[^/]*github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/i.exec(remote);
  if (https) return https[1];
  const ssh = /^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/i.exec(remote);
  return ssh ? ssh[1] : null;
}

export function statusLabel(status: string): string {
  switch (status) {
    case "A":
      return "A";
    case "D":
      return "D";
    case "R":
      return "R";
    case "U":
      return "!";
    default:
      return "M";
  }
}
