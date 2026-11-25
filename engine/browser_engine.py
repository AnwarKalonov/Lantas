#!/usr/bin/env python3
"""Lantas browser engine.

Runs browser-use (https://github.com/browser-use/browser-use, MIT) as a local
service so Lantas can hand it a whole browsing task instead of synthesising
clicks inside a WKWebView child. browser-use drives Chromium over CDP, so the
page it works on gets real trusted input, real navigation and its own
accessibility tree, and the profile directory keeps logins between runs.

The app talks to this process over plain JSON on loopback:

  GET  /health    -> {"ok": true, "engine": "browser-use", "version": "..."}
  POST /task      -> {"task": "...", "model": "...", "kind": "openai", ...}
  POST /selftest  -> starts the browser once, reports the URL it landed on
  POST /stop      -> cancels the running task

Only the standard library is used here; browser-use is the single dependency,
installed by engine/run.sh into engine/.venv.
"""

from __future__ import annotations

import asyncio
import json
import os
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

HOST = os.environ.get("LANTAS_ENGINE_HOST", "127.0.0.1")
PORT = int(os.environ.get("LANTAS_ENGINE_PORT", "8765"))
PROFILE = os.environ.get(
    "LANTAS_ENGINE_PROFILE", os.path.expanduser("~/.lantas/browser-profile")
)
HEADLESS = os.environ.get("LANTAS_ENGINE_HEADLESS", "1") != "0"
CHROME = os.environ.get("LANTAS_ENGINE_CHROME") or None

_loop = asyncio.new_event_loop()
threading.Thread(target=_loop.run_forever, name="lantas-engine", daemon=True).start()

_state: dict[str, Any] = {"browser": None, "task": None, "busy": False}


def _run(coro, timeout: float = 900.0):
    future = asyncio.run_coroutine_threadsafe(coro, _loop)
    _state["task"] = future
    try:
        return future.result(timeout=timeout)
    finally:
        _state["task"] = None


def _version() -> str:
    try:
        import browser_use

        return str(getattr(browser_use, "__version__", "installed"))
    except Exception:
        return "missing"


async def _get_browser():
    """One browser for the life of the process, so cookies and tabs persist."""
    if _state["browser"] is not None:
        return _state["browser"]

    from browser_use import Browser

    kwargs: dict[str, Any] = {
        "kind": "chromium",
        "headless": HEADLESS,
        "user_data_dir": PROFILE,
        "keep_alive": True,
    }
    if CHROME:
        kwargs["executable_path"] = CHROME
    os.makedirs(PROFILE, exist_ok=True)
    browser = Browser(**kwargs)
    await browser.start()
    _state["browser"] = browser
    return browser


def _make_llm(request: dict[str, Any]):
    from browser_use.llm import ChatAnthropic, ChatGoogle, ChatOpenAI

    kind = str(request.get("kind") or "openai").lower()
    model = str(request.get("model") or "").strip()
    api_key = (request.get("apiKey") or "").strip() or None
    base_url = (request.get("baseUrl") or "").strip()
    if not model:
        raise ValueError("No model was sent to the browser engine.")

    if kind == "anthropic":
        return ChatAnthropic(model=model, api_key=api_key)
    if kind == "google":
        return ChatGoogle(model=model, api_key=api_key)

    # Every other provider Lantas supports speaks the OpenAI shape, including
    # Ollama and LM Studio on 127.0.0.1. A missing key is normal for those.
    kwargs: dict[str, Any] = {"api_key": api_key or "local"}
    if base_url:
        kwargs["base_url"] = base_url
    return ChatOpenAI(model=model, **kwargs)


async def _task(request: dict[str, Any]) -> dict[str, Any]:
    from browser_use import Agent

    task = str(request.get("task") or "").strip()
    if not task:
        raise ValueError("A task is required.")

    agent = Agent(
        task=task,
        llm=_make_llm(request),
        browser=await _get_browser(),
        extend_system_message=request.get("extra") or None,
    )
    history = await agent.run(max_steps=int(request.get("maxSteps") or 25))

    result = ""
    for attribute in ("final_result", "final_answer"):
        getter = getattr(history, attribute, None)
        if callable(getter):
            value = getter()
            if value:
                result = str(value).strip()
                break

    steps: list[str] = []
    try:
        for item in (getattr(history, "history", None) or [])[:40]:
            steps.append(str(item)[:500])
    except Exception:
        pass

    return {"ok": True, "result": result, "steps": steps}


async def _selftest(_request: dict[str, Any]) -> dict[str, Any]:
    browser = await _get_browser()
    url = ""
    for attribute in ("get_current_page_url", "current_url"):
        getter = getattr(browser, attribute, None)
        if callable(getter):
            url = str(await getter() or "")
            break
    return {
        "ok": True,
        "engine": "browser-use",
        "version": _version(),
        "profile": PROFILE,
        "headless": HEADLESS,
        "url": url,
    }


ROUTES = {
    "/task": _task,
    "/selftest": _selftest,
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        # The Vite dev server runs on another origin; Tauri does not care.
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-headers", "content-type")
        self.send_header("access-control-allow-methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802 - stdlib naming
        self._send(204, {})

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?")[0] != "/health":
            self._send(404, {"ok": False, "error": "unknown route"})
            return
        self._send(
            200,
            {
                "ok": True,
                "engine": "browser-use",
                "version": _version(),
                "busy": bool(_state["busy"]),
                "profile": PROFILE,
                "headless": HEADLESS,
            },
        )

    def do_POST(self) -> None:  # noqa: N802
        route = self.path.split("?")[0]
        length = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            request = json.loads(raw or b"{}")
        except json.JSONDecodeError as error:
            self._send(400, {"ok": False, "error": f"bad json: {error}"})
            return

        if route == "/stop":
            future = _state.get("task")
            if future is not None:
                _loop.call_soon_threadsafe(future.cancel)
            self._send(200, {"ok": True})
            return

        handler = ROUTES.get(route)
        if handler is None:
            self._send(404, {"ok": False, "error": "unknown route"})
            return

        _state["busy"] = True
        try:
            payload = _run(handler(request))
            self._send(200, payload)
        except asyncio.CancelledError:
            self._send(200, {"ok": False, "error": "stopped"})
        except Exception as error:  # noqa: BLE001 - reported, never crashed
            traceback.print_exc()
            self._send(200, {"ok": False, "error": f"{type(error).__name__}: {error}"})
        finally:
            _state["busy"] = False

    def log_message(self, fmt: str, *args: Any) -> None:  # keep stdout readable
        print(f"[engine] {fmt % args}", flush=True)


def main() -> None:
    print(f"[engine] browser-use {_version()} on http://{HOST}:{PORT}", flush=True)
    print(f"[engine] profile {PROFILE} headless={HEADLESS}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
