mod bookmarks;
mod bridge;
mod control;
mod git;
mod terminal;
mod vscode;
mod workspace;

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use tauri::{Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl};

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

// Screen Recording is a user-granted macOS permission, and an app that has
// never asked is not even listed in System Settings, so there is no switch for
// the user to turn on. `CGRequestScreenCaptureAccess` is the only call that
// adds Lantas to that list and shows the system prompt.
#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

/// Registers Lantas with the Screen Recording pane and asks once. Returns
/// whether macOS granted access immediately; when it returns false the switch
/// is waiting in System Settings for the user.
#[tauri::command]
fn screen_request_permission() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        return Ok(unsafe { CGRequestScreenCaptureAccess() });
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Screen Recording permission is macOS-only.".to_string())
    }
}

/// Whether this process can capture the screen right now.
#[tauri::command]
fn screen_permission() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        return Ok(unsafe { CGPreflightScreenCaptureAccess() });
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Screen Recording permission is macOS-only.".to_string())
    }
}

/// Reveals Lantas.app in Finder, so it can be dragged onto the permission list
/// on macOS versions that do not add it from the request alone.
#[tauri::command]
fn reveal_app() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let exe = std::env::current_exe()
            .map_err(|error| format!("Could not find the app: {error}"))?;
        let mut bundle = exe.clone();
        for ancestor in exe.ancestors() {
            if ancestor.extension().and_then(|value| value.to_str()) == Some("app") {
                bundle = ancestor.to_path_buf();
                break;
            }
        }
        let status = std::process::Command::new("/usr/bin/open")
            .arg("-R")
            .arg(&bundle)
            .status()
            .map_err(|error| format!("Could not open Finder: {error}"))?;
        if status.success() {
            return Ok(());
        }
        return Err("Finder did not open.".to_string());
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Finder is macOS-only.".to_string())
    }
}

/// Records the user's own input inside the child browser.
///
/// The agent drives the page by calling element methods, which dispatch no
/// pointer or key events, so anything counted here came from the person at the
/// keyboard. The app polls it while a browser turn runs and pauses the turn
/// when the count moves.
const INPUT_WATCH: &str = r#"
(() => {
  let seq = 0;
  const note = (type, event) => {
    // The app's own clicks and keystrokes are synthetic events. Counting them
    // here is what made every agent action look like the user taking over.
    if (!event || event.isTrusted === false) return;
    seq += 1;
    window.__lantasInput = {
      seq,
      type,
      x: Math.round(Number(event && event.clientX) || 0),
      y: Math.round(Number(event && event.clientY) || 0),
      at: Date.now(),
    };
  };
  addEventListener('pointerdown', (event) => note('click', event), true);
  addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    note('key', event);
  }, true);
  // Scrolling is reading, not taking over. It used to stop the agent every
  // time someone moved the page to follow along, so it is not counted here.
  addEventListener('submit', (event) => note('submit', event), true);
})();
"#;

fn parse_url(input: &str) -> Result<tauri::Url, String> {
    input
        .parse::<tauri::Url>()
        .map_err(|error| error.to_string())
}

/// Where the child browser sits and whether it is on screen.
///
/// A screenshot of a native webview is a screenshot of the screen, so the app
/// has to know the exact rectangle the page occupies. `screencapture -R` also
/// captures whatever is in front when the page is hidden, which would hand the
/// model another window's pixels, so the visible flag is checked first.
#[derive(Clone, Copy)]
struct ViewState {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    visible: bool,
}

static VIEW_STATE: OnceLock<Mutex<ViewState>> = OnceLock::new();

fn view_state() -> &'static Mutex<ViewState> {
    VIEW_STATE.get_or_init(|| {
        Mutex::new(ViewState {
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 0.0,
            visible: false,
        })
    })
}

fn remember_view(x: f64, y: f64, width: f64, height: f64) {
    if let Ok(mut state) = view_state().lock() {
        state.x = x;
        state.y = y;
        state.width = width;
        state.height = height;
    }
}

fn remember_visible(visible: bool) {
    if let Ok(mut state) = view_state().lock() {
        state.visible = visible;
    }
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
    remember_view(x, y, width, height);
    if let Some(view) = window.get_webview("el") {
        view.navigate(parsed).map_err(|error| error.to_string())?;
        view.set_position(LogicalPosition::new(x, y))
            .map_err(|error| error.to_string())?;
        view.set_size(LogicalSize::new(width, height))
            .map_err(|error| error.to_string())?;
        view.show().map_err(|error| format!("show: {error}"))?;
        remember_visible(true);
        return Ok(());
    }

    let builder = tauri::webview::WebviewBuilder::new("el", WebviewUrl::External(parsed))
        .user_agent(BROWSER_AGENT)
        .initialization_script(SEARCH_RECOVERY)
        .initialization_script(INPUT_WATCH);
    let view = window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width.max(1.0), height.max(1.0)),
        )
        .map_err(|error| format!("create: {error}"))?;
    view.show().map_err(|error| format!("show: {error}"))?;
    remember_visible(true);
    Ok(())
}

#[tauri::command]
fn el_bounds(
    window: tauri::Window,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    zoom: Option<f64>,
) -> Result<(), String> {
    remember_view(x, y, width.max(1.0), height.max(1.0));
    if let Some(view) = window.get_webview("el") {
        view.set_position(LogicalPosition::new(x, y))
            .map_err(|error| error.to_string())?;
        view.set_size(LogicalSize::new(width.max(1.0), height.max(1.0)))
            .map_err(|error| error.to_string())?;
        // The chat dock is far smaller than the page area. Shrinking the
        // webview alone reflows the site into a phone layout and crops it, so
        // the mini window also zooms the page out to show the whole thing.
        if let Some(scale) = zoom {
            view.set_zoom(scale.clamp(0.2, 1.0))
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

/// Pins a window above every app, including another app's full-screen Space.
///
/// A normal floating window disappears when the user goes full screen in
/// Safari or an editor. AppKit only keeps it in front when the window joins
/// every Space and is marked as a full-screen auxiliary window, at a level
/// above the normal and main-menu layers. Tauri exposes always-on-top and
/// `canJoinAllSpaces`, but not the auxiliary flag, so the two missing pieces
/// are set on the NSWindow directly. `orderFrontRegardless` shows the panel
/// without pulling the app out of the full-screen Space.
#[cfg(target_os = "macos")]
fn float_above_everything(window: &tauri::WebviewWindow) {
    let target = window.clone();
    let _ = window.run_on_main_thread(move || unsafe {
        let Ok(native) = target.ns_window() else {
            return;
        };
        let address = native as usize;
        use std::ffi::{c_char, c_void, CString};

        #[link(name = "objc")]
        extern "C" {
            fn objc_msgSend();
            fn sel_registerName(name: *const c_char) -> *const c_void;
        }

        fn selector(name: &str) -> *const c_void {
            let text = CString::new(name).unwrap_or_default();
            unsafe { sel_registerName(text.as_ptr()) }
        }

        let object = address as *mut c_void;
        if object.is_null() {
            return;
        }

        unsafe fn send_level(object: *mut c_void, name: &str, value: i64) {
            let send: unsafe extern "C" fn(*mut c_void, *const c_void, i64) =
                std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
            send(object, selector(name), value);
        }
        unsafe fn send_void(object: *mut c_void, name: &str) {
            let send: unsafe extern "C" fn(*mut c_void, *const c_void) =
                std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
            send(object, selector(name));
        }
        unsafe fn send_flag(object: *mut c_void, name: &str, value: bool) {
            let send: unsafe extern "C" fn(*mut c_void, *const c_void, i8) =
                std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
            send(object, selector(name), if value { 1 } else { 0 });
        }

        // NSStatusWindowLevel: above normal windows, the Dock and the main menu.
        send_level(object, "setLevel:", 25);
        // CanJoinAllSpaces | Stationary | IgnoresCycle | FullScreenAuxiliary.
        send_level(object, "setCollectionBehavior:", 1 | 16 | 64 | 256);
        send_flag(object, "setHidesOnDeactivate:", false);
        send_void(object, "orderFrontRegardless");
    });
}

/// A click-through, always-on-top layer the assistant can point on.
///
/// Drawing over other apps is only possible from a window that covers the
/// display, takes no clicks and never steals focus. The page inside is a
/// transparent canvas; the app sends it normalised points and it animates a
/// ring there, then clears it. Nothing is captured or stored.
#[tauri::command]
fn overlay_show(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("screen-overlay") {
        #[cfg(target_os = "macos")]
        {
            let _ = window.set_visible_on_all_workspaces(true);
        }
        window.show().map_err(|error| error.to_string())?;
        #[cfg(target_os = "macos")]
        float_above_everything(&window);
        return Ok(());
    }

    let monitor = app
        .primary_monitor()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "No display is available.".to_string())?;
    let scale = monitor.scale_factor();
    let size = monitor.size().to_logical::<f64>(scale);
    let position = monitor.position().to_logical::<f64>(scale);

    let window = tauri::WebviewWindowBuilder::new(
        &app,
        "screen-overlay",
        WebviewUrl::App("index.html".into()),
    )
    // A query string in a bundled asset path is not reliable across platforms;
    // the flag is set before any app code runs instead.
    .initialization_script("window.__lantasOverlay = true;")
    .title("Lantas pointer")
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .shadow(false)
    .focused(false)
    .visible(false)
    .inner_size(size.width, size.height)
    .position(position.x, position.y)
    .build()
    .map_err(|error| format!("overlay: {error}"))?;

    // The layer is a pointer, not a window: clicks reach the app underneath.
    let _ = window.set_ignore_cursor_events(true);
    #[cfg(target_os = "macos")]
    {
        let _ = window.set_visible_on_all_workspaces(true);
    }
    window.show().map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    float_above_everything(&window);
    Ok(())
}

#[tauri::command]
fn overlay_hide(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("screen-overlay") {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// The screen assistant as its own floating window.
///
/// The card used to live inside the main window, so it disappeared behind
/// whatever app the user switched to. This window stays above normal windows
/// on every Space, which is what "ask about my screen" needs while the user
/// works somewhere else. It holds the same React card, with its own capture.
#[tauri::command]
fn screen_assistant_show(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("screen-assistant") {
        window.show().map_err(|error| error.to_string())?;
        let _ = window.set_always_on_top(true);
        #[cfg(target_os = "macos")]
        float_above_everything(&window);
        let _ = window.set_focus();
        return Ok(());
    }

    let monitor = app
        .primary_monitor()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "No display is available.".to_string())?;
    let scale = monitor.scale_factor();
    let size = monitor.size().to_logical::<f64>(scale);
    let position = monitor.position().to_logical::<f64>(scale);
    // Top centre, the way a heads-up assistant sits: out of the way of the
    // window controls, and visible the moment the user looks up.
    let width = 392.0_f64.min(size.width - 32.0);
    let height = 520.0_f64.min(size.height - 104.0);
    let x = position.x + (size.width - width) / 2.0;
    let y = position.y + 46.0;

    let window = tauri::WebviewWindowBuilder::new(
        &app,
        "screen-assistant",
        WebviewUrl::App("index.html".into()),
    )
    .initialization_script("window.__lantasScreen = true;")
    .title("Lantas Screen")
    .decorations(false)
    .transparent(true)
    .shadow(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(true)
    .focused(true)
    .visible(false)
    .inner_size(width, height)
    .position(x, y)
    .build()
    .map_err(|error| format!("screen assistant: {error}"))?;

    // Follow the user across Spaces and over full-screen apps as far as macOS
    // allows a normal floating window to do so.
    #[cfg(target_os = "macos")]
    {
        let _ = window.set_visible_on_all_workspaces(true);
        float_above_everything(&window);
    }
    window.show().map_err(|error| error.to_string())?;
    let _ = window.set_focus();
    Ok(())
}

#[tauri::command]
fn screen_assistant_hide(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("screen-assistant") {
        window.hide().map_err(|error| error.to_string())?;
    }
    // The main window keeps the screen button in sync even though the popup is
    // the surface that closed.
    let _ = app.emit("lantas:screen-stopped", ());
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
    remember_visible(visible);
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
        // -D 1 pins the capture to the main display, which is the screen the
        // pointing overlay covers; a merged multi-display image would put
        // every coordinate on the wrong pixel.
        let status = std::process::Command::new("/usr/sbin/screencapture")
            .args(["-x", "-D", "1", "-t", "jpg"])
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

/// One still frame of the child browser, as base64 JPEG.
///
/// The model checks its work against what the page actually looks like: a
/// screenshot catches a cookie wall, an off-screen control or a layout the DOM
/// text cannot describe. macOS captures screen pixels, so the child webview
/// must be on screen and the app must have Screen Recording permission.
#[tauri::command]
fn el_screenshot(window: tauri::Window) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        use base64::{engine::general_purpose::STANDARD, Engine as _};

        let state = *view_state()
            .lock()
            .map_err(|_| "The browser view state is unavailable.".to_string())?;

        if !state.visible {
            return Err(
                "The browser page is not on screen, so a screenshot would capture another window. Open the Browser tab, then take the screenshot again."
                    .to_string(),
            );
        }
        // Screen capture reads pixels, not the webview. Another app in front
        // would be photographed instead of the page, so refuse rather than
        // hand the model a picture of something else.
        if !window.is_focused().unwrap_or(true) {
            return Err(
                "Lantas is not the frontmost window, so a page screenshot would capture another app. Bring Lantas to the front and take the screenshot again."
                    .to_string(),
            );
        }
        if state.width < 2.0 || state.height < 2.0 {
            return Err("The browser has no visible area yet. Open a page, then try again.".to_string());
        }

        let scale = window.scale_factor().map_err(|error| error.to_string())?;
        let inner = window.inner_position().map_err(|error| error.to_string())?;
        let x = inner.x as f64 / scale + state.x;
        let y = inner.y as f64 / scale + state.y;
        let rect = format!(
            "{},{},{},{}",
            x.round() as i64,
            y.round() as i64,
            state.width.round() as i64,
            state.height.round() as i64
        );

        let path = std::env::temp_dir().join(format!("lantas-page-{}.jpg", std::process::id()));
        let status = std::process::Command::new("/usr/sbin/screencapture")
            .args(["-x", "-R", &rect, "-t", "jpg"])
            .arg(&path)
            .status()
            .map_err(|error| format!("Could not start the page capture: {error}"))?;
        if !status.success() {
            return Err("The page capture was refused. Allow Lantas in System Settings › Privacy & Security › Screen Recording, then try again.".to_string());
        }
        let bytes = std::fs::read(&path)
            .map_err(|error| format!("Could not read the page capture: {error}"))?;
        let _ = std::fs::remove_file(&path);
        if bytes.is_empty() {
            return Err("The page capture was empty. Check Screen Recording permission.".to_string());
        }
        Ok(STANDARD.encode(bytes))
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        Err("Page screenshots are available in the macOS build.".to_string())
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

/// Releases a result the app has already read, so a page screenshot is not
/// carried by every later status read.
#[tauri::command]
fn chrome_bridge_forget(id: String) -> bool {
    bridge::forget(&id)
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
            chrome_bridge_forget,
            chrome_extension_dir,
            chrome_extension_reveal,
            open_external,
            open_in_chrome,
            open_in_vscode,
            open_privacy_settings,
            screen_permission,
            screen_request_permission,
            reveal_app,
            screen_capture,
            screen_capture_window,
            el_screenshot,
            overlay_show,
            overlay_hide,
            control::screen_info,
            control::screen_control_permission,
            control::screen_control_request,
            control::screen_ax_tree,
            control::screen_windows,
            control::screen_focus,
            control::screen_move,
            control::screen_click,
            control::screen_scroll,
            control::screen_type,
            control::screen_key,
            control::screen_drag,
            control::screen_snapshot,
            control::screen_press,
            control::screen_focus_element,
            control::screen_set_text,
            screen_assistant_show,
            screen_assistant_hide,
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
