#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Provider requests go through Rust, so keys are not limited by
        // webview CORS and no preflight leaves the machine.
        .plugin(tauri_plugin_http::init())
        // Native folder picker and file reads for the Code tab.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running Lantas");
}
