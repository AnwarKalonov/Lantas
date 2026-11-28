# Changelog

Every public version of Lantas, and the changes a person using it will notice. New work is added under **1.3.0 (unreleased)** and moves under the version number when a release is cut. The long-form release notes live in [`RELEASE_NOTES.md`](RELEASE_NOTES.md).

## 1.3.0 — unreleased

### Added

- **The original lockup on Home.** The full Lantas cloud-and-wordmark artwork sits above the greeting again, at a size that belongs on the first screen.
- **Download totals on the website and GitHub.** The download page, home page, versions page and README all read the public GitHub release assets, so the number is the same everywhere and needs no manual update.
- **A public changelog.** This file records each version and the changes in it, with a short entry added as work lands.
- **A living sky on the website.** The home page draws a slow field of cloud particles in one canvas, and the pointer carries a breathing halo: a noisy ring that swells, pushes what it passes and sends an outer wave through the field. The behaviour is ported from [BreathDearMedusae](https://github.com/ewohlken2/BreathDearMedusae) and recoloured to the Lantas palette, with a lifted palette for dark mode.

### Changed

- **A calmer app shell.** The sidebar, title bar, composer, transcript, approval card, question card and permissions sheet share one quiet surface treatment. Provider and workspace status live in the footer, thread rows show the title first, and the IDE assistant is narrower so the editor stays the main surface.
- **Chat reads like a conversation.** Reasoning stays out of the reply, a long run collapses into one line that opens on demand, and assistant edits appear as a single review card with Keep and Discard instead of scattering diffs through the transcript.
- **The first screen is simpler.** Home keeps the lockup, one sentence, the composer and three example actions; the extra panels that competed with them are gone.
- **Light theme is a first-class theme.** Both themes use the same neutral palette and the same single primary action colour; green is reserved for live status. Surfaces, borders, menus, dialogs, the browser and the IDE were checked in light mode.
- **Every click has a little weight.** Controls press in quickly and release on a spring, small controls squash more than full-width rows, menus and questions grow from their anchor, and a new thread settles into the list. The whole layer respects **Reduce motion** in Settings and the system setting.
- **The IDE follows the folder.** External edits are read back into the workspace, new files appear without reopening the folder, and a file or folder removed outside Lantas is removed from the tree and from any pending review.
- **GitHub lives in the workspace.** Connect a personal access token, pick an existing repository or create one, set the origin, stage files, commit, pull and push without leaving the Code surface. The token is kept in local app storage and sent only to GitHub.
- **Screen control is part of the assistant.** The floating screen card can read the front window through Accessibility, click or type the control it names, draw the pointer where it acts, and fall back to a labelled grid when a control has no accessible name. Screen Recording and Accessibility remain macOS permissions the user grants.
- **Browser and extension stay in step.** Native and Chrome tabs share the same tab strip, agent actions return a fresh page read, and the extension keeps the page in the user's own profile.
- **Documentation is plain white.** The docs page, its nav and its code blocks moved off the warm paper ramp to a neutral white page, in light mode; dark mode is unchanged.
- **The website is cheaper to draw.** The full-screen blur filters on the sky wash and cloud blobs are gone (the gradients already read as soft), the particle canvas renders at 1× and caps at 30fps, and the field pauses when the tab is hidden.

### Fixed

- **The bottom cloud stays at the bottom of the screen.** The low cloud bank is now its own fixed layer pinned to the viewport edge at every scroll position, instead of sitting at the foot of the page, and the footer keeps clear of it.
- **The particle field is visible again.** The frosted-tile grid that covered the whole viewport — and hid the sky behind it — was removed.
- Version metadata now agrees across the app, CLI, Tauri bundle and website at **1.3.0**.
- The send button no longer turns green in light mode; the primary action is neutral in both themes.
- The public README now links the changelog, release notes and download total, and the credits list only the technologies the app uses.

## 1.2.0

- **Compare two models on one question.** The composer and thread header open a two-column view with both models streaming, each with its own picker, timing and token count.
- **The terminal is part of the CLI.** `lantas compare`, `/compare`, `/compare-model` and `web` join the existing file, edit, search and command tools; `lantas --here` opens in the current folder.
- **The Chrome extension has an agents workspace.** Agent tabs collect in one tab group, the pointer is visible in Chrome, and each click or type returns a fresh page read.
- **The side panel reads like a chat.** Live page title, example prompts, a rounded composer and the same accent as the pointer.

## 1.1.3

- **The terminal banner is the real lockup.** The logo is resampled from `public/logo.png` with the dashed enclosure and letterforms intact.
- **The prompt box lines up.** The input row no longer wraps or drifts past the frame on narrow terminals.

## 1.1.2

- **Tool calls written on one line run.** Back-to-back calls are found with either spelling, and raw tool JSON is held back instead of appearing in the reply.
- **The CLI is an agent CLI.** Boxed input, Plan/Build switching, history, a command list and questions in the same box.
- **Leaving is immediate.** A failed request no longer leaves the spinner or the process running.

## 1.1.1 and earlier

See [`RELEASE_NOTES.md`](RELEASE_NOTES.md) for the full notes on each earlier build.
