Lantas 1.1.0

- **The browser never acts on its own.** The browser panel had a local command layer that read "open …", "click …" and "type …" and executed them itself, so "open desmos" became an address-bar guess and "open something" became a Google query for the word. That layer is gone: every sentence goes to the model, which picks the page and drives it with its own tool. A search-results address is refused unless you actually asked to search, and the named-site table that guessed `.com` destinations has been removed.
- **A browser command now runs instead of vanishing.** Models write calls like `browsertype {"text":"2x+4"}` with no tags, glued to the tool name. The parser only understood tags, so the call was read as prose and nothing happened — the "it opened the site but never typed" case. Glued, dotted and underscored names are recognised, and a browser call with no action is inferred from its arguments.
- **Stable element refs.** A snapshot's refs were positions, renumbered every time, so a stale ref could click whatever moved into that slot. Each ref now comes from the element's own identity and stays with it; a ref that left the page fails instead of clicking its neighbour. Control refs also drive the click, so a page re-render no longer changes what a number means.
- **Batched browser steps.** `browser {"action":"steps","steps":[…]}` runs up to twelve actions in one call — click the field, type the expression, press Enter — and returns one fresh snapshot, so a task keeps its thread instead of spending a round trip per click.
- **The Code assistant writes files.** Its turns run as Build now; before, a thread started in Chat or Plan denied every write, so the model pasted the whole file into the reply. Code blocks longer than sixteen lines also collapse with a line count.
- **Attach files in the side panels.** The Code assistant and the browser assistant both take files and images from a picker or a paste, with the same limits as the main composer, and the browser's attachments ride along with the turn.
- **The sidebar is rebuilt.** Threads searchable with ⌘F, pinned threads in their own section, project groups with counts that collapse, rename on double-click, a row menu with pin, copy ID and delete, and a footer that shows the folder, provider and model. The small logo marks are gone from the chrome; the big lockup is back on the default chat screen.
- **Settings by asking.** "Change to light mode", "turn off notifications", "switch to the plan agent" and "open appearance" apply immediately instead of opening a panel and waiting.
- **The terminal stops echoing itself.** The shell now has echo off before zsh draws anything, and ZLE off, so its own setup line and each command are no longer printed back at you. Prompt lines and the stray `%` are filtered. On the CLI tab the input stays live after the CLI exits — typing starts it again — Stop only affects the tab you are on, and a failed start says which provider step is missing instead of leaving a dead pane.

This build is ad-hoc signed and not notarized. macOS may ask you to approve Lantas once: open **System Settings → Privacy & Security**, click **Open Anyway**, and authenticate.

Lantas 1.0.9

- **Light mode is light again.** The polish stylesheet loaded last and put the dark neutral ramp on `:root`, which beat the light theme at the same specificity. Light now has its own background, surface, text and line ramp, verified against the rendered page.
- **“Open desmos” opens Desmos.** Named destinations cover far more apps (Desmos, Wolfram, Excalidraw, Linear, Vercel, Outlook, Jira, Supabase and more), and a command that is one unknown word now resolves to that product's `.com` instead of a Google query. A phrase is still never welded into a domain.
- **Typing into real editors.** MathQuill (Desmos), CodeMirror and Monaco keep their own model behind a textarea, so assigning `.value` left the page blank. Text is now inserted the way a keyboard does it, read back to confirm it landed, and a field that refuses it returns that reason to the assistant instead of “no editable field was found”. The browser guide also explains the Desmos expression row: type `2x`, not `y=2x`.
- **The pointer stays put.** The blue agent cursor no longer fades after three seconds; it stays for the task, and it now moves for hover and key presses too, not only clicks.
- **Your tabs survive.** Returning from Code (or relaunching) restores every browser tab and the one you were on. The tab strip used to reset to the home page whenever the browser view remounted.
- **Empty folders are usable.** Opening a folder with no files shows the folder's welcome with New file and New folder, instead of “Open a folder to start” with no way to create anything.
- **The terminal is a terminal.** The in-app shell runs in a real pty (`script`), so prompts, line editing and tools that check for a tty behave normally; a dead shell restarts and re-sends the command once; and the assistant's own commands no longer print into your session. A new **Open in Terminal** button opens the folder in Terminal.app.
- **Cleaner replies.** A turn's steps collapse into one line (“Used browser ×3, terminal”) that is open while it works and can be reopened, with the answer first. Cited links are collected into a Sources strip, and only real files become file chips.
- **Find mail from one person.** `search_email` turns a name into a quoted `from:`/`to:` Gmail query, reads 100 by default, retries the plain words when the narrow query is empty, and the tool text tells the model to widen with `in:anywhere` before claiming the mailbox is empty.
- **Another way to run models.** OpenCode Zen is a provider (base URL, `oc_sk_…` key, model ids), OpenRouter's `:free` models are listed, and the model picker now reads a connected provider's live `/models` list the first time it opens — so a model can be switched in the IDE or chat without a trip to Settings.
- **Smaller fixes.** The extra star button that duplicated Skills is gone; the IDE chat keeps the thread it was in and the model you picked.

This build is ad-hoc signed and not notarized. macOS may ask you to approve Lantas once: open **System Settings → Privacy & Security**, click **Open Anyway**, and authenticate.

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
