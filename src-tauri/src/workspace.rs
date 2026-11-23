use std::path::{Component, Path, PathBuf};

fn target(root: &str, relative: &str) -> Result<PathBuf, String> {
    if root.trim().is_empty() {
        return Err("Open a folder first.".into());
    }
    if relative.trim().is_empty() {
        return Err("A path is required.".into());
    }
    let rel = Path::new(relative);
    if rel.is_absolute()
        || rel.components().any(|part| {
            matches!(
                part,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("That path leaves the open folder.".into());
    }
    Ok(PathBuf::from(root).join(rel))
}

#[tauri::command]
pub fn workspace_create_dir(root: String, path: String) -> Result<(), String> {
    let target = target(&root, &path)?;
    std::fs::create_dir_all(&target).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn workspace_create_file(root: String, path: String, text: String) -> Result<(), String> {
    let target = target(&root, &path)?;
    if target.exists() {
        return Err("A file or folder already exists at that path.".into());
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(&target, text).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn workspace_rename(root: String, from: String, to: String) -> Result<(), String> {
    let source = target(&root, &from)?;
    let destination = target(&root, &to)?;
    if destination.exists() {
        return Err("Something already exists at that path.".into());
    }
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::rename(&source, &destination).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn workspace_delete(root: String, path: String) -> Result<(), String> {
    let target = target(&root, &path)?;
    if target == PathBuf::from(&root) {
        return Err("Refusing to delete the open folder.".into());
    }
    if target.is_dir() {
        std::fs::remove_dir_all(&target).map_err(|error| error.to_string())
    } else {
        std::fs::remove_file(&target).map_err(|error| error.to_string())
    }
}
