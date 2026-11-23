Lantas 1.0.1

- **Chrome connections work.** Composio connect links now open in Chrome through the native shell, with a copyable fallback.
- **New side panels.** Both the Chrome extension and Lantas Browser use the cream-and-ink panel, a searchable model picker, Ask/Act modes and a saved thread.
- **Browser AI that acts through tools.** Page snapshots, structured click/type/scroll/navigate actions, and a fresh read after every action instead of guessing coordinates.
- **A real source-control panel.** Status, diffs, stage, commit, pull, push and origin setup through your own git. AI edits are staged for **Keep** or **Decline** in the review bar.
- **VS Code setup import.** Settings, themes, snippets, keybindings and the installed-extension inventory come across; extensions that need VS Code's extension host are labelled.
- **Chrome bookmark import** for Lantas Browser. Chrome logins stay in Chrome through the extension.
- **A new install window.** The dmg background uses the binary-cloud lockup, a quiet bit field and the site's typography.
- **A terminal app.** `lantas` streams answers with the same plan/build split, tools and approval prompts. Install it with `bash scripts/install-cli.sh`.

Builds are ad-hoc signed until the Developer ID secrets described in `PUBLISH.md` are configured. On an ad-hoc build macOS may ask you to confirm; the download page's installer clears quarantine as a local workaround. A notarized build opens normally.
