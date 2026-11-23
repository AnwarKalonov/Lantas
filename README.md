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

## Agent tools

The assistant is not a single prompt. Each live turn runs a tool loop modelled
on opencode's tool and permission contract:

- `read`, `glob`, `grep` — inspect the open workspace before answering.
- `write`, `edit` — change files. `edit` requires a unique exact match and shows
  a real diff in the transcript.
- `skill` — load an enabled skill's full procedure on demand.
- `browser` — snapshot, extract, click by label or element reference, type,
  press keys, scroll, navigate, back, forward, reload, in Lantas Browser or
  Chrome through the extension.
- `integrations` — list connected Composio apps and their tools, read mail with
  cursor pagination, search mail, or run a specific tool.

Every call is checked against permission rules before it runs (`allow`, `ask`,
`deny`, last matching rule wins). Settings → Permissions switches between
automatic and ask-first; destructive tools and arbitrary connected-app calls
always ask. Plan and Chat agents are read-only.

## Skills

Skills are operational procedures, not personalities: each names what to read,
the order to work in, and what to verify. Built-ins cover commits, review,
debugging, test gaps, refactors, release notes, PR descriptions, API design, SQL,
security and interface copy. Enabled skills are added to the system prompt;
disabled ones stay reachable through the `skill` tool. The Plugins tab installs
curated packs from `src/lib/plugins.ts` — skills only, never code.

**Integrations** in Settings are MCP servers. HTTP servers get a real
`initialize` handshake from **Test**; stdio servers store their command and
start with the desktop runtime.

## IDE

Code mode opens a separate IDE surface: VS Code's Monaco editor, an explorer, tabs,
quick open (⌘P), workspace search, an unsaved-changes panel and an assistant dock.
Open a folder to read and write real files; dropped files work read-only. Saves
write back through Tauri's fs plugin on desktop and the File System Access API in
a browser tab.

## Layout

```
src/            React app: sessions, providers, settings, skills, MCP, IDE
src/lib/        store, provider clients, system prompt, agent loop, tools
src-tauri/      Tauri 2 shell: macOS window, HTTP bridge, bundle config, icons
scripts/        icon generation, no-Rust launcher
```

The demo runtime in `src/lib/agent.ts` streams scripted tool calls, diffs and
shell output for a workspace with no provider configured. With a provider, the
real loop lives in `src/lib/agentRuntime.ts` and calls the registry in
`src/lib/tools.ts`; provider clients stay in `src/lib/providers.ts`.
