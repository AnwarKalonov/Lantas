//! Screen awareness and control on macOS.
//!
//! The floating screen card reads a window as an accessibility tree instead of
//! only a picture, so a text-only model can work with it, and it drives the
//! real pointer and keyboard with Core Graphics events. macOS keeps both
//! Screen Recording and Accessibility behind switches the user owns; every
//! action reports a clear error until the Accessibility switch is on.

use serde_json::Value;

#[tauri::command]
pub fn screen_info() -> Result<Value, String> {
    imp::screen_info()
}

#[tauri::command]
pub fn screen_control_permission() -> bool {
    imp::control_permission()
}

#[tauri::command]
pub fn screen_control_request() -> bool {
    imp::control_request()
}

#[tauri::command]
pub fn screen_ax_tree() -> Result<String, String> {
    imp::ax_tree()
}

#[tauri::command]
pub fn screen_windows() -> Result<String, String> {
    imp::windows()
}

#[tauri::command]
pub fn screen_focus(app: String, window: Option<String>) -> Result<String, String> {
    imp::focus(&app, window.as_deref())
}

#[tauri::command]
pub fn screen_move(x: f64, y: f64) -> Result<(), String> {
    imp::move_to(x, y)
}

#[tauri::command]
pub fn screen_click(
    x: f64,
    y: f64,
    button: Option<String>,
    count: Option<u32>,
) -> Result<(), String> {
    imp::click(
        x,
        y,
        button.as_deref().unwrap_or("left"),
        count.unwrap_or(1),
    )
}

#[tauri::command]
pub fn screen_scroll(dx: f64, dy: f64) -> Result<(), String> {
    imp::scroll(dx, dy)
}

#[tauri::command]
pub fn screen_type(text: String) -> Result<(), String> {
    imp::type_text(&text)
}

#[tauri::command]
pub fn screen_key(key: String, modifiers: Option<Vec<String>>) -> Result<(), String> {
    imp::key(&key, modifiers.unwrap_or_default())
}

#[tauri::command]
pub fn screen_drag(from_x: f64, from_y: f64, to_x: f64, to_y: f64) -> Result<(), String> {
    imp::drag(from_x, from_y, to_x, to_y)
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use serde_json::Value;

    const ONLY_MAC: &str = "Screen control is macOS-only in this build.";

    pub fn screen_info() -> Result<Value, String> {
        Err(ONLY_MAC.to_string())
    }
    pub fn control_permission() -> bool {
        false
    }
    pub fn control_request() -> bool {
        false
    }
    pub fn ax_tree() -> Result<String, String> {
        Err(ONLY_MAC.to_string())
    }
    pub fn windows() -> Result<String, String> {
        Err(ONLY_MAC.to_string())
    }
    pub fn focus(_app: &str, _window: Option<&str>) -> Result<String, String> {
        Err(ONLY_MAC.to_string())
    }
    pub fn move_to(_x: f64, _y: f64) -> Result<(), String> {
        Err(ONLY_MAC.to_string())
    }
    pub fn click(_x: f64, _y: f64, _button: &str, _count: u32) -> Result<(), String> {
        Err(ONLY_MAC.to_string())
    }
    pub fn scroll(_dx: f64, _dy: f64) -> Result<(), String> {
        Err(ONLY_MAC.to_string())
    }
    pub fn type_text(_text: &str) -> Result<(), String> {
        Err(ONLY_MAC.to_string())
    }
    pub fn key(_key: &str, _modifiers: Vec<String>) -> Result<(), String> {
        Err(ONLY_MAC.to_string())
    }
    pub fn drag(_from_x: f64, _from_y: f64, _to_x: f64, _to_y: f64) -> Result<(), String> {
        Err(ONLY_MAC.to_string())
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::Value;
    use serde_json::json;
    use std::ffi::{c_char, c_void};
    use std::ptr;
    use std::thread::sleep;
    use std::time::Duration;

    type AXRef = *mut c_void;
    type CFRef = *const c_void;

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct CGPoint {
        x: f64,
        y: f64,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct CGSize {
        width: f64,
        height: f64,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct CGRect {
        origin: CGPoint,
        size: CGSize,
    }

    const UTF8: u32 = 0x0800_0100;
    const HID_TAP: u32 = 0;
    const MOUSE_MOVED: u32 = 5;
    const MOUSE_LEFT_DOWN: u32 = 1;
    const MOUSE_LEFT_UP: u32 = 2;
    const MOUSE_RIGHT_DOWN: u32 = 3;
    const MOUSE_RIGHT_UP: u32 = 4;
    const MOUSE_OTHER_DOWN: u32 = 25;
    const MOUSE_OTHER_UP: u32 = 26;
    const CLICK_STATE_FIELD: u32 = 1;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGMainDisplayID() -> u32;
        fn CGDisplayBounds(display: u32) -> CGRect;
        fn CGEventCreateMouseEvent(
            source: *mut c_void,
            mouse_type: u32,
            position: CGPoint,
            button: u32,
        ) -> *mut c_void;
        fn CGEventCreateKeyboardEvent(source: *mut c_void, key: u16, down: bool) -> *mut c_void;
        fn CGEventCreateScrollWheelEvent(
            source: *mut c_void,
            units: u32,
            count: u32,
            wheel1: i32,
            ...
        ) -> *mut c_void;
        fn CGEventKeyboardSetUnicodeString(event: *mut c_void, length: usize, string: *const u16);
        fn CGEventSetFlags(event: *mut c_void, flags: u64);
        fn CGEventSetIntegerValueField(event: *mut c_void, field: u32, value: i64);
        fn CGEventPost(tap: u32, event: *mut c_void);
        fn CGWarpMouseCursorPosition(point: CGPoint) -> i32;
        fn CGWindowListCopyWindowInfo(option: u32, relative: u32) -> CFRef;
    }

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> u8;
        fn AXIsProcessTrustedWithOptions(options: CFRef) -> u8;
        fn AXUIElementCreateSystemWide() -> AXRef;
        fn AXUIElementCreateApplication(pid: i32) -> AXRef;
        fn AXUIElementGetPid(element: AXRef, pid: *mut i32) -> i32;
        fn AXUIElementCopyAttributeValue(
            element: AXRef,
            attribute: CFRef,
            value: *mut CFRef,
        ) -> i32;
        fn AXUIElementPerformAction(element: AXRef, action: CFRef) -> i32;
        fn AXUIElementSetAttributeValue(element: AXRef, attribute: CFRef, value: CFRef) -> i32;
        fn AXValueGetType(value: CFRef) -> u32;
        fn AXValueGetValue(value: CFRef, kind: u32, out: *mut c_void) -> u8;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(value: CFRef);
        fn CFRetain(value: CFRef) -> CFRef;
        fn CFStringCreateWithCString(alloc: CFRef, string: *const c_char, encoding: u32) -> CFRef;
        fn CFStringGetCString(string: CFRef, buffer: *mut c_char, size: isize, encoding: u32)
            -> u8;
        fn CFStringGetLength(string: CFRef) -> isize;
        fn CFStringGetMaximumSizeForEncoding(length: isize, encoding: u32) -> isize;
        fn CFGetTypeID(value: CFRef) -> usize;
        fn CFStringGetTypeID() -> usize;
        fn CFArrayGetTypeID() -> usize;
        fn CFArrayGetCount(array: CFRef) -> isize;
        fn CFArrayGetValueAtIndex(array: CFRef, index: isize) -> *const c_void;
        fn CFDictionaryGetValue(dict: CFRef, key: CFRef) -> CFRef;
        fn CFBooleanGetTypeID() -> usize;
        fn CFBooleanGetValue(value: CFRef) -> u8;
        fn CFNumberGetTypeID() -> usize;
        fn CFNumberGetValue(value: CFRef, kind: i32, out: *mut c_void) -> u8;
        fn CFDictionaryCreate(
            allocator: CFRef,
            keys: *const CFRef,
            values: *const CFRef,
            count: isize,
            key_callbacks: *const c_void,
            value_callbacks: *const c_void,
        ) -> CFRef;
        static kCFBooleanTrue: CFRef;
        static kCFTypeDictionaryKeyCallBacks: u8;
        static kCFTypeDictionaryValueCallBacks: u8;
    }

    fn need_trust() -> Result<(), String> {
        if unsafe { AXIsProcessTrusted() } != 0 {
            Ok(())
        } else {
            Err(
                "Accessibility permission is off. Turn Lantas on in System Settings › Privacy & Security › Accessibility, then try again."
                    .to_string(),
            )
        }
    }

    unsafe fn cfstr(text: &str) -> CFRef {
        let c = std::ffi::CString::new(text).unwrap_or_default();
        CFStringCreateWithCString(ptr::null(), c.as_ptr(), UTF8)
    }

    unsafe fn copy_attr(element: AXRef, name: &str) -> Option<CFRef> {
        let attribute = cfstr(name);
        if attribute.is_null() {
            return None;
        }
        let mut value: CFRef = ptr::null();
        let status = AXUIElementCopyAttributeValue(element, attribute, &mut value);
        CFRelease(attribute);
        if status == 0 && !value.is_null() {
            Some(value)
        } else {
            None
        }
    }

    unsafe fn string_of(value: CFRef) -> Option<String> {
        if value.is_null() || CFGetTypeID(value) != CFStringGetTypeID() {
            return None;
        }
        let length = CFStringGetLength(value);
        if length <= 0 {
            return Some(String::new());
        }
        let size = CFStringGetMaximumSizeForEncoding(length, UTF8) + 1;
        if size <= 0 || size > 1_000_000 {
            return None;
        }
        let mut buffer = vec![0u8; size as usize];
        if CFStringGetCString(value, buffer.as_mut_ptr() as *mut c_char, size, UTF8) == 0 {
            return None;
        }
        let end = buffer
            .iter()
            .position(|byte| *byte == 0)
            .unwrap_or(buffer.len());
        Some(String::from_utf8_lossy(&buffer[..end]).to_string())
    }

    unsafe fn bool_of(value: CFRef) -> Option<bool> {
        if value.is_null() || CFGetTypeID(value) != CFBooleanGetTypeID() {
            return None;
        }
        Some(CFBooleanGetValue(value) != 0)
    }

    unsafe fn number_of(value: CFRef) -> Option<f64> {
        if value.is_null() || CFGetTypeID(value) != CFNumberGetTypeID() {
            return None;
        }
        let mut number = 0f64;
        if CFNumberGetValue(value, 13, &mut number as *mut f64 as *mut c_void) != 0 {
            Some(number)
        } else {
            None
        }
    }

    unsafe fn attr_string(element: AXRef, name: &str) -> Option<String> {
        let value = copy_attr(element, name)?;
        let text = string_of(value);
        CFRelease(value);
        text
    }

    unsafe fn attr_bool(element: AXRef, name: &str) -> Option<bool> {
        let value = copy_attr(element, name)?;
        let flag = bool_of(value);
        CFRelease(value);
        flag
    }

    unsafe fn point_attr(element: AXRef, name: &str) -> Option<CGPoint> {
        let value = copy_attr(element, name)?;
        let mut point = CGPoint::default();
        let ok = AXValueGetType(value) == 1
            && AXValueGetValue(value, 1, &mut point as *mut CGPoint as *mut c_void) != 0;
        CFRelease(value);
        if ok {
            Some(point)
        } else {
            None
        }
    }

    unsafe fn size_attr(element: AXRef, name: &str) -> Option<CGSize> {
        let value = copy_attr(element, name)?;
        let mut size = CGSize::default();
        let ok = AXValueGetType(value) == 2
            && AXValueGetValue(value, 2, &mut size as *mut CGSize as *mut c_void) != 0;
        CFRelease(value);
        if ok {
            Some(size)
        } else {
            None
        }
    }

    fn shorten(text: &str, limit: usize) -> String {
        let clean = text
            .replace('\n', " ")
            .replace('\r', " ")
            .replace('\t', " ");
        let clean = clean.split_whitespace().collect::<Vec<_>>().join(" ");
        if clean.chars().count() <= limit {
            clean
        } else {
            clean.chars().take(limit).collect::<String>() + "…"
        }
    }

    fn interesting(role: &str, title: &str, value: &str) -> bool {
        if matches!(
            role,
            "AXButton"
                | "AXTextField"
                | "AXTextArea"
                | "AXSearchField"
                | "AXComboBox"
                | "AXPopUpButton"
                | "AXMenuButton"
                | "AXCheckBox"
                | "AXRadioButton"
                | "AXLink"
                | "AXTab"
                | "AXMenuItem"
                | "AXSlider"
                | "AXCell"
                | "AXRow"
                | "AXOutlineRow"
                | "AXDisclosureTriangle"
                | "AXIncrementor"
                | "AXColorWell"
        ) {
            return true;
        }
        if role == "AXStaticText" {
            return !title.is_empty() || !value.is_empty();
        }
        !title.is_empty() || !value.is_empty()
    }

    struct Walker {
        nodes: Vec<Value>,
        count: usize,
        stopped: bool,
    }

    impl Walker {
        unsafe fn walk(&mut self, element: AXRef, depth: usize) {
            if self.count >= 120 || depth > 8 {
                self.stopped = true;
                return;
            }
            let role = attr_string(element, "AXRole").unwrap_or_default();
            let subrole = attr_string(element, "AXSubrole").unwrap_or_default();
            let title = attr_string(element, "AXTitle")
                .or_else(|| attr_string(element, "AXDescription"))
                .unwrap_or_default();
            let value = attr_string(element, "AXValue")
                .or_else(|| attr_string(element, "AXPlaceholderValue"))
                .unwrap_or_default();
            let help = attr_string(element, "AXHelp").unwrap_or_default();
            let label = if !title.is_empty() {
                title
            } else if !help.is_empty() {
                help
            } else {
                attr_string(element, "AXRoleDescription").unwrap_or_default()
            };

            if interesting(&role, &label, &value) && !role.is_empty() {
                self.count += 1;
                let point = point_attr(element, "AXPosition").unwrap_or_default();
                let size = size_attr(element, "AXSize").unwrap_or_default();
                let enabled = attr_bool(element, "AXEnabled").unwrap_or(true);
                let focused = attr_bool(element, "AXFocused").unwrap_or(false);
                self.nodes.push(json!({
                    "ref": format!("s{}", self.count),
                    "role": role,
                    "subrole": subrole,
                    "title": shorten(&label, 120),
                    "value": shorten(&value, 180),
                    "x": point.x.round(),
                    "y": point.y.round(),
                    "w": size.width.round(),
                    "h": size.height.round(),
                    "enabled": enabled,
                    "focused": focused,
                }));
            }

            if let Some(children) = copy_attr(element, "AXChildren") {
                if CFGetTypeID(children) == CFArrayGetTypeID() {
                    let total = CFArrayGetCount(children);
                    for index in 0..total {
                        let child = CFArrayGetValueAtIndex(children, index) as AXRef;
                        if !child.is_null() {
                            self.walk(child, depth + 1);
                        }
                    }
                }
                CFRelease(children);
            }
        }
    }

    unsafe fn focused_app() -> Option<AXRef> {
        let system = AXUIElementCreateSystemWide();
        if system.is_null() {
            return None;
        }
        let app = copy_attr(system, "AXFocusedApplication");
        CFRelease(system as CFRef);
        app.map(|value| value as AXRef)
    }

    unsafe fn app_name(app: AXRef) -> String {
        attr_string(app, "AXTitle")
            .or_else(|| attr_string(app, "AXRoleDescription"))
            .unwrap_or_else(|| "Unknown app".to_string())
    }

    unsafe fn focused_window(app: AXRef) -> Option<AXRef> {
        copy_attr(app, "AXFocusedWindow").map(|value| value as AXRef)
    }

    unsafe fn window_title(window: AXRef) -> String {
        attr_string(window, "AXTitle").unwrap_or_default()
    }

    unsafe fn dict_value(dict: CFRef, key: &str) -> Option<CFRef> {
        let name = cfstr(key);
        if name.is_null() {
            return None;
        }
        let value = CFDictionaryGetValue(dict, name);
        CFRelease(name);
        if value.is_null() {
            None
        } else {
            Some(value)
        }
    }

    /// The first normal window that is not Lantas. The floating card is always
    /// in front, so "frontmost app" would otherwise always be Lantas itself.
    /// The floating pointer and the screen card are Lantas windows too, but
    /// they are never what the user means by "the front window". The main app
    /// window stays a valid target so the card can work on Lantas Browser.
    fn auxiliary_window(title: &str) -> bool {
        matches!(
            title.trim().to_lowercase().as_str(),
            "lantas screen" | "lantas pointer"
        )
    }

    unsafe fn app_pid(app: AXRef) -> i32 {
        let mut pid = 0;
        if AXUIElementGetPid(app, &mut pid) == 0 {
            pid
        } else {
            0
        }
    }

    unsafe fn front_window_owner() -> Option<(i32, String, String)> {
        let list = CGWindowListCopyWindowInfo(1 | 16, 0);
        if list.is_null() {
            return None;
        }
        let mut found = None;
        if CFGetTypeID(list) == CFArrayGetTypeID() {
            let total = CFArrayGetCount(list).min(120);
            for index in 0..total {
                let info = CFArrayGetValueAtIndex(list, index) as CFRef;
                if info.is_null() {
                    continue;
                }
                let pid = dict_value(info, "kCGWindowOwnerPID")
                    .and_then(|value| number_of(value))
                    .unwrap_or(0.0) as i32;
                if pid <= 0 {
                    continue;
                }
                let layer = dict_value(info, "kCGWindowLayer")
                    .and_then(|value| number_of(value))
                    .unwrap_or(0.0);
                if layer != 0.0 {
                    continue;
                }
                let owner = dict_value(info, "kCGWindowOwnerName")
                    .and_then(|value| string_of(value))
                    .unwrap_or_default();
                if owner.is_empty() || owner == "Window Server" || owner == "Dock" {
                    continue;
                }
                let title = dict_value(info, "kCGWindowName")
                    .and_then(|value| string_of(value))
                    .unwrap_or_default();
                if pid == std::process::id() as i32 && auxiliary_window(&title) {
                    continue;
                }
                found = Some((pid, owner, title));
                break;
            }
        }
        CFRelease(list);
        found
    }

    unsafe fn target_context() -> Option<(AXRef, String, Option<String>)> {
        if let Some((pid, name, title)) = front_window_owner() {
            let app = AXUIElementCreateApplication(pid);
            if !app.is_null() {
                return Some((app, name, if title.is_empty() { None } else { Some(title) }));
            }
        }
        focused_app().map(|app| (app, app_name(app), None))
    }

    /// A retained window for the target app. The caller releases it.
    unsafe fn window_for(app: AXRef, hint: Option<&str>) -> Option<AXRef> {
        let wanted = hint
            .map(|value| value.trim().to_lowercase())
            .filter(|value| !value.is_empty());
        let own = app_pid(app) == std::process::id() as i32;
        if let Some(windows) = copy_attr(app, "AXWindows") {
            if CFGetTypeID(windows) == CFArrayGetTypeID() {
                let total = CFArrayGetCount(windows).min(20);
                let mut first: Option<AXRef> = None;
                let mut matched: Option<AXRef> = None;
                for index in 0..total {
                    let window = CFArrayGetValueAtIndex(windows, index) as AXRef;
                    if window.is_null() {
                        continue;
                    }
                    let title = window_title(window);
                    if own && auxiliary_window(&title) {
                        continue;
                    }
                    if first.is_none() {
                        first = Some(CFRetain(window as CFRef) as AXRef);
                    }
                    if let Some(needle) = &wanted {
                        if title.to_lowercase().contains(needle.as_str()) {
                            matched = Some(CFRetain(window as CFRef) as AXRef);
                            break;
                        }
                    }
                }
                CFRelease(windows);
                if let Some(window) = matched {
                    if let Some(other) = first {
                        CFRelease(other as CFRef);
                    }
                    return Some(window);
                }
                if first.is_some() {
                    return first;
                }
                if own {
                    return None;
                }
            } else {
                CFRelease(windows);
            }
        }
        if own {
            None
        } else {
            focused_window(app)
        }
    }

    pub fn control_permission() -> bool {
        unsafe { AXIsProcessTrusted() != 0 }
    }

    /// Adds Lantas to the Accessibility list and shows the macOS prompt.
    pub fn control_request() -> bool {
        unsafe {
            if AXIsProcessTrusted() != 0 {
                return true;
            }
            let prompt_key = cfstr("AXTrustedCheckOptionPrompt");
            if prompt_key.is_null() {
                return false;
            }
            let keys = [prompt_key];
            let values = [kCFBooleanTrue];
            let options = CFDictionaryCreate(
                ptr::null(),
                keys.as_ptr(),
                values.as_ptr(),
                1,
                &kCFTypeDictionaryKeyCallBacks as *const u8 as *const c_void,
                &kCFTypeDictionaryValueCallBacks as *const u8 as *const c_void,
            );
            let trusted = if options.is_null() {
                false
            } else {
                AXIsProcessTrustedWithOptions(options) != 0
            };
            if !options.is_null() {
                CFRelease(options);
            }
            CFRelease(prompt_key);
            trusted
        }
    }

    pub fn screen_info() -> Result<Value, String> {
        unsafe {
            let bounds = CGDisplayBounds(CGMainDisplayID());
            Ok(json!({
                "x": bounds.origin.x,
                "y": bounds.origin.y,
                "width": bounds.size.width,
                "height": bounds.size.height,
            }))
        }
    }

    pub fn ax_tree() -> Result<String, String> {
        need_trust()?;
        unsafe {
            let (app, hint_name, hint_window) = target_context().ok_or_else(|| {
                "No app window was found. Open the window you want Lantas to read, then try again."
                    .to_string()
            })?;
            let name = if hint_name.is_empty() {
                app_name(app)
            } else {
                hint_name
            };
            let window = window_for(app, hint_window.as_deref());
            let title = window.map(|value| window_title(value)).unwrap_or_default();
            let root = window.unwrap_or(app);
            let mut walker = Walker {
                nodes: Vec::new(),
                count: 0,
                stopped: false,
            };
            walker.walk(root, 0);
            if root != app {
                CFRelease(root as CFRef);
            }
            CFRelease(app as CFRef);
            Ok(json!({
                "app": name,
                "window": title,
                "elements": walker.nodes,
                "truncated": walker.stopped,
            })
            .to_string())
        }
    }

    pub fn windows() -> Result<String, String> {
        need_trust()?;
        unsafe {
            let (app, hint_name, _) =
                target_context().ok_or_else(|| "No app window was found.".to_string())?;
            let name = if hint_name.is_empty() {
                app_name(app)
            } else {
                hint_name
            };
            let own = app_pid(app) == std::process::id() as i32;
            let mut list: Vec<Value> = Vec::new();
            if let Some(windows) = copy_attr(app, "AXWindows") {
                if CFGetTypeID(windows) == CFArrayGetTypeID() {
                    let total = CFArrayGetCount(windows);
                    for index in 0..total.min(20) {
                        let window = CFArrayGetValueAtIndex(windows, index) as AXRef;
                        if window.is_null() {
                            continue;
                        }
                        let title = window_title(window);
                        if own && auxiliary_window(&title) {
                            continue;
                        }
                        let point = point_attr(window, "AXPosition").unwrap_or_default();
                        let size = size_attr(window, "AXSize").unwrap_or_default();
                        list.push(json!({
                            "app": name,
                            "title": title,
                            "x": point.x.round(),
                            "y": point.y.round(),
                            "w": size.width.round(),
                            "h": size.height.round(),
                            "focused": attr_bool(window, "AXFocused").unwrap_or(false),
                            "minimized": attr_bool(window, "AXMinimized").unwrap_or(false),
                        }));
                    }
                }
                CFRelease(windows);
            }
            CFRelease(app as CFRef);
            Ok(json!({ "app": name, "windows": list }).to_string())
        }
    }

    pub fn focus(app: &str, window: Option<&str>) -> Result<String, String> {
        let app = app.trim();
        if app.is_empty() {
            return Err("An app name is required.".to_string());
        }
        let opened = std::process::Command::new("/usr/bin/open")
            .arg("-a")
            .arg(app)
            .status()
            .map_err(|error| format!("Could not open {app}: {error}"))?;
        if !opened.success() {
            return Err(format!(
                "macOS could not open “{app}”. Use the app's exact name from the Dock."
            ));
        }
        sleep(Duration::from_millis(420));

        if let Some(wanted) = window.map(str::trim).filter(|value| !value.is_empty()) {
            let result = unsafe { raise_window(wanted) };
            sleep(Duration::from_millis(160));
            return match result {
                Ok(title) => Ok(json!({ "ok": true, "app": app, "window": title }).to_string()),
                Err(error) => Ok(
                    json!({ "ok": true, "app": app, "window": null, "note": error }).to_string(),
                ),
            };
        }
        Ok(json!({ "ok": true, "app": app }).to_string())
    }

    unsafe fn raise_window(wanted: &str) -> Result<String, String> {
        let (app, _, _) =
            target_context().ok_or_else(|| "The app did not come to the front.".to_string())?;
        let windows = copy_attr(app, "AXWindows");
        CFRelease(app as CFRef);
        let Some(windows) = windows else {
            return Err("This app did not expose any windows.".to_string());
        };
        let needle = wanted.to_lowercase();
        let mut found: Option<AXRef> = None;
        let mut title = String::new();
        if CFGetTypeID(windows) == CFArrayGetTypeID() {
            for index in 0..CFArrayGetCount(windows) {
                let window = CFArrayGetValueAtIndex(windows, index) as AXRef;
                if window.is_null() {
                    continue;
                }
                let current = window_title(window);
                if current.to_lowercase().contains(&needle) {
                    found = Some(window);
                    title = current;
                    break;
                }
            }
        }
        let result = match found {
            Some(window) => {
                let raise = cfstr("AXRaise");
                if !raise.is_null() {
                    AXUIElementPerformAction(window, raise);
                    CFRelease(raise);
                }
                let main = cfstr("AXMain");
                if !main.is_null() {
                    AXUIElementSetAttributeValue(window, main, kCFBooleanTrue);
                    CFRelease(main);
                }
                Ok(title)
            }
            None => Err(format!("No window title contained “{wanted}”.")),
        };
        // The window pointers belong to the array, so release it only after
        // the actions above have finished with them.
        CFRelease(windows);
        result
    }

    fn post(event: *mut c_void) {
        if event.is_null() {
            return;
        }
        unsafe {
            CGEventPost(HID_TAP, event);
            CFRelease(event as CFRef);
        }
    }

    fn mouse(kind: u32, point: CGPoint, button: u32, click_state: i64) {
        unsafe {
            let event = CGEventCreateMouseEvent(ptr::null_mut(), kind, point, button);
            if !event.is_null() && click_state > 0 {
                CGEventSetIntegerValueField(event, CLICK_STATE_FIELD, click_state);
            }
            post(event);
        }
    }

    pub fn move_to(x: f64, y: f64) -> Result<(), String> {
        need_trust()?;
        unsafe {
            let point = CGPoint { x, y };
            CGWarpMouseCursorPosition(point);
            mouse(MOUSE_MOVED, point, 0, 0);
        }
        Ok(())
    }

    pub fn click(x: f64, y: f64, button: &str, count: u32) -> Result<(), String> {
        need_trust()?;
        let point = CGPoint { x, y };
        let right = button.eq_ignore_ascii_case("right");
        let middle = button.eq_ignore_ascii_case("middle");
        let (down, up, id) = if right {
            (MOUSE_RIGHT_DOWN, MOUSE_RIGHT_UP, 1)
        } else if middle {
            (MOUSE_OTHER_DOWN, MOUSE_OTHER_UP, 2)
        } else {
            (MOUSE_LEFT_DOWN, MOUSE_LEFT_UP, 0)
        };
        unsafe {
            CGWarpMouseCursorPosition(point);
            mouse(MOUSE_MOVED, point, id, 0);
        }
        let clicks = count.clamp(1, 3);
        for index in 1..=clicks {
            mouse(down, point, id, index as i64);
            sleep(Duration::from_millis(18));
            mouse(up, point, id, index as i64);
            if index < clicks {
                sleep(Duration::from_millis(70));
            }
        }
        Ok(())
    }

    pub fn scroll(dx: f64, dy: f64) -> Result<(), String> {
        need_trust()?;
        let vertical = -dy.round().clamp(-40.0, 40.0) as i32;
        let horizontal = -dx.round().clamp(-40.0, 40.0) as i32;
        unsafe {
            let event = CGEventCreateScrollWheelEvent(ptr::null_mut(), 1, 2, vertical, horizontal);
            post(event);
        }
        Ok(())
    }

    pub fn type_text(text: &str) -> Result<(), String> {
        need_trust()?;
        if text.is_empty() {
            return Ok(());
        }
        let chars: Vec<char> = text.chars().take(4_000).collect();
        for character in chars {
            let mut units: Vec<u16> = character.to_string().encode_utf16().collect();
            unsafe {
                let down = CGEventCreateKeyboardEvent(ptr::null_mut(), 0, true);
                if !down.is_null() {
                    CGEventKeyboardSetUnicodeString(down, units.len(), units.as_mut_ptr());
                    post(down);
                }
                let up = CGEventCreateKeyboardEvent(ptr::null_mut(), 0, false);
                if !up.is_null() {
                    CGEventKeyboardSetUnicodeString(up, units.len(), units.as_mut_ptr());
                    post(up);
                }
            }
            sleep(Duration::from_millis(4));
        }
        Ok(())
    }

    fn key_code(name: &str) -> Option<u16> {
        let lower = name.trim().to_lowercase();
        let special = match lower.as_str() {
            "return" | "enter" => 36,
            "tab" => 48,
            "escape" | "esc" => 53,
            "space" => 49,
            "delete" | "backspace" => 51,
            "forwarddelete" | "forward delete" | "del" => 117,
            "up" | "arrowup" => 126,
            "down" | "arrowdown" => 125,
            "left" | "arrowleft" => 123,
            "right" | "arrowright" => 124,
            "home" => 115,
            "end" => 119,
            "pageup" | "page up" => 116,
            "pagedown" | "page down" => 121,
            "f1" => 122,
            "f2" => 120,
            "f3" => 99,
            "f4" => 118,
            "f5" => 96,
            "f6" => 97,
            "f7" => 98,
            "f8" => 100,
            "f9" => 101,
            "f10" => 109,
            "f11" => 103,
            "f12" => 111,
            "," => 43,
            "." => 47,
            "/" => 44,
            ";" => 41,
            "'" => 39,
            "[" => 33,
            "]" => 30,
            "-" => 27,
            "=" => 24,
            "\\" => 42,
            "`" => 50,
            _ => {
                if lower.chars().count() == 1 {
                    let character = lower.chars().next().unwrap();
                    match character {
                        'a' => 0,
                        's' => 1,
                        'd' => 2,
                        'f' => 3,
                        'h' => 4,
                        'g' => 5,
                        'z' => 6,
                        'x' => 7,
                        'c' => 8,
                        'v' => 9,
                        'b' => 11,
                        'q' => 12,
                        'w' => 13,
                        'e' => 14,
                        'r' => 15,
                        'y' => 16,
                        't' => 17,
                        '1' => 18,
                        '2' => 19,
                        '3' => 20,
                        '4' => 21,
                        '6' => 22,
                        '5' => 23,
                        '9' => 25,
                        '7' => 26,
                        '8' => 28,
                        '0' => 29,
                        'o' => 31,
                        'u' => 32,
                        'i' => 34,
                        'p' => 35,
                        'l' => 37,
                        'j' => 38,
                        'k' => 40,
                        'n' => 45,
                        'm' => 46,
                        _ => return None,
                    }
                } else {
                    return None;
                }
            }
        };
        Some(special)
    }

    pub fn key(name: &str, modifiers: Vec<String>) -> Result<(), String> {
        need_trust()?;
        let code = key_code(name).ok_or_else(|| {
            format!(
                "Unknown key “{name}”. Use Return, Tab, Escape, Space, Delete, arrows, F1–F12, or a letter or digit."
            )
        })?;
        let mut flags: u64 = 0;
        for modifier in modifiers {
            match modifier.trim().to_lowercase().as_str() {
                "cmd" | "command" | "meta" => flags |= 1 << 20,
                "shift" => flags |= 1 << 17,
                "alt" | "option" | "opt" => flags |= 1 << 19,
                "ctrl" | "control" => flags |= 1 << 18,
                "" => {}
                other => {
                    return Err(format!(
                        "Unknown modifier “{other}”. Use cmd, shift, alt or ctrl."
                    ))
                }
            }
        }
        unsafe {
            let down = CGEventCreateKeyboardEvent(ptr::null_mut(), code, true);
            if !down.is_null() {
                CGEventSetFlags(down, flags);
                post(down);
            }
            sleep(Duration::from_millis(22));
            let up = CGEventCreateKeyboardEvent(ptr::null_mut(), code, false);
            if !up.is_null() {
                CGEventSetFlags(up, flags);
                post(up);
            }
        }
        Ok(())
    }

    pub fn drag(from_x: f64, from_y: f64, to_x: f64, to_y: f64) -> Result<(), String> {
        need_trust()?;
        let start = CGPoint {
            x: from_x,
            y: from_y,
        };
        let end = CGPoint { x: to_x, y: to_y };
        unsafe {
            CGWarpMouseCursorPosition(start);
            mouse(MOUSE_MOVED, start, 0, 0);
            mouse(MOUSE_LEFT_DOWN, start, 0, 1);
            for step in 1..=12 {
                let t = step as f64 / 12.0;
                let point = CGPoint {
                    x: start.x + (end.x - start.x) * t,
                    y: start.y + (end.y - start.y) * t,
                };
                mouse(6, point, 0, 1);
                sleep(Duration::from_millis(16));
            }
            mouse(MOUSE_LEFT_UP, end, 0, 1);
        }
        Ok(())
    }
}
