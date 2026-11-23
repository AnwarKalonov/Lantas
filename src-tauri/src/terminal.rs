use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{ChildStdin, Command, Stdio};
use std::sync::Mutex;

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct TerminalState {
    sessions: Mutex<HashMap<String, Session>>,
}

struct Session {
    stdin: ChildStdin,
    pid: u32,
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn find_cli(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources.join("cli").join("lantas.mjs"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("cli").join("lantas.mjs"));
            candidates.push(
                dir.join("..")
                    .join("Resources")
                    .join("cli")
                    .join("lantas.mjs"),
            );
        }
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("cli")
            .join("lantas.mjs"),
    );
    candidates.into_iter().find(|path| path.is_file())
}

fn spawn(
    app: AppHandle,
    state: &State<'_, TerminalState>,
    id: String,
    cwd: String,
    command: String,
) -> Result<(), String> {
    let directory = if cwd.trim().is_empty() {
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::current_dir().ok())
            .ok_or("Could not find a folder to run in.".to_string())?
    } else {
        PathBuf::from(cwd)
    };
    let mut child = Command::new("/bin/zsh")
        .args(["-lc", &command])
        .current_dir(directory)
        .env("TERM", "xterm-256color")
        .env("LANTAS_IN_APP_TERMINAL", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;

    let stdout = child.stdout.take().ok_or("Could not read terminal output.")?;
    let stderr = child.stderr.take().ok_or("Could not read terminal errors.")?;
    let stdin = child.stdin.take().ok_or("Could not open terminal input.")?;
    let pid = child.id();

    state
        .sessions
        .lock()
        .map_err(|_| "Terminal state is unavailable.".to_string())?
        .insert(id.clone(), Session { stdin, pid });

    let out_app = app.clone();
    let out_id = id.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => {
                    let _ = out_app.emit(
                        "terminal-output",
                        json!({ "id": out_id, "stream": "stdout", "line": line }),
                    );
                }
                Err(_) => break,
            }
        }
    });

    let err_app = app.clone();
    let err_id = id.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines() {
            match line {
                Ok(line) => {
                    let _ = err_app.emit(
                        "terminal-output",
                        json!({ "id": err_id, "stream": "stderr", "line": line }),
                    );
                }
                Err(_) => break,
            }
        }
    });

    std::thread::spawn(move || {
        let code = child.wait().ok().and_then(|status| status.code());
        let _ = app.emit("terminal-exit", json!({ "id": id, "code": code }));
    });

    Ok(())
}

#[tauri::command]
pub fn terminal_start(
    app: AppHandle,
    state: State<'_, TerminalState>,
    id: String,
    cwd: String,
    command: String,
) -> Result<(), String> {
    spawn(app, &state, id, cwd, command)
}

/// Starts one long-lived login shell. The terminal panel writes whole command
/// lines to it, so `cd`, environment changes and history survive between
/// commands instead of every line starting a new process.
#[tauri::command]
pub fn terminal_shell(
    app: AppHandle,
    state: State<'_, TerminalState>,
    id: String,
    cwd: String,
) -> Result<(), String> {
    let directory = if cwd.trim().is_empty() {
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::current_dir().ok())
            .ok_or("Could not find a folder to run in.".to_string())?
    } else {
        PathBuf::from(cwd)
    };

    let mut child = Command::new("/bin/zsh")
        .args(["-il"])
        .current_dir(directory)
        .env("TERM", "xterm-256color")
        .env("LANTAS_IN_APP_TERMINAL", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;

    let stdout = child.stdout.take().ok_or("Could not read terminal output.")?;
    let stderr = child.stderr.take().ok_or("Could not read terminal errors.")?;
    let stdin = child.stdin.take().ok_or("Could not open terminal input.")?;
    let pid = child.id();

    state
        .sessions
        .lock()
        .map_err(|_| "Terminal state is unavailable.".to_string())?
        .insert(id.clone(), Session { stdin, pid });

    let out_app = app.clone();
    let out_id = id.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => {
                    let _ = out_app.emit(
                        "terminal-output",
                        json!({ "id": out_id, "stream": "stdout", "line": line }),
                    );
                }
                Err(_) => break,
            }
        }
    });

    let err_app = app.clone();
    let err_id = id.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines() {
            match line {
                Ok(line) => {
                    let _ = err_app.emit(
                        "terminal-output",
                        json!({ "id": err_id, "stream": "stderr", "line": line }),
                    );
                }
                Err(_) => break,
            }
        }
    });

    std::thread::spawn(move || {
        let code = child.wait().ok().and_then(|status| status.code());
        let _ = app.emit("terminal-exit", json!({ "id": id, "code": code }));
    });

    Ok(())
}

/// Starts the CLI that ships with the app. It prefers an installed `lantas`
/// command and falls back to the bundled Node entry point.
#[tauri::command]
pub fn terminal_cli(
    app: AppHandle,
    state: State<'_, TerminalState>,
    id: String,
    cwd: String,
) -> Result<(), String> {
    let cli = find_cli(&app)
        .ok_or("The bundled Lantas CLI was not found. Reinstall the app.".to_string())?;
    let command = format!(
        "export PATH=\"/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$HOME/.local/bin:$PATH\"; \
         if command -v lantas >/dev/null 2>&1; then exec lantas; \
         elif command -v node >/dev/null 2>&1; then exec node {}; \
         else printf '%s\\n' 'The Lantas CLI needs Node.js 18 or newer.' 'Install it from https://nodejs.org, then press Start again.'; exit 127; fi",
        shell_quote(&cli.to_string_lossy())
    );
    spawn(app, &state, id, cwd, command)
}

#[tauri::command]
pub fn terminal_write(
    state: State<'_, TerminalState>,
    id: String,
    data: String,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Terminal state is unavailable.".to_string())?;
    let session = sessions
        .get_mut(&id)
        .ok_or("That terminal is no longer running.".to_string())?;
    session
        .stdin
        .write_all(data.as_bytes())
        .map_err(|error| error.to_string())?;
    session.stdin.flush().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn terminal_stop(state: State<'_, TerminalState>, id: String) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Terminal state is unavailable.".to_string())?;
    if let Some(session) = sessions.remove(&id) {
        #[cfg(unix)]
        {
            let _ = Command::new("kill")
                .args(["-TERM", &session.pid.to_string()])
                .status();
        }
        #[cfg(not(unix))]
        {
            let _ = session.pid;
        }
    }
    Ok(())
}
