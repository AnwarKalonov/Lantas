Lantas 1.0.8

- **“Open X” opens X.** The address bar and the browser tool strip the command word, resolve the sites people actually name through an explicit table (GitHub, YouTube, Gmail, Drive, Notion, Reddit, Figma, ChatGPT, Claude, Spotify, Stack Overflow and the rest), and never turn a command into a Google query. A destination the table does not know comes back as a question for the model, not a search. Typing a real query still searches.
- **The agent has a visible pointer.** Every click, field and scroll draws a blue cursor inside the page itself, with a ripple on a click, so you can watch where the work is happening. It is injected into the page, so it appears over the native webview that an app overlay cannot paint on.
- **Provider markers are gone.** MiniMax streams `<]minimax[>` around its thinking, and the transcript used to print the brackets verbatim. They are filtered from the visible stream, including when a marker is split across deltas, while the raw stream stays intact for tool parsing. Chat-template tokens (`<|im_start|>` and friends) are removed too.
- **A word is not a file.** Clicking a path now checks that it exists in the open folder before the window switches to the editor, so `newsletters` or `computer` in a sentence can no longer open an empty editor tab.
- **Any window on the Mac can be attached.** A new button in the chat composer puts macOS into window-selection mode (`screencapture -w`): click a window and its snapshot is attached to the message. The screen toggle still captures the whole display per turn.
- **The inbox reads broadly.** `inbox` and `search_email` page Composio’s cursor up to 300 messages each (ten pages of up to 100), and the tool text tells the model when to ask for a wide read instead of summarizing a page of ten.
- **Faster turns.** On Anthropic the system prompt is marked as an ephemeral cache prefix, so later steps in the same turn no longer reprocess it.
- **A quieter interface.** One warm graphite ramp, hairline separators and a single blue accent used for the probe, the focus ring and the active tab; prose is set in the UI face and monospace is kept for code, paths and figures; the mode switch, sidebar rows, suggestion list and composer share one spacing scale; uppercase tracked labels are gone.

This build is ad-hoc signed and not notarized. macOS may ask you to approve Lantas once: open **System Settings → Privacy & Security**, click **Open Anyway**, and authenticate.

Lantas 1.0.7

- **Lantas asks before it acts.** A consent sheet on first launch lists files, commands, screen and computer control; every tool checks the grant before it runs, so a denied capability cannot reach the disk, a shell or the pointer. Settings → Permissions reopens it, and macOS keeps its own switches for Screen Recording and Accessibility with a button straight to the right pane.
- **Screen capture works in the desktop app.** A WKWebView has no `getDisplayMedia`, so the app asks macOS for one frame through `screencapture`, plus a one-frame test in the permission sheet that reports what macOS actually allowed.
- **Composio, GitHub and Google are reachable from the app.** The Tauri HTTP scope only allowed model providers, so `backend.composio.dev` was refused and the fallback surfaced Safari's “Load failed” on every connect. The scope now includes Composio, `api.github.com`, Gmail/Google APIs and the Google accounts hosts.
- **Chat, browser and code keep separate threads.** Each thread records its surface, switching surfaces reopens the last thread you used there, and the sidebar lists only that surface's threads.
- **The browser opens the site you named.** The manual says an “open X” request means X's real home page, a bare domain such as `github.com` is a valid address, and a search engine is never substituted unless you asked for a search.
- **The bookmark star answers back.** Saving a page confirms it instead of changing an invisible flag until you return home.
- **Smaller fixes.** Release links in the app and site follow the newest release; the download page names the current build.

This build is ad-hoc signed and not notarized. macOS may ask you to approve Lantas once: open **System Settings → Privacy & Security**, click **Open Anyway**, and authenticate.

Lantas 1.0.6

- **The browser now works one step at a time.** The model gets one `browser` tool with explicit actions for opening a page, reading its controls, clicking, typing, filling, selecting, checking, hovering, waiting, scrolling, going back and going forward. It has to read the page again after each action, so a second step like “open the graphing calculator” starts from the controls that are actually on screen.
- **Tabs are first-class browser targets.** `tabs`, `switch_tab`, `new_tab` and `close_tab` act on the same tab strip the user sees, in either the native engine or Chrome. The last tab is never closed by the agent. The interaction model follows the tool-catalog approach used by Dao Browser (BSD-3-Clause); no Dao source code is included.
- **Broken browser calls are recovered instead of shown as JSON.** Models that send a bare `{ "action": "navigate", ... }`, a fenced block, or a URL split across newlines are parsed into a real call. The browser guide now tells the model to take one action per turn and verify the result before answering.
- **The model chooses every destination.** The app no longer maps product names, infers a route from the request, repairs a malformed address or falls back to a Google search. `navigate` accepts a full `https://` URL only; an incomplete value is returned to the model as an actionable error so it can choose the real page on the next step. Site-specific typing shortcuts were removed as well, leaving the same observe-act-verify loop for every page.
- **A browser chat is its own chat.** **New thread** in Browser mode starts a browser-only conversation with its own history and a browser-specific prompt. The browser tool is the only tool that prompt exposes, so small local models stop reaching for file or terminal tools while driving a page.
- **Code belongs to the same app.** The Code surface now uses the app's background, surfaces, text colours and neutral accent instead of a separate copper workbench palette. The title bar, explorer, editor, tabs, terminal and assistant read as one window.
- **The home screen uses the cloud lockup again.** The original cloud-and-wordmark logo replaces the square hero mark on Home.
- **Cleaner macOS guidance.** The download page's “could not verify” section now has a proper dark theme treatment, and the copy explains the ad-hoc signature without claiming the app source is public.

This build is ad-hoc signed and not notarized. macOS may ask you to approve Lantas once: open **System Settings → Privacy & Security**, click **Open Anyway**, and authenticate. The release is built from the tagged source by the macOS workflow; no installer extras are bundled.
