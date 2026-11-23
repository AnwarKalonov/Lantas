//! Imports a VS Code setup: user settings, keybindings and installed extensions.
//!
//! Lantas runs Monaco, not the VS Code extension host, so extension *code* cannot
//! execute. Themes, fonts, editor behaviour, snippets and the extension inventory
//! can be carried across; the UI says plainly which extensions need VS Code.

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
struct Extension {
    id: String,
    name: String,
    version: String,
    publisher: String,
    description: String,
    path: String,
    has_theme: bool,
    has_snippets: bool,
    has_language: bool,
}

#[derive(Serialize)]
struct Imported {
    found: bool,
    settings_path: String,
    keybindings_path: String,
    settings: String,
    keybindings: String,
    extensions: Vec<Extension>,
}

fn home() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_default()
}

fn user_dir() -> Option<PathBuf> {
    let home = home();
    let mac = home.join("Library/Application Support/Code/User");
    let linux = home.join(".config/Code/User");
    let windows = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .map(|base| base.join("Code/User"));
    [mac, linux]
        .into_iter()
        .chain(windows)
        .find(|path| path.is_dir())
}

fn extension_dirs() -> Vec<PathBuf> {
    let home = home();
    [
        home.join(".vscode/extensions"),
        home.join(".vscode-insiders/extensions"),
        home.join(".cursor/extensions"),
        home.join(".windsurf/extensions"),
    ]
    .into_iter()
    .filter(|path| path.is_dir())
    .collect()
}

fn read(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap_or_default()
}

/// Reads `settings.json`, `keybindings.json` and every installed `package.json`.
#[tauri::command]
pub fn vscode_import() -> Result<String, String> {
    let dir = user_dir();
    let settings_path = dir.as_ref().map(|base| base.join("settings.json"));
    let keybindings_path = dir.as_ref().map(|base| base.join("keybindings.json"));
    let settings = settings_path.as_deref().map(read).unwrap_or_default();
    let keybindings = keybindings_path.as_deref().map(read).unwrap_or_default();

    let mut extensions: Vec<Extension> = Vec::new();
    for root in extension_dirs() {
        let Ok(entries) = std::fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            if extensions.len() >= 400 {
                break;
            }
            let path = entry.path();
            if !path.is_dir() || entry.file_name().to_string_lossy().starts_with('.') {
                continue;
            }
            let manifest = path.join("package.json");
            let Ok(raw) = std::fs::read_to_string(&manifest) else {
                continue;
            };
            let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) else {
                continue;
            };
            let contributes = parsed.get("contributes");
            let has_theme = contributes
                .and_then(|value| value.get("themes"))
                .and_then(|value| value.as_array())
                .map(|items| !items.is_empty())
                .unwrap_or(false);
            let has_snippets = contributes
                .and_then(|value| value.get("snippets"))
                .and_then(|value| value.as_array())
                .map(|items| !items.is_empty())
                .unwrap_or(false);
            let has_language = contributes
                .and_then(|value| value.get("languages"))
                .and_then(|value| value.as_array())
                .map(|items| !items.is_empty())
                .unwrap_or(false);
            let publisher = parsed
                .get("publisher")
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .to_string();
            let name = parsed
                .get("name")
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .to_string();
            if name.is_empty() {
                continue;
            }
            extensions.push(Extension {
                id: if publisher.is_empty() {
                    name.clone()
                } else {
                    format!("{publisher}.{name}")
                },
                name: parsed
                    .get("displayName")
                    .and_then(|value| value.as_str())
                    .unwrap_or(&name)
                    .to_string(),
                version: parsed
                    .get("version")
                    .and_then(|value| value.as_str())
                    .unwrap_or("")
                    .to_string(),
                publisher,
                description: parsed
                    .get("description")
                    .and_then(|value| value.as_str())
                    .unwrap_or("")
                    .to_string(),
                path: path.to_string_lossy().to_string(),
                has_theme,
                has_snippets,
                has_language,
            });
        }
    }
    extensions.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    let result = Imported {
        found: dir.is_some(),
        settings_path: settings_path
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default(),
        keybindings_path: keybindings_path
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default(),
        settings,
        keybindings,
        extensions,
    };
    serde_json::to_string(&result).map_err(|error| error.to_string())
}
