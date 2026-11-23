/// Switches the window between a translucent macOS material and an opaque
/// surface. Liquid Glass on Apple platforms must come from the OS, not CSS.
#[tauri::command]
fn set_glass(window: tauri::Window, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{
            apply_liquid_glass, apply_vibrancy, clear_liquid_glass, clear_vibrancy,
            LiquidGlassOptions, NSGlassEffectViewStyle, NSVisualEffectMaterial,
            NSVisualEffectState,
        };
        if enabled {
            // macOS 26+: the real system Liquid Glass view, not a CSS imitation.
            let options = LiquidGlassOptions::new(NSGlassEffectViewStyle::Clear)
                .radius(0.0)
                .opaque(false)
                .interactive(true);
            if apply_liquid_glass(&window, options).is_ok() {
                return Ok(());
            }
            // macOS 10.14–15: the system vibrancy material underneath.
            apply_vibrancy(
                &window,
                NSVisualEffectMaterial::HudWindow,
                Some(NSVisualEffectState::Active),
                None,
            )
            .map_err(|error| error.to_string())
        } else {
            let _ = clear_liquid_glass(&window);
            let _ = clear_vibrancy(&window);
            Ok(())
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, enabled);
        Ok(())
    }
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
        .invoke_handler(tauri::generate_handler![set_glass])
        .run(tauri::generate_context!())
        .expect("error while running Lantas");
}
