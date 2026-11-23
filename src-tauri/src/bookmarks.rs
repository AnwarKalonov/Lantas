//! Reads the local Chrome-family bookmark files so Lantas Browser can import the
//! bookmarks the user already has. Read-only; nothing is uploaded.

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
struct Bookmark {
    title: String,
    url: String,
    folder: String,
}

#[derive(Serialize)]
struct Profile {
    name: String,
    bookmarks: Vec<Bookmark>,
}

#[derive(Serialize)]
struct Browser {
    name: String,
    profiles: Vec<Profile>,
}

fn home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default()
}

fn bases() -> Vec<(&'static str, PathBuf)> {
    let support = home().join("Library/Application Support");
    let linux = home().join(".config");
    vec![
        ("Chrome", support.join("Google/Chrome")),
        ("Chrome Canary", support.join("Google/Chrome Canary")),
        ("Chromium", support.join("Chromium")),
        ("Brave", support.join("BraveSoftware/Brave-Browser")),
        ("Edge", support.join("Microsoft Edge")),
        ("Vivaldi", support.join("Vivaldi")),
        ("Arc", support.join("Arc/User Data")),
        ("Opera", support.join("com.operasoftware.Opera")),
        ("Chrome", linux.join("google-chrome")),
        ("Chromium", linux.join("chromium")),
        ("Brave", linux.join("BraveSoftware/Brave-Browser")),
    ]
}

fn walk(node: &serde_json::Value, folder: &str, out: &mut Vec<Bookmark>) {
    if out.len() >= 4000 {
        return;
    }
    if let Some(kind) = node.get("type").and_then(|value| value.as_str()) {
        if kind == "url" {
            let url = node.get("url").and_then(|value| value.as_str()).unwrap_or("");
            if url.starts_with("http://") || url.starts_with("https://") {
                out.push(Bookmark {
                    title: node
                        .get("name")
                        .and_then(|value| value.as_str())
                        .unwrap_or(url)
                        .to_string(),
                    url: url.to_string(),
                    folder: folder.to_string(),
                });
            }
            return;
        }
    }
    if let Some(children) = node.get("children").and_then(|value| value.as_array()) {
        let name = node
            .get("name")
            .and_then(|value| value.as_str())
            .unwrap_or(folder);
        for child in children {
            walk(child, name, out);
        }
    }
}

fn read_profile(path: &Path, name: &str) -> Option<Profile> {
    let raw = std::fs::read_to_string(path.join("Bookmarks")).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let mut bookmarks = Vec::new();
    if let Some(roots) = parsed.get("roots") {
        for key in ["bookmark_bar", "other", "synced"] {
            if let Some(root) = roots.get(key) {
                walk(root, "", &mut bookmarks);
            }
        }
    }
    if bookmarks.is_empty() {
        return None;
    }
    Some(Profile {
        name: name.to_string(),
        bookmarks,
    })
}

/// Every readable Chrome-family profile and its bookmarks.
#[tauri::command]
pub fn browser_bookmarks() -> Result<String, String> {
    let mut browsers: Vec<Browser> = Vec::new();
    for (browser_name, base) in bases() {
        if !base.is_dir() {
            continue;
        }
        let mut profiles: Vec<Profile> = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&base) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let label = entry.file_name().to_string_lossy().to_string();
                if !(label == "Default" || label.starts_with("Profile ")) {
                    continue;
                }
                if let Some(profile) = read_profile(&path, &label) {
                    profiles.push(profile);
                }
            }
        }
        if profiles.is_empty() {
            continue;
        }
        profiles.sort_by(|a, b| a.name.cmp(&b.name));
        browsers.push(Browser {
            name: browser_name.to_string(),
            profiles,
        });
    }
    serde_json::to_string(&browsers).map_err(|error| error.to_string())
}

/// Where a Chrome-family profile stores its cookie database, for a clear note in
/// the UI about what can and cannot be imported without the extension.
#[tauri::command]
pub fn browser_profile_paths() -> Vec<String> {
    bases()
        .into_iter()
        .filter(|(_, path)| path.is_dir())
        .map(|(name, path)| format!("{name}: {}", path.to_string_lossy()))
        .collect()
}
