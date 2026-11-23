Lantas 1.0.2

- **A real workbench.** The Code tab is now a VS Code-style window with the Lantas title bar kept above it: activity rail, explorer, tabs, breadcrumbs, editor status bar, search, quick open, a command palette and a bottom terminal. No mode change hides the app chrome.
- **Files you can actually manage.** Create files and folders, rename, delete, save, open another folder, and reveal paths from the explorer, editor tabs or the AI chat. The file tree handles empty folders and refreshes after every operation.
- **A Cursor-like agent chat.** Full Markdown, code blocks, clickable file paths, `@` file context, a real composer, and review cards with **Keep** or **Decline**. The assistant can point at a file and open it in the editor in one click. The same transcript drives the main chat, the code assistant and the browser assistant.
- **GitHub in the app.** Connect an account, create a new repository, attach an origin, stage, commit, pull and push without leaving the Code tab. HTTPS pushes get the connected GitHub token for that command only; it is never written into the repository.
- **A useful browser AI.** The browser assistant now uses the same clean transcript and a provider picker. Opening Settings, the command palette or an approval no longer leaves the native webview covering the panel — it is hidden while an overlay is open.
- **The CLI is in the app.** The title bar terminal button and **Terminal → CLI** open the bottom panel on a `lantas` session. The CLI is bundled with the app, so there is nothing to install first. A normal shell tab sits beside it.
- **Extensions, honestly.** The Extensions view imports your VS Code settings, themes, snippets, keybindings and installed-extension inventory, with a searchable list and marketplace link. Themes and language metadata apply to Monaco immediately. Extensions that run code still need VS Code's extension host.
- **One brand.** The chrome uses the L glyph, larger surfaces use the Lantas wordmark and lockup, and the DMG carries the same cream cloud artwork as the site.
- **A drag-to-Applications window that looks designed.** The branded DMG background is applied in both the release build and the updater overlay, and CI now opens the finished DMG and fails the build if the background, `.DS_Store`, app binary or Applications link is missing.

Builds are ad-hoc signed until the Developer ID secrets in `PUBLISH.md` are configured. On an ad-hoc build macOS may ask you to confirm; the download page's installer clears quarantine as a local workaround. A notarized build opens normally.
