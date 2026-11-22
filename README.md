# Lantas

A desktop coding agent with screen awareness and computer control. Sessions,
providers, skills and MCP integrations, in one window.

## Run the app

```bash
npm install
npm start          # reuse a running server, or start one and open a window
```

`npm start` is safe to run repeatedly: if Lantas is already serving on port 3000
it opens a window for it, otherwise it starts Vite and waits until it answers.

- **macOS** — opens a chromeless Chrome/Edge/Brave window (`--app` mode).
- **Headless / cloud workspace** — prints the URL; use the Browser panel.
- Pick another port with `PORT=1700 npm start`.

### As a real macOS app

Only this part needs Rust and Xcode, and it must run on macOS:

```bash
xcode-select --install
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
. "$HOME/.cargo/env"
npm run tauri dev      # native window
npm run tauri build    # .app + .dmg
```

If `tauri` reports `failed to run 'cargo metadata'`, Rust is missing from
`PATH` — open a new terminal. On Linux, `tauri dev` also needs
`libwebkit2gtk-4.1` and `libgtk-3` development packages.

## Providers

Settings → Providers. Supported: Anthropic, OpenAI, OpenRouter, Groq, Google,
Ollama, LM Studio and any OpenAI-compatible base URL.

- Bring your own key, or use a local server (`Ollama`, `LM Studio`).
- **Test connection** checks the endpoint and sends one tiny turn.
- **Fetch models** fills the model list from the provider (`/models`,
  `/api/tags`), so Ollama models appear automatically.
- With no provider connected, replies come from a local demo runtime and are
  labelled as such.

Keys live in this app's local storage, unencrypted. Use a scoped key you can
rotate. In the desktop build, provider requests go through Tauri's HTTP client
(`src-tauri/capabilities/default.json`) so keys are not exposed to webview CORS;
in a browser tab, providers that allow CORS work directly. To use a custom
endpoint in the desktop build, add its host to the `http:default` scope.

For Ollama in a browser tab, allow the origin:

```bash
OLLAMA_ORIGINS=* ollama serve
```

## Skills and integrations

- **Skills** are instructions appended to the system prompt while enabled.
  Built-ins cover commits, review, release notes and test gaps; create your own
  with a name, description and instructions.
- **Integrations** are MCP servers. HTTP servers get a real `initialize`
  handshake from **Test**; stdio servers store their command and start with the
  desktop runtime.

## Layout

```
src/            React app: sessions, providers, settings, skills, MCP
src/lib/        store, provider clients, system prompt, demo runtime
src-tauri/      Tauri 2 shell: macOS window, HTTP bridge, bundle config, icons
scripts/        icon generation, no-Rust launcher
```

The demo runtime in `src/lib/agent.ts` streams scripted tool calls, diffs and
shell output. Real providers stream plain text through `src/lib/providers.ts`;
tool execution is the next layer.
