//! Local bridge between Lantas and the Chrome extension.
//!
//! The extension opens a WebSocket to `127.0.0.1:47654` and stays connected.
//! Lantas sends JSON commands down that socket and the extension reports page
//! state and command results back. Everything stays on this machine: the
//! listener binds loopback only and is never proxied.

use std::collections::VecDeque;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
use sha1::{Digest, Sha1};

pub const PORT: u16 = 47654;

const MAX_FRAME: u64 = 8 * 1024 * 1024;
const EVENT_CAP: usize = 80;
const HANDSHAKE_LIMIT: usize = 16 * 1024;

struct Inner {
    running: bool,
    error: String,
    agent: String,
    seen: u64,
    clients: Vec<(u64, Arc<Mutex<TcpStream>>)>,
    next_id: u64,
    state: Value,
    events: VecDeque<Value>,
}

impl Inner {
    fn new() -> Self {
        Self {
            running: false,
            error: String::new(),
            agent: String::new(),
            seen: 0,
            clients: Vec::new(),
            next_id: 0,
            state: json!({}),
            events: VecDeque::new(),
        }
    }
}

static INNER: OnceLock<Arc<Mutex<Inner>>> = OnceLock::new();

fn inner() -> &'static Arc<Mutex<Inner>> {
    INNER.get_or_init(|| Arc::new(Mutex::new(Inner::new())))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

/// Starts the loopback listener once. A second copy of Lantas cannot bind the
/// port, so it reports the conflict instead of silently doing nothing.
pub fn start() {
    let shared = inner().clone();
    thread::spawn(move || {
        let listener = match TcpListener::bind(("127.0.0.1", PORT)) {
            Ok(listener) => listener,
            Err(error) => {
                if let Ok(mut guard) = shared.lock() {
                    guard.error = format!(
                        "Port {PORT} could not be opened ({error}). Quit another copy of Lantas and reopen it."
                    );
                }
                return;
            }
        };

        if let Ok(mut guard) = shared.lock() {
            guard.running = true;
            guard.error.clear();
        }

        for incoming in listener.incoming() {
            match incoming {
                Ok(stream) => {
                    let shared = shared.clone();
                    thread::spawn(move || handle(stream, shared));
                }
                Err(_) => thread::sleep(Duration::from_millis(120)),
            }
        }
    });
}

fn handle(mut stream: TcpStream, shared: Arc<Mutex<Inner>>) {
    let _ = stream.set_nodelay(true);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(90)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(4)));

    let key = match handshake(&mut stream) {
        Ok(key) => key,
        Err(_) => return,
    };

    let accept = STANDARD.encode(Sha1::digest(
        format!("{key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11").as_bytes(),
    ));
    let response = format!(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\nAccess-Control-Allow-Origin: *\r\n\r\n"
    );
    if stream.write_all(response.as_bytes()).is_err() {
        return;
    }

    let writer = match stream.try_clone() {
        Ok(clone) => Arc::new(Mutex::new(clone)),
        Err(_) => return,
    };

    let id = {
        let mut guard = match shared.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        guard.next_id += 1;
        let id = guard.next_id;
        guard.clients.push((id, writer.clone()));
        guard.seen = now_ms();
        id
    };

    let mut pending: Vec<u8> = Vec::new();
    let mut pending_open = false;

    loop {
        let frame = match read_frame(&mut stream) {
            Ok(frame) => frame,
            Err(_) => break,
        };

        match frame.opcode {
            0x1 => {
                pending = frame.payload;
                pending_open = true;
            }
            0x0 => {
                if pending_open {
                    pending.extend_from_slice(&frame.payload);
                    if pending.len() as u64 > MAX_FRAME {
                        break;
                    }
                } else {
                    continue;
                }
            }
            0x8 => break,
            0x9 => {
                if let Ok(mut stream) = writer.lock() {
                    let _ = write_frame(&mut stream, 0xA, &frame.payload);
                }
                continue;
            }
            _ => continue,
        }

        if frame.fin && pending_open {
            pending_open = false;
            if let Ok(text) = String::from_utf8(pending.clone()) {
                receive(&text, &shared);
            }
            pending.clear();
        }
    }

    if let Ok(mut guard) = shared.lock() {
        guard.clients.retain(|(client, _)| *client != id);
        guard.seen = now_ms();
    }
}

fn receive(text: &str, shared: &Arc<Mutex<Inner>>) {
    let value: Value = match serde_json::from_str(text) {
        Ok(value) => value,
        Err(_) => return,
    };
    let kind = value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let mut guard = match shared.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };
    guard.seen = now_ms();

    if kind == "hello" {
        guard.agent = value
            .get("version")
            .and_then(Value::as_str)
            .unwrap_or("extension")
            .to_string();
    }

    if let Some(object) = value.as_object() {
        for key in ["tabs", "active", "page", "elements"] {
            if let Some(field) = object.get(key) {
                if let Some(state) = guard.state.as_object_mut() {
                    state.insert(key.to_string(), field.clone());
                }
            }
        }
    }

    if matches!(kind.as_str(), "result" | "event" | "error") {
        let mut record = value;
        if let Some(object) = record.as_object_mut() {
            object.insert("kind".into(), json!(kind));
            object.insert("at".into(), json!(now_ms()));
        }
        guard.events.push_back(record);
        while guard.events.len() > EVENT_CAP {
            guard.events.pop_front();
        }
    }
}

/// Sends a JSON command to every connected extension.
pub fn send(payload: &str) -> Result<usize, String> {
    let writers: Vec<Arc<Mutex<TcpStream>>> = {
        let guard = inner()
            .lock()
            .map_err(|_| "The Chrome bridge is unavailable.".to_string())?;
        guard
            .clients
            .iter()
            .map(|(_, writer)| writer.clone())
            .collect()
    };

    if writers.is_empty() {
        return Err(
            "The Chrome extension is not connected. Install it once and keep Chrome open."
                .to_string(),
        );
    }

    let mut sent = 0;
    for writer in writers {
        if let Ok(mut stream) = writer.lock() {
            if write_frame(&mut stream, 0x1, payload.as_bytes()).is_ok() {
                sent += 1;
            }
        }
    }

    if sent == 0 {
        Err("The Chrome extension dropped the connection. Reopen Chrome.".to_string())
    } else {
        Ok(sent)
    }
}

/// Snapshot for the UI: connection, live tab, page, elements and recent results.
pub fn state_json() -> String {
    let guard = match inner().lock() {
        Ok(guard) => guard,
        Err(_) => return json!({ "running": false, "error": "bridge unavailable" }).to_string(),
    };
    let state = guard.state.clone();
    json!({
        "running": guard.running,
        "error": guard.error,
        "connected": !guard.clients.is_empty(),
        "port": PORT,
        "agent": guard.agent,
        "seen": guard.seen,
        "tabs": state.get("tabs").cloned().unwrap_or_else(|| json!([])),
        "active": state.get("active").cloned().unwrap_or(Value::Null),
        "page": state.get("page").cloned().unwrap_or(Value::Null),
        "elements": state.get("elements").cloned().unwrap_or_else(|| json!([])),
        "events": guard.events.iter().cloned().collect::<Vec<Value>>(),
    })
    .to_string()
}

fn handshake(stream: &mut TcpStream) -> Result<String, String> {
    let mut buffer: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 1024];

    loop {
        let read = stream.read(&mut chunk).map_err(|error| error.to_string())?;
        if read == 0 {
            return Err("connection closed".into());
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
        if buffer.len() > HANDSHAKE_LIMIT {
            return Err("headers too large".into());
        }
    }

    let text = String::from_utf8_lossy(&buffer);
    let mut key = String::new();
    let mut origin = String::new();

    for line in text.lines() {
        let lower = line.to_ascii_lowercase();
        if lower.starts_with("sec-websocket-key:") {
            key = line["sec-websocket-key:".len()..].trim().to_string();
        } else if lower.starts_with("origin:") {
            origin = line["origin:".len()..].trim().to_string();
        }
    }

    // Only the extension (or a non-browser client, which sends no Origin) may
    // connect. A website in any tab is refused, so a page cannot pose as Lantas.
    let web_page = !origin.is_empty() && origin != "null" && !origin.starts_with("chrome-extension://");
    if web_page {
        let _ = stream.write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
        return Err("origin not allowed".into());
    }

    if key.is_empty() {
        return Err("missing websocket key".into());
    }

    Ok(key)
}

struct Frame {
    fin: bool,
    opcode: u8,
    payload: Vec<u8>,
}

fn read_frame(stream: &mut TcpStream) -> Result<Frame, String> {
    let mut head = [0u8; 2];
    stream.read_exact(&mut head).map_err(|error| error.to_string())?;

    let fin = head[0] & 0x80 != 0;
    let opcode = head[0] & 0x0f;
    let masked = head[1] & 0x80 != 0;
    let mut length = u64::from(head[1] & 0x7f);

    if length == 126 {
        let mut extended = [0u8; 2];
        stream
            .read_exact(&mut extended)
            .map_err(|error| error.to_string())?;
        length = u64::from(u16::from_be_bytes(extended));
    } else if length == 127 {
        let mut extended = [0u8; 8];
        stream
            .read_exact(&mut extended)
            .map_err(|error| error.to_string())?;
        length = u64::from_be_bytes(extended);
    }

    if length > MAX_FRAME {
        return Err("frame too large".into());
    }

    let mut mask = [0u8; 4];
    if masked {
        stream
            .read_exact(&mut mask)
            .map_err(|error| error.to_string())?;
    }

    let mut payload = vec![0u8; length as usize];
    stream
        .read_exact(&mut payload)
        .map_err(|error| error.to_string())?;

    if masked {
        for (index, byte) in payload.iter_mut().enumerate() {
            *byte ^= mask[index % 4];
        }
    }

    Ok(Frame {
        fin,
        opcode,
        payload,
    })
}

fn write_frame(stream: &mut TcpStream, opcode: u8, payload: &[u8]) -> std::io::Result<()> {
    let mut frame = Vec::with_capacity(payload.len() + 10);
    frame.push(0x80 | opcode);
    let length = payload.len();
    if length < 126 {
        frame.push(length as u8);
    } else if length <= u16::MAX as usize {
        frame.push(126);
        frame.extend_from_slice(&(length as u16).to_be_bytes());
    } else {
        frame.push(127);
        frame.extend_from_slice(&(length as u64).to_be_bytes());
    }
    frame.extend_from_slice(payload);
    stream.write_all(&frame)?;
    stream.flush()
}
