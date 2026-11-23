# Publishing Lantas without publishing the source

The app source lives in this repository and stays here, private. The public surface is
the static site in `public-repo/` plus the built app on GitHub Releases. Nothing in that
folder is source code, build tooling or git history, and no file in it points at this
repository.

## How a new version reaches people

1. Bump the version in `src-tauri/tauri.conf.json` **and** `APP_VERSION` in
   `src/lib/updates.ts`.
2. Commit, then push a matching tag: `git tag v1.1.0 && git push origin main --tags`.
3. CI builds on macOS, ad-hoc signs the app, and runs `scripts/package-release.sh`. That
   produces `release-assets/`: the dmg, the app zip, the extension zip, `Lantas.app.tar.gz`
   with its `.sig`, and `latest.json`.
4. CI publishes those files as a release on `Lantas-download` (tag `v1.1.0`).
5. Every installed app reads
   `…/Lantas-download/releases/latest/download/latest.json` on launch, sees the newer
   version, downloads the bundle, verifies the signature, installs it, and offers
   **Restart to update** in the title bar.
6. `versions.html` lists the release on its own — it reads the same feed, so there is
   never a changelog to hand-edit.

The tag check in the workflow fails the build if the tag and `tauri.conf.json` disagree,
so a release can never ship a manifest pointing at a version the app does not claim.

## One-time: the signing key

Tauri's updater refuses unsigned bundles; that is the whole point of it. Make the key
once, on your Mac:

```bash
cd /path/to/Lantas
npm install
npm run tauri signer generate -- -w ~/.tauri/lantas.key
```

It asks for a password (you may leave it empty), writes `~/.tauri/lantas.key`, and prints
two long strings. Then:

1. **Public key** — copy the value printed as `Public key:` (it starts with
   `dW50cnVzdGVkIGNvbW1lbnQ6`, the base64 of the key file). Paste it into
   `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`, replacing
   `REPLACE_WITH_YOUR_PUBLIC_KEY`, and commit. This key is compiled into the app; it is
   what makes a tampered download impossible.
2. **Private key** — repo → Settings → Secrets and variables → Actions → new secret
   `TAURI_SIGNING_PRIVATE_KEY`, value = the contents of `~/.tauri/lantas.key`
   (`pbcopy < ~/.tauri/lantas.key`).
3. If you set a password: secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, same place.
4. **Publishing token** (optional, makes releases automatic) — a classic PAT with
   `contents: write` on `Lantas-download`, saved as `LANTAS_RELEASE_TOKEN`. Without it,
   CI still builds and signs; download the `Lantas-macOS` artifact and attach its files
   to the release by hand.

Keep `~/.tauri/lantas.key` somewhere safe and backed up. If it is lost, already-installed
apps can no longer verify new releases — those people would have to download a build by
hand once.

The build you have installed today predates the updater, so **install one more build by
hand**. Every release after that updates itself.

## One-time: the public download repository

1. **Create an empty public repository** named `Lantas-download` under `AnwarKalonov`
   (no README, no .gitignore).
2. **Make a release.** Push a tag (above) with `LANTAS_RELEASE_TOKEN` set, or download the
   `Lantas-macOS` artifact and create the release yourself. Asset names come straight from
   `release-assets/`:

   | Asset | What it is |
   | --- | --- |
   | `Lantas-<version>-arm64.dmg` | drag to Applications |
   | `Lantas-<version>-arm64.app.zip` | the app, zipped |
   | `Lantas.app.tar.gz` + `.sig` | the updater bundle and its signature |
   | `latest.json` | the manifest the app reads |
   | `chrome-extension.zip` | the Chrome extension |

   `latest.json` must live on the **latest** release, because that is the URL the app
   asks. Keep the file names exact: the manifest points at `Lantas.app.tar.gz`, and the
   site labels builds by matching `arm64`/`aarch64` and `x64` in the names.
3. **Push the site** from a temporary copy, never by pointing this repository at the
   public remote:

   ```bash
   bash scripts/sync-public-repo.sh
   rsync -a public-repo/ /tmp/lantas-public/
   cd /tmp/lantas-public
   git init -b main
   git add .
   git commit -m "Lantas download site"
   git remote add origin https://github.com/AnwarKalonov/Lantas-download.git
   git push -u origin main
   ```

   Starting a fresh repository is what keeps this repository's history — and the source
   in it — out of the public repository.
4. **Turn on Pages**: `Lantas-download` → Settings → Pages → Deploy from a branch →
   `main` / root. The pages work on Pages or from the repo view.

## Intel Macs

CI builds on `macos-latest`, which is Apple silicon, so `latest.json` carries only
`darwin-aarch64`. An Intel Mac simply finds no update and keeps the version it installed —
it never downloads an arm64 bundle. Ship an Intel build by adding a `macos-13` job and a
second `platforms` entry (`darwin-x86_64`) pointing at its own tarball.

## After changing the site

```bash
bash scripts/sync-public-repo.sh
```

Commit and push `public-repo/` here if you keep it in sync; publish the same folder to
the public repository as above. Run `rsync` fresh each time so no stale page or asset
survives.

## Rules that keep the split honest

- Keep this repository **private**. A public visibility flip exposes `src/`,
  `src-tauri/`, `chrome-extension/`, the build scripts and every commit.
- Never push this repository's history to `Lantas-download`. Copy files, not `.git`.
- The site no longer says "open source", "MIT" or "build from source"; keep it that way
  unless the source is published.
- `public-repo/LICENSE` is freeware, not MIT: free to use, not free to copy or modify.
- `versions.html` never hard-codes a release list. GitHub Releases is the source; a
  hand-written list goes stale the first time a build is cut.
- Never commit the private signing key, a PAT, or a signed bundle into either repository.
