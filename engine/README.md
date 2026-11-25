# Browser engine

Lantas has two browser paths.

1. **Embedded** — `src/lib/browserAgent.ts` drives the WKWebView child (or the
   user's Chrome through the extension) one action at a time. Good for reading
   a page, clicking a control, filling a form.
2. **Engine** — this folder. It runs [browser-use](https://github.com/browser-use/browser-use)
   in its own Python process, driving a real Chromium over CDP. The app hands
   it a whole task (`browser {"action":"task","task":"open Mathway and solve 2x + 4 = 10"}`)
   and gets one answer back.

The second path exists because a real browser has trusted input, real
navigation, downloads and a saved profile. Synthetic events inside an embedded
webview can never be those things.

## Start it

```bash
bash engine/run.sh
```

The first run creates `engine/.venv` and installs browser-use. It listens on
`http://127.0.0.1:8765` and prints its version. Leave it running; the app finds
it automatically and falls back to the embedded path if it is not there.

Environment:

| Variable | Default | Meaning |
| --- | --- | --- |
| `LANTAS_ENGINE_PORT` | `8765` | Port the app connects to. |
| `LANTAS_ENGINE_HEADLESS` | `1` | `0` shows the browser window. |
| `LANTAS_ENGINE_PROFILE` | `~/.lantas/browser-profile` | Chrome profile, so logins persist. |
| `LANTAS_ENGINE_CHROME` | auto | Path to a Chromium/Chrome binary. |

## Protocol

- `GET /health` → `{ok, engine, version, busy}`
- `POST /task {task, model, kind, apiKey, baseUrl, maxSteps}` → `{ok, result, steps}`
- `POST /selftest` → starts the browser once and reports where it landed
- `POST /stop` → cancels the running task

`kind` is the provider shape the app already uses: `openai` (also OpenRouter,
Groq, NVIDIA, LM Studio, Ollama, custom), `anthropic`, `google`. The app sends
the session's own model and key, so nothing extra has to be configured.

## Notes

- The engine is optional. Nothing in the app requires it to start.
- macOS will ask for Automation/Accessibility permission the first time
  Chromium is driven; grant it once.
- browser-use is MIT licensed; see `THIRD_PARTY_NOTICES.md`.
