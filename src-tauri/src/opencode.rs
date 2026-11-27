//! The OpenCode runtime.
//!
//! OpenWork runs a bundled `opencode serve` and speaks to it over localhost.
//! Lantas does the same: the sidecar is started for a workspace folder, keeps
//! its own session database, and owns tools, edits and commands. The webview
//! only sees a loopback URL and a per-launch password.

use std::collections::HashMap;
use std::io::Read;
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use sha1::{Digest, Sha1};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::{process::CommandChild, ShellExt};

#[derive(Default)]
pub struct OpenCodeState {
    servers: Mutex<HashMap<String, OpenCodeServer>>,
}

struct OpenCodeServer {
    child: CommandChild,
    port: u16,
    token: String,
}

#[derive(serde::Serialize)]
pub struct OpenCodeServerInfo {
    port: u16,
    token: String,
}

/// A loopback port the kernel says is free. The server binds it immediately,
/// so the race window is the few milliseconds before spawn.
fn free_port() -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("Could not reserve a local port: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Could not read the reserved port: {error}"))?
        .port();
    drop(listener);
    Ok(port)
}

/// A fresh password for this launch, so another local process cannot drive the
/// agent through the unauthenticated API. macOS provides /dev/urandom; the
/// fallback keeps development builds on other platforms usable.
fn make_token() -> String {
    let mut bytes = [0u8; 32];
    if let Ok(mut random) = std::fs::File::open("/dev/urandom") {
        if random.read_exact(&mut bytes).is_ok() {
            return bytes.iter().map(|byte| format!("{byte:02x}")).collect();
        }
    }
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let mut digest = Sha1::new();
    digest.update(format!("{}:{nanos}", std::process::id()));
    format!("{:x}", digest.finalize())
}

#[tauri::command]
pub fn opencode_start(
    app: AppHandle,
    state: State<'_, OpenCodeState>,
    root: String,
    env: HashMap<String, String>,
) -> Result<OpenCodeServerInfo, String> {
    let path: PathBuf = PathBuf::from(&root);
    let root = path
        .canonicalize()
        .map_err(|error| format!("Could not open the workspace folder: {error}"))?;
    if !root.is_dir() {
        return Err("The workspace folder is not a directory.".to_string());
    }
    let key = root.to_string_lossy().to_string();

    let mut servers = state
        .servers
        .lock()
        .map_err(|_| "The OpenCode process list is unavailable.".to_string())?;
    if let Some(server) = servers.get(&key) {
        return Ok(OpenCodeServerInfo {
            port: server.port,
            token: server.token.clone(),
        });
    }

    let port = free_port()?;
    let token = make_token();
    // Every mutating tool asks first. The app answers immediately in Auto mode
    // and shows its own approval sheet in Ask mode, so the decision stays with
    // the person in both cases.
    let config = serde_json::json!({
        "permission": {
            "bash": "ask",
            "edit": "ask",
            "webfetch": "ask"
        }
    });

    let args = vec![
        "serve".to_string(),
        "--port".to_string(),
        port.to_string(),
        "--hostname".to_string(),
        "127.0.0.1".to_string(),
        "--cors".to_string(),
        "http://localhost:1420".to_string(),
        "--cors".to_string(),
        "http://127.0.0.1:1420".to_string(),
        "--cors".to_string(),
        "tauri://localhost".to_string(),
        "--cors".to_string(),
        "http://tauri.localhost".to_string(),
        "--cors".to_string(),
        "https://tauri.localhost".to_string(),
    ];

    let mut command = app
        .shell()
        .sidecar("opencode")
        .map_err(|error| format!("The bundled OpenCode engine was not found: {error}"))?
        // The engine spawns shells and language tools; kill the whole group so
        // a crashed window does not leave them running.
        .set_process_group(true)
        .kill_on_drop(true)
        .args(args)
        .current_dir(&root)
        .env("OPENCODE_SERVER_USERNAME", "opencode")
        .env("OPENCODE_SERVER_PASSWORD", &token)
        .env("OPENCODE_CONFIG_CONTENT", config.to_string())
        .env("OPENCODE_DISABLE_AUTOUPDATE", "1")
        .env("NO_COLOR", "1");
    for (name, value) in env {
        if !value.trim().is_empty() {
            command = command.env(name, value);
        }
    }

    let (mut events, child) = command
        .spawn()
        .map_err(|error| format!("Could not start OpenCode: {error}"))?;

    // The plugin gives us a bounded channel. Drain it, or a chatty server can
    // block on stdout, and keep the last lines in the app log for diagnosis.
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                tauri_plugin_shell::process::CommandEvent::Stdout(bytes)
                | tauri_plugin_shell::process::CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    let line = line.trim_end();
                    if !line.is_empty() {
                        eprintln!("opencode: {line}");
                    }
                }
                tauri_plugin_shell::process::CommandEvent::Terminated(payload) => {
                    eprintln!("opencode stopped: {:?}", payload.code);
                }
                _ => {}
            }
        }
    });

    servers.insert(
        key,
        OpenCodeServer {
            child,
            port,
            token: token.clone(),
        },
    );

    Ok(OpenCodeServerInfo { port, token })
}

#[tauri::command]
pub fn opencode_stop(state: State<'_, OpenCodeState>, root: String) -> bool {
    let key = PathBuf::from(&root)
        .canonicalize()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or(root);
    let mut servers = match state.servers.lock() {
        Ok(servers) => servers,
        Err(_) => return false,
    };
    if let Some(server) = servers.remove(&key) {
        let _ = server.child.kill();
        return true;
    }
    false
}

impl OpenCodeState {
    pub fn stop_all(&self) {
        if let Ok(mut servers) = self.servers.lock() {
            for (_, server) in servers.drain() {
                let _ = server.child.kill();
            }
        }
    }
}

/// Kills every sidecar on the way out. The state is managed by the app, so it
/// still exists when Tauri reports Exit.
pub fn stop_all(app: &AppHandle) {
    if let Some(state) = app.try_state::<OpenCodeState>() {
        state.stop_all();
    }
}
