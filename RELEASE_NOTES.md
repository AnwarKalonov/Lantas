Lantas 1.0.6

- **The browser now works one step at a time.** The model gets one `browser` tool with explicit actions for opening a page, reading its controls, clicking, typing, filling, selecting, checking, hovering, waiting, scrolling, going back and going forward. It has to read the page again after each action, so a second step like “open the graphing calculator” starts from the controls that are actually on screen.
- **Broken browser calls are recovered instead of shown as JSON.** Models that send a bare `{ "action": "navigate", ... }`, a fenced block, or a URL split across newlines are parsed into a real call. The browser guide now tells the model to take one action per turn and verify the result before answering.
- **Addresses are resolved, not guessed.** `open desmos,com`, `desmos.com`, a hostless `https://` fragment, and a bare route such as `calculator` are resolved against the request and the current page. Whitespace is collapsed before navigation.
- **A browser chat is its own chat.** **New thread** in Browser mode starts a browser-only conversation with its own history and a browser-specific prompt. The browser tool is the only tool that prompt exposes, so small local models stop reaching for file or terminal tools while driving a page.
- **Code belongs to the same app.** The Code surface now uses the app's background, surfaces, text colours and neutral accent instead of a separate copper workbench palette. The title bar, explorer, editor, tabs, terminal and assistant read as one window.
- **The home screen uses the cloud lockup again.** The original cloud-and-wordmark logo replaces the square hero mark on Home.
- **Cleaner macOS guidance.** The download page's “could not verify” section now has a proper dark theme treatment, and the copy explains the ad-hoc signature without claiming the app source is public.

This build is ad-hoc signed and not notarized. macOS may ask you to approve Lantas once: open **System Settings → Privacy & Security**, click **Open Anyway**, and authenticate. The release is built from the tagged source by the macOS workflow; no installer extras are bundled.
