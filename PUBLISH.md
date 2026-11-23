# Publishing Lantas without publishing the source

The app source lives in this repository and stays here, private. The public surface is
the static site in `public-repo/` plus the built app on GitHub Releases. Nothing in that
folder is source code, build tooling or git history, and no file in it points at this
repository.

## One-time setup

1. **Create an empty public repository** named `Lantas-download` under `AnwarKalonov`
   (no README, no .gitignore). The site and the README already link to that URL.
2. **Build and release.** Run the `Build macOS app` workflow, download its four
   artifacts, and create a release tagged `v1.0.0` in `Lantas-download`. Asset names
   must match the download page exactly:

   | Asset | From the workflow |
   | --- | --- |
   | `Lantas-1.0.0-arm64.dmg` | arm64 dmg |
   | `Lantas-1.0.0-arm64.app.zip` | arm64 app zip |
   | `Lantas-1.0.0-x64.dmg` | x64 dmg |
   | `Lantas-1.0.0-x64.app.zip` | x64 app zip |
   | `chrome-extension.zip` | `chrome-extension/` zipped |

3. **Push the site** from a temporary copy, never by pointing this repository at the
   public remote:

   ```bash
   bash scripts/sync-public-repo.sh
   rsync -a public-repo/ /tmp/lantas-public/
   cd /tmp/lantas-public
   git init -b main
   git add .
   git commit -m "Lantas 1.0 — download site"
   git remote add origin https://github.com/AnwarKalonov/Lantas-download.git
   git push -u origin main
   ```

   Starting a fresh repository is what keeps this repository's history — and the source
   in it — out of the public repository.

4. **Turn on Pages** (optional): `Lantas-download` → Settings → Pages → Deploy from a
   branch → `main` / root. The download page works on Pages or from the repo view.

## The versions page

`versions.html` is the public changelog and the only place versions are listed. It
reads the release list straight from GitHub when it loads, so **publishing a release
is the whole update**: version, date, notes and download links appear on the page with
no HTML to edit. A visitor's browser asks GitHub at most once per ten minutes (the page
caches the answer), and anonymous GitHub reads are free.

- Write real release notes in the release body. The page shows the first few lines;
the rest stays on GitHub behind the release link.
- Keep the asset names from the table above. The page labels builds by matching the
file name (`arm64`, `x64`, `dmg`, `app.zip`, `chrome-extension.zip`), so a release
with renamed assets still lists them, just without a platform label.
- The app reads the same feed. With a newer tag published, Lantas shows
`<version> available` in the title bar and Settings → About can check by hand.
- Bump the version in both places before tagging: `src-tauri/tauri.conf.json` and
`APP_VERSION` in `src/lib/updates.ts`.

Nothing auto-installs. The notice opens the release; the person downloads it and
replaces the copy in Applications, which keeps the app free of a signing key, an
updater daemon and a server.

## After changing the site

```bash
bash scripts/sync-public-repo.sh
```

Commit and push `public-repo/` here if you keep it in sync; publish the same folder to
the public repository as in step 3. Run `rsync` fresh each time so no stale page or
asset survives.

## Rules that keep the split honest

- Keep this repository **private**. A public visibility flip exposes `src/`,
  `src-tauri/`, `chrome-extension/`, the build scripts and every commit.
- Never push this repository's history to `Lantas-download`. Copy files, not `.git`.
- The site no longer says "open source", "MIT" or "build from source"; keep it that way
  unless the source is published.
- `public-repo/LICENSE` is freeware, not MIT: free to use, not free to copy or modify.
- `versions.html` never hard-codes a release list. GitHub Releases is the source; a
  hand-written list goes stale the first time a build is cut.
- Release assets are the only binaries. Do not commit a dmg or an app bundle into the
  public repository.
