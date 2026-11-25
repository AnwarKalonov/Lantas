use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize, SlavePty};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct TerminalState {
    sessions: Mutex<HashMap<String, Session>>,
}

struct Session {
    writer: Box<dyn Write + Send>,
    pid: u32,
}

/// The panel has its own input line, so the pty should not echo what it writes
/// and zsh should not draw a prompt: both would print every command twice.
/// Sending the setup through the pty works now that there is a real terminal
/// underneath; the one echoed copy is filtered by the panel.
const SHELL_SETUP: &str =
    "stty -echo 2>/dev/null; unsetopt zle 2>/dev/null; PROMPT=''; RPROMPT=''; PS1=''; PROMPT2=''\n";

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn resolve_dir(cwd: &str) -> Result<PathBuf, String> {
    if cwd.trim().is_empty() {
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::current_dir().ok())
            .ok_or("Could not find a folder to run in.".to_string())
    } else {
        Ok(PathBuf::from(cwd))
    }
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

/// Reads a stream line by line and emits it to the panel.
///
/// A pty writes `\r\n`, so the carriage return is stripped; without that every
/// line would render with a stray control character.
fn emit_lines<R: Read + Send + 'static>(app: AppHandle, id: String, stream: &'static str, source: R) {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(source);
        let mut buffer: Vec<u8> = Vec::new();
        loop {
            buffer.clear();
            match reader.read_until(b'\n', &mut buffer) {
                Ok(0) => break,
                Ok(_) => {
                    while matches!(buffer.last(), Some(b'\n') | Some(b'\r')) {
                        buffer.pop();
                    }
                    let line = String::from_utf8_lossy(&buffer).to_string();
                    let _ = app.emit(
                        "terminal-output",
                        json!({ "id": id, "stream": stream, "line": line }),
                    );
                }
                Err(_) => break,
            }
        }
    });
}

/// Runs a program on a real pty.
///
/// The shell used to be started through `/usr/bin/script`, which is how a pipe
/// was turned into something that looks like a terminal. On macOS `script`
/// inspects *its own* stdin with `tcgetattr` before it allocates anything, and
/// the app gives it a pipe, so it exited immediately: the panel said "Shell
/// ready" and then nothing could be typed or read. `portable-pty` opens the
/// terminal itself, so the shell is genuinely interactive (`isatty` is true for
/// `sudo`, REPLs and installers) and the pty stays alive as long as the child.
fn spawn_pty(
    app: AppHandle,
    state: &State<'_, TerminalState>,
    id: String,
    directory: PathBuf,
    program: &str,
    args: &[&str],
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 40,
            cols: 130,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())?;

    let mut builder = CommandBuilder::new(program);
    for arg in args {
        builder.arg(*arg);
    }
    builder.cwd(directory);
    builder.env("TERM", "xterm-256color");
    builder.env("LANTAS_IN_APP_TERMINAL", "1");
    builder.env("COLUMNS", "130");
    builder.env("LINES", "40");

    let mut child = pair
        .slave
        .spawn_command(builder)
        .map_err(|error| error.to_string())?;
    // The parent must not hold the slave open, or the pty never reports EOF.
    drop(pair.slave);

    let master = pair.master;
    let reader = master.try_clone_reader().map_err(|error| error.to_string())?;
    let writer = master.take_writer().map_err(|error| error.to_string())?;
    let pid = child.process_id().unwrap_or(0);

    state
        .sessions
        .lock()
        .map_err(|_| "Terminal state is unavailable.".to_string())?
        .insert(id.clone(), Session { writer, pid });

    emit_lines(app.clone(), id.clone(), "stdout", reader);

    // The master handle owns the pty. Dropping it closes the terminal under a
    // running shell, so it lives in this thread until the child is gone.
    std::thread::spawn(move || {
        let _master = master;
        let code = child.wait().ok().map(|status| status.exit_code() as i32);
        let _ = app.emit("terminal-exit", json!({ "id": id, "code": code }));
    });

    Ok(())
}

fn write_session(state: &State<'_, TerminalState>, id: &str, data: &str) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Terminal state is unavailable.".to_string())?;
    let session = sessions
        .get_mut(id)
        .ok_or("That terminal is no longer running.".to_string())?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|error| error.to_string())?;
    session.writer.flush().map_err(|error| error.to_string())
}

/// One command, not an interactive session: the assistant's terminal tool.
#[tauri::command]
pub fn terminal_start(
    app: AppHandle,
    state: State<'_, TerminalState>,
    id: String,
    cwd: String,
    command: String,
) -> Result<(), String> {
    let directory = resolve_dir(&cwd)?;
    let mut child = Command::new("/bin/zsh")
        .args(["-lc", &command])
        .current_dir(directory)
        .env("TERM", "xterm-256color")
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
        .insert(
            id.clone(),
            Session {
                writer: Box::new(stdin),
                pid,
            },
        );

    emit_lines(app.clone(), id.clone(), "stdout", stdout);
    emit_lines(app.clone(), id.clone(), "stderr", stderr);

    std::thread::spawn(move || {
        let code = child.wait().ok().and_then(|status| status.code());
        let _ = app.emit("terminal-exit", json!({ "id": id, "code": code }));
    });

    Ok(())
}

/// One long-lived interactive login shell for the Terminal tab.
///
/// It needs no model, no key and no Lantas account: it is the user's own zsh in
/// their own folder, with a real terminal under it.
#[tauri::command]
pub fn terminal_shell(
    app: AppHandle,
    state: State<'_, TerminalState>,
    id: String,
    cwd: String,
) -> Result<(), String> {
    let directory = resolve_dir(&cwd)?;
    spawn_pty(app, &state, id.clone(), directory, "/bin/zsh", &["-il"])?;
    // Echo and the prompt are turned off after the shell is up, because a pty
    // that is silent from the first byte also swallows the user's own command
    // echo before zsh has read its rc files.
    let _ = write_session(&state, &id, SHELL_SETUP);
    Ok(())
}

/// Starts the CLI that ships with the app, in the same pty.
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
        "stty -echo 2>/dev/null; \
         export PATH=\"/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$HOME/.local/bin:$PATH\"; \
         if command -v lantas >/dev/null 2>&1; then exec lantas; \
         elif command -v node >/dev/null 2>&1; then exec node {}; \
         else printf '%s\\n' 'The Lantas CLI needs Node.js 18 or newer.' 'Install it from https://nodejs.org, then press Start again.'; exit 127; fi",
        shell_quote(&cli.to_string_lossy())
    );
    let directory = resolve_dir(&cwd)?;
    let args = ["-lc", command.as_str()];
    spawn_pty(app, &state, id, directory, "/bin/zsh", &args)
}

/// Opens the user's own Terminal.app in a folder. The in-app terminal is a pty
/// now, but some work still belongs in the real thing: long sessions, tmux, or
/// anything the user wants to keep after Lantas closes.
#[tauri::command]
pub fn open_external_terminal(cwd: String) -> Result<(), String> {
    let directory = resolve_dir(&cwd)?;

    #[cfg(target_os = "macos")]
    let opened = Command::new("/usr/bin/open")
        .args(["-a", "Terminal"])
        .arg(&directory)
        .status()
        .map_err(|error| format!("Could not open Terminal: {error}"))
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err("Terminal did not open. Open it from the Dock and cd to this folder.".to_string())
            }
        });

    #[cfg(not(target_os = "macos"))]
    let opened = {
        let _ = &directory;
        Err("Opening an external terminal is supported on macOS in this build.".to_string())
    };

    opened
}

/// Opens Terminal.app on the CLI, in the folder the app has open.
///
/// The in-app CLI tab is a pty inside Lantas; this is the escape hatch the user
/// asked for: their own Terminal window, their own shell settings, the same
/// `lantas` session. A temporary .command file gives Terminal a real tty and a
/// working directory without typing anything into the user's shell.
#[tauri::command]
pub fn open_cli_terminal(app: AppHandle, cwd: String) -> Result<(), String> {
    let directory = resolve_dir(&cwd)?;
    let cli = find_cli(&app)
        .ok_or("The bundled Lantas CLI was not found. Reinstall the app.".to_string())?;

    #[cfg(target_os = "macos")]
    {
        use std::os::unix::fs::PermissionsExt;

        let script = std::env::temp_dir().join(format!(
            "lantas-cli-{}-{}.command",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|elapsed| elapsed.as_millis())
                .unwrap_or(0)
        ));
        let body = format!(
            "#!/bin/bash\ncd {} || exit 1\n\
             export PATH=\"/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$HOME/.local/bin:$PATH\"\n\
             export LANTAS_NO_WINDOW=1\n\
             if command -v lantas >/dev/null 2>&1; then exec lantas --here; fi\n\
             if command -v node >/dev/null 2>&1; then exec node {} --here; fi\n\
             printf '%s\\n' 'The Lantas CLI needs Node.js 18 or newer.' 'Install it from https://nodejs.org, then run lantas again.'\n\
             sleep 8\n",
            shell_quote(&directory.to_string_lossy()),
            shell_quote(&cli.to_string_lossy())
        );
        std::fs::write(&script, body).map_err(|error| error.to_string())?;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755))
            .map_err(|error| error.to_string())?;

        let status = Command::new("/usr/bin/open")
            .arg("-a")
            .arg("Terminal")
            .arg(&script)
            .status()
            .map_err(|error| format!("Could not open Terminal: {error}"))?;
        if status.success() {
            Ok(())
        } else {
            Err("Terminal did not open. Open it from the Dock and run lantas.".to_string())
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (&directory, &cli);
        Err("Opening the CLI in Terminal is supported on macOS in this build.".to_string())
    }
}

/// The launcher written to ~/.local/bin/lantas. `__LIB__` is replaced with the
/// folder the bundled CLI lives in.
const LAUNCHER: &str = r####"#!/bin/bash
# lantas — the coding agent, in its own terminal window.
set -euo pipefail

LIB=__LIB__
HERE=0
ARGS=()
for arg in "$@"; do
  if [ "$arg" = "--here" ]; then
    HERE=1
  else
    ARGS+=("$arg")
  fi
done

run_here() {
  exec node "$LIB/lantas.mjs" ${ARGS[@]+"${ARGS[@]}"}
}

if [ "$HERE" = "1" ] || [ "${LANTAS_NO_WINDOW:-}" = "1" ]; then
  run_here
fi

if [ "$(uname)" != "Darwin" ] || ! command -v osascript >/dev/null 2>&1 || [ ! -t 0 ]; then
  run_here
fi

SCRIPT="$(mktemp "${TMPDIR:-/tmp}/lantas-XXXXXX.command")"
{
  printf '#!/bin/bash\n'
  printf 'cd %q || exit 1\n' "$PWD"
  printf 'export LANTAS_NO_WINDOW=1\n'
  printf 'exec node %q' "$LIB/lantas.mjs"
  for arg in ${ARGS[@]+"${ARGS[@]}"}; do
    printf ' %q' "$arg"
  done
  printf '\n'
} > "$SCRIPT"
chmod +x "$SCRIPT"

exec open -a Terminal "$SCRIPT"
"####;

/// Installs a `lantas` command on the user's PATH.
///
/// The DMG carries the CLI inside the app bundle, which is not a path anyone
/// wants to type. This writes a small launcher to ~/.local/bin that opens the
/// bundled CLI in a Terminal window of its own, and adds that folder to the
/// login shell's PATH once.
#[tauri::command]
pub fn install_cli_command(app: AppHandle) -> Result<String, String> {
    let cli = find_cli(&app)
        .ok_or("The bundled Lantas CLI was not found. Reinstall the app.".to_string())?;
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or("Could not find your home folder.".to_string())?;
    let bin = home.join(".local").join("bin");
    std::fs::create_dir_all(&bin).map_err(|error| error.to_string())?;

    let target = bin.join("lantas");
    let lib = cli
        .parent()
        .ok_or("The bundled CLI has no folder.".to_string())?;
    let launcher = LAUNCHER.replace("__LIB__", &shell_quote(&lib.to_string_lossy()));
    std::fs::write(&target, launcher).map_err(|error| error.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755))
            .map_err(|error| error.to_string())?;
    }

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let rc = if shell.ends_with("bash") {
        home.join(".bashrc")
    } else {
        home.join(".zshrc")
    };
    let existing = std::fs::read_to_string(&rc).unwrap_or_default();
    let folder = bin.to_string_lossy().to_string();
    let note = if existing.contains(&folder) {
        format!("{} is already on your PATH.", folder)
    } else {
        let line = format!("\n# Lantas CLI\nexport PATH=\"{folder}:$PATH\"\n");
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&rc)
            .map_err(|error| error.to_string())?;
        file.write_all(line.as_bytes())
            .map_err(|error| error.to_string())?;
        format!(
            "Added {folder} to PATH in {}. Open a new terminal and run lantas.",
            rc.display()
        )
    };

    Ok(format!("Installed {}. {note}", target.display()))
}

#[tauri::command]
pub fn terminal_write(
    state: State<'_, TerminalState>,
    id: String,
    data: String,
) -> Result<(), String> {
    write_session(&state, &id, &data)
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
