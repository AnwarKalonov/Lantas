//! Local git, driven by the IDE.
//!
//! Every command runs the user's own `git` in the folder they opened. Credentials
//! stay with git (macOS Keychain, `gh`, or a configured credential helper). A
//! connected GitHub token is accepted only for an HTTPS GitHub origin, passed
//! through a one-command config header, and never written or logged.

use base64::Engine;
use serde::Serialize;
use std::path::Path;
use std::process::Command;

#[derive(Serialize)]
struct FileChange {
    path: String,
    status: String,
    staged: bool,
}

#[derive(Serialize)]
struct Commit {
    hash: String,
    subject: String,
    author: String,
    when: String,
}

#[derive(Serialize)]
struct Status {
    repo: bool,
    branch: String,
    upstream: String,
    ahead: u32,
    behind: u32,
    files: Vec<FileChange>,
    remotes: Vec<(String, String)>,
    commits: Vec<Commit>,
}

/// GUI apps start with a thin PATH; Homebrew git lives outside it on Apple silicon.
fn git_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    format!(
        "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:{}",
        current
    )
}

struct Output {
    ok: bool,
    stdout: String,
    stderr: String,
}

fn run(root: &str, args: &[&str]) -> Result<Output, String> {
    run_with_header(root, args, None)
}

/// A GitHub token is used only for this process and only for an HTTPS GitHub
/// origin. It is never written to the remote, config, or disk.
fn github_header(root: &str, token: Option<String>) -> Option<String> {
    let token = token?;
    let token = token.trim();
    if token.is_empty() {
        return None;
    }
    let origin = run(root, &["remote", "get-url", "origin"]).ok()?;
    if !origin.ok
        || !origin.stdout.starts_with("https://")
        || !origin.stdout.contains("github.com")
    {
        return None;
    }
    let encoded = base64::engine::general_purpose::STANDARD
        .encode(format!("x-access-token:{token}"));
    Some(format!("Authorization: Basic {encoded}"))
}

fn run_with_header(
    root: &str,
    args: &[&str],
    authorization: Option<&str>,
) -> Result<Output, String> {
    let dir = Path::new(root);
    if !dir.is_dir() {
        return Err("Open a folder before using source control.".into());
    }
    if root.contains('\0') {
        return Err("That folder path is not valid.".into());
    }

    let mut command = Command::new("git");
    command
        .env("PATH", git_path())
        .env("GIT_TERMINAL_PROMPT", "0")
        .current_dir(dir)
        .args(args);
    if let Some(header) = authorization {
        // GIT_CONFIG_* keeps the token out of argv and out of the repository.
        command
            .env("GIT_CONFIG_COUNT", "1")
            .env("GIT_CONFIG_KEY_0", "http.extraHeader")
            .env("GIT_CONFIG_VALUE_0", header);
    }
    let output = command
        .output()
        .map_err(|error| format!("git could not start: {error}"))?;

    Ok(Output {
        ok: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).trim_end().to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).trim_end().to_string(),
    })
}

fn json<T: Serialize>(value: &T) -> Result<String, String> {
    serde_json::to_string(value).map_err(|error| error.to_string())
}

fn branch_of(head: &str) -> String {
    head.trim_start_matches("## ").split("...").next().unwrap_or("").trim().to_string()
}

fn upstream_of(head: &str) -> String {
    head.split("...").nth(1).unwrap_or("").split(' ').next().unwrap_or("").trim().to_string()
}

/// Snapshot for the Source Control view: branch, upstream, changes and recent commits.
#[tauri::command]
pub fn git_status(root: String) -> Result<String, String> {
    let inside = run(&root, &["rev-parse", "--is-inside-work-tree"])?;
    if !inside.ok || inside.stdout.trim() != "true" {
        return json(&Status {
            repo: false,
            branch: String::new(),
            upstream: String::new(),
            ahead: 0,
            behind: 0,
            files: Vec::new(),
            remotes: Vec::new(),
            commits: Vec::new(),
        });
    }

    let status = run(
        &root,
        &["status", "--porcelain=v1", "--branch", "--no-renames"],
    )?;
    let mut branch = String::new();
    let mut upstream = String::new();
    let mut ahead = 0;
    let mut behind = 0;
    let mut files: Vec<FileChange> = Vec::new();

    for line in status.stdout.lines() {
        if let Some(head) = line.strip_prefix("## ") {
            branch = branch_of(head);
            upstream = upstream_of(head);
            if let Some(rest) = head.split('[').nth(1) {
                for part in rest.trim_end_matches(']').split(',') {
                    let part = part.trim();
                    if let Some(n) = part.strip_prefix("ahead ") {
                        ahead = n.parse().unwrap_or(0);
                    } else if let Some(n) = part.strip_prefix("behind ") {
                        behind = n.parse().unwrap_or(0);
                    }
                }
            }
            continue;
        }
        if line.len() < 3 {
            continue;
        }
        let index = &line[0..1];
        let work = &line[1..2];
        let path = line[3..].trim().to_string();
        if path.is_empty() {
            continue;
        }
        let (status_char, staged) = if index != " " && index != "?" {
            (index, true)
        } else if index == "?" {
            ("A", false)
        } else {
            (work, false)
        };
        files.push(FileChange {
            path,
            status: match status_char {
                "M" => "M",
                "A" => "A",
                "D" => "D",
                "R" => "R",
                "U" => "U",
                _ => "M",
            }
            .to_string(),
            staged,
        });
    }

    let log = run(
        &root,
        &["log", "-8", "--pretty=%h%x1f%s%x1f%an%x1f%ar"],
    )?;
    let commits = if log.ok {
        log.stdout
            .lines()
            .filter_map(|line| {
                let mut parts = line.split('\x1f');
                Some(Commit {
                    hash: parts.next()?.to_string(),
                    subject: parts.next()?.to_string(),
                    author: parts.next()?.to_string(),
                    when: parts.next()?.to_string(),
                })
            })
            .collect()
    } else {
        Vec::new()
    };

    let remote = run(&root, &["remote", "-v"])?;
    let mut remotes: Vec<(String, String)> = Vec::new();
    for line in remote.stdout.lines() {
        let mut parts = line.split_whitespace();
        let name = parts.next().unwrap_or("").to_string();
        let url = parts.next().unwrap_or("").to_string();
        if !name.is_empty() && !remotes.iter().any(|(n, _)| n == &name) {
            remotes.push((name, url));
        }
    }

    json(&Status {
        repo: true,
        branch,
        upstream,
        ahead,
        behind,
        files,
        remotes,
        commits,
    })
}

/// Unified diff for one file, or the whole working tree when path is empty.
#[tauri::command]
pub fn git_diff(root: String, path: Option<String>, staged: bool) -> Result<String, String> {
    let mut args: Vec<String> = vec!["diff".into(), "--no-color".into(), "--unified=4".into()];
    if staged {
        args.push("--cached".into());
    }
    if let Some(path) = path.filter(|value| !value.trim().is_empty()) {
        args.push("--".into());
        args.push(path);
    }
    let borrowed: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = run(&root, &borrowed)?;
    Ok(if out.ok {
        out.stdout
    } else {
        format!("{}\n{}", out.stdout, out.stderr).trim().to_string()
    })
}

#[tauri::command]
pub fn git_stage(root: String, paths: Vec<String>) -> Result<String, String> {
    let mut args: Vec<String> = vec!["add".into(), "--".into()];
    if paths.is_empty() {
        args = vec!["add".into(), "-A".into()];
    } else {
        args.extend(paths);
    }
    let borrowed: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = run(&root, &borrowed)?;
    if out.ok {
        Ok("Staged".into())
    } else {
        Err(out.stderr)
    }
}

#[tauri::command]
pub fn git_unstage(root: String, paths: Vec<String>) -> Result<String, String> {
    let mut args: Vec<String> = vec!["reset".into(), "--quiet".into(), "HEAD".into(), "--".into()];
    if paths.is_empty() {
        args = vec!["reset".into(), "--quiet".into(), "HEAD".into()];
    } else {
        args.extend(paths);
    }
    let borrowed: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = run(&root, &borrowed)?;
    if out.ok {
        Ok("Unstaged".into())
    } else {
        Err(out.stderr)
    }
}

#[tauri::command]
pub fn git_commit(root: String, message: String) -> Result<String, String> {
    let clean = message.trim();
    if clean.is_empty() {
        return Err("Write a commit message first.".into());
    }
    let out = run(&root, &["commit", "-m", clean])?;
    if out.ok {
        Ok(out.stdout)
    } else {
        Err(format!("{}{}", out.stderr, out.stdout).trim().to_string())
    }
}

/// Pushes the current branch. The first push creates the upstream automatically.
#[tauri::command]
pub fn git_push(root: String, token: Option<String>) -> Result<String, String> {
    let status = git_status(root.clone())?;
    let parsed: serde_json::Value =
        serde_json::from_str(&status).map_err(|error| error.to_string())?;
    if !parsed.get("repo").and_then(|value| value.as_bool()).unwrap_or(false) {
        return Err("This folder is not a git repository.".into());
    }
    let header = github_header(&root, token);
    if parsed.get("upstream").and_then(|value| value.as_str()).unwrap_or("").is_empty() {
        let out = run_with_header(
            &root,
            &["push", "-u", "origin", "HEAD"],
            header.as_deref(),
        )?;
        return if out.ok {
            Ok(out.stdout.lines().last().unwrap_or("Pushed").to_string())
        } else {
            Err(out.stderr)
        };
    }
    let out = run_with_header(&root, &["push"], header.as_deref())?;
    if out.ok {
        Ok(out.stdout.lines().last().unwrap_or("Pushed").to_string())
    } else {
        Err(out.stderr)
    }
}

#[tauri::command]
pub fn git_pull(root: String, token: Option<String>) -> Result<String, String> {
    let header = github_header(&root, token);
    let out = run_with_header(&root, &["pull", "--ff-only"], header.as_deref())?;
    if out.ok {
        Ok(out.stdout)
    } else {
        Err(out.stderr)
    }
}

#[tauri::command]
pub fn git_init(root: String) -> Result<String, String> {
    let out = run(&root, &["init", "-b", "main"])?;
    if out.ok {
        Ok("Repository created".into())
    } else {
        // Older git has no -b.
        let fallback = run(&root, &["init"])?;
        if fallback.ok {
            Ok("Repository created".into())
        } else {
            Err(fallback.stderr)
        }
    }
}

/// Adds or replaces `origin`, then returns the remote URL.
#[tauri::command]
pub fn git_set_remote(root: String, url: String) -> Result<String, String> {
    let target = url.trim();
    if target.is_empty() {
        return Err("Paste a repository URL first.".into());
    }
    if !(target.starts_with("https://")
        || target.starts_with("http://")
        || target.starts_with("git@")
        || target.starts_with("ssh://"))
    {
        return Err("Use an https:// or git@ repository URL.".into());
    }

    let existing = run(&root, &["remote", "get-url", "origin"])?;
    let out = if existing.ok {
        run(&root, &["remote", "set-url", "origin", target])?
    } else {
        run(&root, &["remote", "add", "origin", target])?
    };
    if out.ok {
        Ok(target.to_string())
    } else {
        Err(out.stderr)
    }
}

#[tauri::command]
pub fn git_branches(root: String) -> Result<Vec<String>, String> {
    let out = run(&root, &["branch", "--format=%(refname:short)"])?;
    if !out.ok {
        return Err(out.stderr);
    }
    Ok(out.stdout.lines().map(str::to_string).collect())
}

#[tauri::command]
pub fn git_checkout(root: String, branch: String, create: bool) -> Result<String, String> {
    let name = branch.trim();
    if name.is_empty() || name.starts_with('-') || name.contains(char::is_whitespace) {
        return Err("That branch name is not valid.".into());
    }
    let out = if create {
        run(&root, &["checkout", "-b", name])?
    } else {
        run(&root, &["checkout", name])?
    };
    if out.ok {
        Ok(out.stderr.lines().last().unwrap_or("Switched branch").to_string())
    } else {
        Err(out.stderr)
    }
}
