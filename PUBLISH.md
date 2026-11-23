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
- Release assets are the only binaries. Do not commit a dmg or an app bundle into the
  public repository.
