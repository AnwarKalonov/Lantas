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
async fn el_open(
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
        return Ok(());
    }

    let builder = tauri::webview::WebviewBuilder::new("el", WebviewUrl::External(parsed))
        .user_agent(BROWSER_AGENT)
        .initialization_script(SEARCH_RECOVERY);
    window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
async fn el_bounds(
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
async fn el_navigate(window: tauri::Window, url: String) -> Result<(), String> {
    let parsed = parse_url(&url)?;
    if let Some(view) = window.get_webview("el") {
        view.navigate(parsed).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn el_visible(window: tauri::Window, visible: bool) -> Result<(), String> {
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
async fn el_close(window: tauri::Window) -> Result<(), String> {
    if let Some(view) = window.get_webview("el") {
        view.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn el_eval(window: tauri::Window, script: String) -> Result<(), String> {
    if let Some(view) = window.get_webview("el") {
        view.eval(&script).map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Click by CSS selector, or by the visible text of a link/button.
#[tauri::command]
async fn el_click(window: tauri::Window, target: String) -> Result<(), String> {
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
async fn el_type(window: tauri::Window, selector: String, text: String) -> Result<(), String> {
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
async fn el_history(window: tauri::Window, direction: String) -> Result<(), String> {
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
async fn el_reload(window: tauri::Window) -> Result<(), String> {
    if let Some(view) = window.get_webview("el") {
        view.eval("location.reload()").map_err(|error| error.to_string())?;
    }
    Ok(())
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
        .invoke_handler(tauri::generate_handler![
            el_open,
            el_bounds,
            el_navigate,
            el_close,
            el_visible,
            el_eval,
            el_click,
            el_type,
            el_history,
            el_reload
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lantas");
}
