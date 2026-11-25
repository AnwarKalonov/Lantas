mod bookmarks;
mod bridge;
mod git;
mod terminal;
mod vscode;
mod workspace;

use std::path::PathBuf;

use tauri::{LogicalPosition, LogicalSize, Manager, WebviewUrl};

/// A normal macOS Safari agent string. WKWebView's default agent names the app,
/// which Google treats as an unusual client and answers with a captcha wall.
const BROWSER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15";

/// If Google still answers with its captcha wall, continue the same search on
/// DuckDuckGo instead of showing a dead end.
const SEARCH_RECOVERY: &str = r#"
(() => {
  const rescue = () => {
    try {
      const host = location.hostname;
      if (!/(^|\.)google\.[a-z.]+$/.test(host)) return;
      const blocked =
        location.pathname.indexOf('/sorry/') === 0 ||
        !!document.querySelector('#captcha-form, form[action*="sorry"], iframe[src*="recaptcha"]');
      if (!blocked) return;
      const q = new URLSearchParams(location.search).get('q') || '';
      location.replace(q ? 'https://duckduckgo.com/?q=' + encodeURIComponent(q) : 'https://duckduckgo.com');
    } catch (error) {}
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', rescue, { once: true });
  } else {
    rescue();
  }
  window.setTimeout(rescue, 1200);
})();
"#;

fn parse_url(input: &str) -> Result<tauri::Url, String> {
    input
        .parse::<tauri::Url>()
        .map_err(|error| error.to_string())
}

/// Opens (or reuses) the Lantas Browser webview. A child webview is a real
/// browser engine, so Google and other frame-blocking sites work and the model
/// can click through the page.
#[tauri::command]
fn el_open(
    window: tauri::Window,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let parsed = parse_url(&url)?;
    if let Some(view) = window.get_webview("el") {
        view.navigate(parsed).map_err(|error| error.to_string())?;
        view.set_position(LogicalPosition::new(x, y))
            .map_err(|error| error.to_string())?;
        view.set_size(LogicalSize::new(width, height))
            .map_err(|error| error.to_string())?;
        view.show().map_err(|error| format!("show: {error}"))?;
        return Ok(());
    }

    let builder = tauri::webview::WebviewBuilder::new("el", WebviewUrl::External(parsed))
        .user_agent(BROWSER_AGENT)
        .initialization_script(SEARCH_RECOVERY);
    let view = window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width.max(1.0), height.max(1.0)),
        )
        .map_err(|error| format!("create: {error}"))?;
    view.show().map_err(|error| format!("show: {error}"))?;
    Ok(())
}

#[tauri::command]
fn el_bounds(
    window: tauri::Window,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if let Some(view) = window.get_webview("el") {
        view.set_position(LogicalPosition::new(x, y))
            .map_err(|error| error.to_string())?;
        view.set_size(LogicalSize::new(width.max(1.0), height.max(1.0)))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn el_navigate(window: tauri::Window, url: String) -> Result<(), String> {
    let parsed = parse_url(&url)?;
    if let Some(view) = window.get_webview("el") {
        view.navigate(parsed).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn el_visible(window: tauri::Window, visible: bool) -> Result<(), String> {
    if let Some(view) = window.get_webview("el") {
        if visible {
            view.show().map_err(|error| error.to_string())?;
        } else {
            view.hide().map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn el_close(window: tauri::Window) -> Result<(), String> {
    if let Some(view) = window.get_webview("el") {
        view.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn el_eval(window: tauri::Window, script: String) -> Result<(), String> {
    if let Some(view) = window.get_webview("el") {
        view.eval(&script).map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Runs JavaScript in the child browser and returns its JSON result. This is
/// what makes browser actions verifiable: a click or type is only reported as
/// successful after the page itself answers with its new URL and controls.
#[tauri::command]
async fn el_run(window: tauri::Window, script: String) -> Result<String, String> {
    let view = window.get_webview("el").ok_or_else(|| {
        "Lantas Browser is not open. Open a website in the Browser tab first.".to_string()
    })?;

    let (sender, receiver) = std::sync::mpsc::channel::<String>();
    view.eval_with_callback(script, move |value| {
        let _ = sender.send(value);
    })
    .map_err(|error| error.to_string())?;

    match tauri::async_runtime::spawn_blocking(move || {
        receiver.recv_timeout(std::time::Duration::from_secs(8))
    })
    .await
    {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(_)) => Err(
            "The page did not answer in time. It may still be loading; try again.".to_string(),
        ),
        Err(error) => Err(format!("Could not read the browser result: {error}")),
    }
}

/// Click by CSS selector, or by the visible text of a link/button.
#[tauri::command]
fn el_click(window: tauri::Window, target: String) -> Result<(), String> {
    let wanted = serde_json::to_string(&target).map_err(|error| error.to_string())?;
    let script = format!(
        r#"(() => {{
  const want = {wanted};
  let el = null;
  try {{ el = document.querySelector(want); }} catch (_) {{}}
  if (!el) {{
    const nodes = Array.from(document.querySelectorAll('a,button,[role="button"],input[type="submit"],summary'));
    el = nodes.find((node) => ((node.innerText || node.value || '').toLowerCase().includes(want.toLowerCase())));
  }}
  if (el) {{
    el.scrollIntoView({{ block: 'center', inline: 'center' }});
    el.click();
  }}
}})();"#
    );
    if let Some(view) = window.get_webview("el") {
        view.eval(script).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn el_type(window: tauri::Window, selector: String, text: String) -> Result<(), String> {
    let target = serde_json::to_string(&selector).map_err(|error| error.to_string())?;
    let value = serde_json::to_string(&text).map_err(|error| error.to_string())?;
    let script = format!(
        r#"(() => {{
  const el = document.querySelector({target});
  if (!el) return;
  el.focus();
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, {value}); else el.value = {value};
  el.dispatchEvent(new Event('input', {{ bubbles: true }}));
  el.dispatchEvent(new Event('change', {{ bubbles: true }}));
}})();"#
    );
    if let Some(view) = window.get_webview("el") {
        view.eval(script).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn el_history(window: tauri::Window, direction: String) -> Result<(), String> {
    if let Some(view) = window.get_webview("el") {
        let script = if direction == "forward" {
            "history.forward()"
        } else {
            "history.back()"
        };
        view.eval(script).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn el_reload(window: tauri::Window) -> Result<(), String> {
    if let Some(view) = window.get_webview("el") {
        view.eval("location.reload()").map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Last-resort fallback: a real browser window when the embedded child
/// webview cannot be created on this machine.
#[tauri::command]
fn el_window(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let parsed = parse_url(&url)?;
    if let Some(window) = app.get_webview_window("lantas-browser") {
        window.navigate(parsed).map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(&app, "lantas-browser", WebviewUrl::External(parsed))
        .title("Lantas Browser")
        .inner_size(1180.0, 820.0)
        .build()
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// Opens a URL in the system default browser. Tauri webviews do not hand a
/// `target="_blank"` link to the OS, so OAuth and token pages need this.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    open_in_browser(&url, false)
}

/// Opens a URL in Google Chrome itself, so an OAuth flow lands in the browser
/// where the user is already signed in.
#[tauri::command]
fn open_in_chrome(url: String) -> Result<(), String> {
    open_in_browser(&url, true)
}

/// Opens the macOS Privacy & Security pane for one permission.
///
/// An app cannot grant itself Screen Recording, Accessibility or Files access:
/// the switch stays with the user. This puts the switch in front of them
/// instead of telling them to go hunting through System Settings.
#[tauri::command]
fn open_privacy_settings(pane: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let anchor = match pane.as_str() {
            "screen" => "Privacy_ScreenCapture",
            "accessibility" => "Privacy_Accessibility",
            "files" => "Privacy_FilesAndFolders",
            "automation" => "Privacy_Automation",
            "microphone" => "Privacy_Microphone",
            "camera" => "Privacy_Camera",
            other => return Err(format!("Unknown privacy pane: {other}")),
        };
        let url = format!("x-apple.systempreferences:com.apple.preference.security?{anchor}");
        let status = std::process::Command::new("/usr/bin/open")
            .arg(&url)
            .status()
            .map_err(|error| format!("Could not open System Settings: {error}"))?;
        if status.success() {
            return Ok(());
        }
        return Err("System Settings did not open. Choose Apple menu › System Settings › Privacy & Security."
            .to_string());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = pane;
        Err("System Settings is macOS-only.".to_string())
    }
}

/// Hands the open folder to VS Code. Lantas keeps its own workbench, but the
/// same files can always be opened in the editor the user already knows.
#[tauri::command]
fn open_in_vscode(path: String) -> Result<(), String> {
    let target = if path.trim().is_empty() {
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or("Open a folder in Lantas first.".to_string())?
    } else {
        PathBuf::from(path)
    };

    #[cfg(target_os = "macos")]
    {
        let target = target.to_string_lossy().to_string();
        let status = std::process::Command::new("open")
            .args(["-a", "Visual Studio Code", &target])
            .status()
            .map_err(|error| format!("Could not open VS Code: {error}"))?;
        if status.success() {
            return Ok(());
        }
        return Err("Visual Studio Code was not found. Install it, or use Open Folder.".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "code", &target.to_string_lossy()])
            .status()
            .map_err(|error| format!("Could not open VS Code: {error}"))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("code")
            .arg(&target)
            .status()
            .map_err(|error| format!("Could not open VS Code: {error}"))?;
        Ok(())
    }
}

/// One still frame of the whole screen as base64 JPEG.
///
/// WKWebView has no `getDisplayMedia`, which is why the browser build's screen
/// sharing threw instead of opening a picker. The desktop app asks macOS for
/// the shot with its own tool instead; the frontend turns the bytes into a
/// data URL and attaches them exactly like a browser frame.
#[tauri::command]
fn screen_capture() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        use base64::{engine::general_purpose::STANDARD, Engine as _};

        let path = std::env::temp_dir().join(format!("lantas-screen-{}.jpg", std::process::id()));
        let status = std::process::Command::new("/usr/sbin/screencapture")
            .args(["-x", "-t", "jpg"])
            .arg(&path)
            .status()
            .map_err(|error| format!("Could not start screen capture: {error}"))?;
        if !status.success() {
            return Err("Screen capture was refused. Allow Lantas in System Settings › Privacy & Security › Screen Recording, then try again.".to_string());
        }
        let bytes = std::fs::read(&path)
            .map_err(|error| format!("Could not read the screen capture: {error}"))?;
        let _ = std::fs::remove_file(&path);
        if bytes.is_empty() {
            return Err(
                "The screen capture was empty. Check Screen Recording permission.".to_string(),
            );
        }
        Ok(STANDARD.encode(bytes))
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Screen capture is available in the macOS build.".to_string())
    }
}

/// One still frame of a window the user picks.
///
/// `screencapture -w` puts macOS into window-selection mode: the pointer turns
/// into a camera, and the next click captures that window. Screen Recording
/// permission applies, and Escape cancels without producing a file.
#[tauri::command]
fn screen_capture_window() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        use base64::{engine::general_purpose::STANDARD, Engine as _};

        let path = std::env::temp_dir().join(format!("lantas-window-{}.jpg", std::process::id()));
        let status = std::process::Command::new("/usr/sbin/screencapture")
            .args(["-x", "-w", "-t", "jpg"])
            .arg(&path)
            .status()
            .map_err(|error| format!("Could not start window capture: {error}"))?;
        if !status.success() || !path.exists() {
            return Err("No window was captured. Click a window when the camera pointer appears, or press Escape to cancel.".to_string());
        }
        let bytes = std::fs::read(&path)
            .map_err(|error| format!("Could not read the window capture: {error}"))?;
        let _ = std::fs::remove_file(&path);
        if bytes.is_empty() {
            return Err("The window capture was empty. Check Screen Recording permission.".to_string());
        }
        Ok(STANDARD.encode(bytes))
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Window capture is available in the macOS build.".to_string())
    }
}

fn open_in_browser(url: &str, prefer_chrome: bool) -> Result<(), String> {
    let parsed = parse_url(url)?;
    let target = parsed.as_str();

    #[cfg(target_os = "macos")]
    {
        if prefer_chrome {
            let chrome = std::process::Command::new("open")
                .args(["-a", "Google Chrome", target])
                .status();
            if let Ok(status) = chrome {
                if status.success() {
                    return Ok(());
                }
            }
        }
        let status = std::process::Command::new("open")
            .arg(target)
            .status()
            .map_err(|error| format!("Could not open {target} ({error})."))?;
        if status.success() {
            return Ok(());
        }
        // Report it: the app then keeps the connect link on screen instead of
        // announcing a browser that never appeared.
        return Err(format!("macOS could not open {target}."));
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", target])
            .status()
            .map_err(|error| format!("Could not open {target} ({error})."))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if prefer_chrome {
            let chrome = std::process::Command::new("google-chrome")
                .arg(target)
                .status();
            if let Ok(status) = chrome {
                if status.success() {
                    return Ok(());
                }
            }
        }
        let status = std::process::Command::new("xdg-open")
            .arg(target)
            .status()
            .map_err(|error| format!("Could not open {target} ({error})."))?;
        if status.success() {
            return Ok(());
        }
        Err(format!("xdg-open could not open {target}."))
    }
}

/// Snapshot of the Chrome bridge: connection, live tab, page, elements.
#[tauri::command]
fn chrome_bridge_state() -> String {
    bridge::state_json()
}

/// Forwards one JSON command to the connected Chrome extension.
#[tauri::command]
fn chrome_bridge_send(payload: String) -> Result<usize, String> {
    bridge::send(&payload)
}

/// Finds the shipped extension folder, whether running from source or a bundle.
fn find_extension_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources.join("chrome-extension"));
        candidates.push(resources.join("_up_").join("chrome-extension"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("chrome-extension"));
            candidates.push(dir.join("../Resources/chrome-extension"));
        }
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../chrome-extension"));
    candidates.push(PathBuf::from("chrome-extension"));

    candidates
        .into_iter()
        .find(|path| path.join("manifest.json").is_file())
}

/// Where the loadable Chrome extension lives on this machine.
#[tauri::command]
fn chrome_extension_dir(app: tauri::AppHandle) -> String {
    find_extension_dir(&app)
        .map(|path: PathBuf| path.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// Opens the extension folder in Finder so it can be loaded unpacked.
#[tauri::command]
fn chrome_extension_reveal(app: tauri::AppHandle) -> Result<String, String> {
    let path = find_extension_dir(&app).ok_or_else(|| {
        "The Chrome extension folder was not found next to the app.".to_string()
    })?;

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|error| error.to_string())?;
    }

    Ok(path.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Provider requests go through Rust, so keys are not limited by
        // webview CORS and no preflight leaves the machine.
        .plugin(tauri_plugin_http::init())
        // Native folder picker and file reads for the Code tab.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // In-app updates: the manifest is `latest.json` on the newest public
        // release, and every bundle is checked against the key in tauri.conf.json.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(terminal::TerminalState::default())
        // Loopback WebSocket the Lantas Chrome extension connects to.
        .setup(|_app| {
            bridge::start();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            el_open,
            el_bounds,
            el_navigate,
            el_close,
            el_visible,
            el_eval,
            el_run,
            el_click,
            el_type,
            el_history,
            el_reload,
            el_window,
            chrome_bridge_state,
            chrome_bridge_send,
            chrome_extension_dir,
            chrome_extension_reveal,
            open_external,
            open_in_chrome,
            open_in_vscode,
            open_privacy_settings,
            screen_capture,
            screen_capture_window,
            git::git_status,
            git::git_diff,
            git::git_stage,
            git::git_unstage,
            git::git_commit,
            git::git_push,
            git::git_pull,
            git::git_init,
            git::git_set_remote,
            git::git_branches,
            git::git_checkout,
            workspace::workspace_create_dir,
            workspace::workspace_create_file,
            workspace::workspace_rename,
            workspace::workspace_delete,
            terminal::open_external_terminal,
            terminal::open_cli_terminal,
            terminal::terminal_start,
            terminal::terminal_shell,
            terminal::terminal_cli,
            terminal::install_cli_command,
            terminal::terminal_write,
            terminal::terminal_stop,
            vscode::vscode_import,
            bookmarks::browser_bookmarks,
            bookmarks::browser_profile_paths
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lantas");
}
