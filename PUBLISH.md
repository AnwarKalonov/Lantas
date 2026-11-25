# Publishing Lantas without publishing the source

The app source lives in this repository and stays here, private. The public surface is
the static site in `public-repo/` plus the built app on GitHub Releases. Nothing in that
folder is source code, build tooling or git history, and no file in it points at this
repository.

Two rules keep that true:

1. **`Lantas-download` has to be public.** GitHub will not serve release assets, the
   `latest.json` updater feed or Pages content from a private repository, so a private
   release repository means every download link and every update check fails with a
   404. Its contents are the published site, the README, the licence and the signed
   binaries — no application source.
2. **Never publish `Website/` (the source tree).** Only `public-repo/` is uploaded, and
   `scripts/sync-public-repo.sh` is the only thing that writes to it. Run
   `scripts/check-public-repo.sh` before pushing; it fails on source paths, secrets and
   files that should not leave the machine.

Pages: `index.html`, `docs.html`, `download.html`, `versions.html`, `privacy.html`,
`terms.html`. The privacy policy and the terms (which carry the Lantas License 1.0)
are part of the release surface: update them in the same change as the behaviour they
describe.

## How a new version reaches people

1. Bump the version in `src-tauri/tauri.conf.json` **and** `APP_VERSION` in
   `src/lib/updates.ts`.
2. Commit, then push a matching tag: `git tag v1.1.0 && git push origin main --tags`.
3. CI builds on macOS, signs the app, and runs `scripts/package-release.sh`. Without
   Apple secrets the build is ad-hoc signed and the download page explains the one-time
   **Open Anyway** approval. With all six secrets below it is Developer ID signed,
   notarized and stapled. It produces `release-assets/`: the dmg, the app zip, the
   extension zip, `Lantas.app.tar.gz` with its `.sig`, and `latest.json`.
4. Publish those files as a release on `Lantas-download` (tag `v1.1.0`). The automatic
   step uses `LANTAS_RELEASE_TOKEN`; without it, download the `Lantas-macOS` artifact and
   publish the release from the public download repository.
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

It asks for a password (you may leave it empty) and writes two single-line files:
`~/.tauri/lantas.key` (base64 private key) and `~/.tauri/lantas.key.pub` (base64 public
key). Then:

1. **Public key** — `cat ~/.tauri/lantas.key.pub` prints one line starting with
   `dW50cnVzdGVkIGNvbW1lbnQ6`. That whole line is the value for
   `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`: replace
   `REPLACE_WITH_YOUR_PUBLIC_KEY` with it and commit. The key is compiled into the app;
   it is what makes a tampered download impossible. It is public, so it is safe to share.
2. **Private key** — repo → Settings → Secrets and variables → Actions → new secret
   `TAURI_SIGNING_PRIVATE_KEY`, value = the contents of `~/.tauri/lantas.key`:
   `pbcopy < ~/.tauri/lantas.key`. Never paste this anywhere else.
3. If you set a password: secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, same place. CI
   cannot sign without it.
4. **Publishing token** (optional, makes releases automatic) — a classic PAT with
   `contents: write` on `Lantas-download`, saved as `LANTAS_RELEASE_TOKEN`. Without it,
   CI still builds and signs; download the `Lantas-macOS` artifact and attach its files
   to the release by hand.

Keep `~/.tauri/lantas.key` somewhere safe and backed up. If it is lost, already-installed
apps can no longer verify new releases — those people would have to download a build by
hand once.

The build you have installed today predates the updater, so **install one more build by
hand**. Every release after that updates itself.

## Removing the macOS “could not verify” warning

An ad-hoc signature is why macOS says it cannot verify Lantas. Only a **Developer ID
Application** certificate plus notarization removes that warning; a free Apple Developer
account cannot notarize. The workflow supports both modes:

- **No Apple secrets** — the build stays ad-hoc signed and every user approves Lantas
  once in **System Settings → Privacy & Security → Open Anyway**. The download page
  explains that one-time step. The installer clears quarantine for people who prefer it.
- **All six Apple secrets present** — CI imports the certificate, enables the hardened
  runtime, signs with the Developer ID identity, and Tauri notarizes and staples the app.
  A notarized build opens normally. Tauri only does this when the credentials below are
  complete.

Add these under repo → Settings → Secrets and variables → Actions:

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | base64 of the exported `DeveloperID.p12` (one line) |
| `APPLE_CERTIFICATE_PASSWORD` | the password chosen when exporting that `.p12` |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | the Apple ID email on the developer account |
| `APPLE_PASSWORD` | an **app-specific** password for that Apple ID, not the account password |
| `APPLE_TEAM_ID` | the 10-character team ID |

Create the certificate under Apple Developer → Certificates, IDs & Profiles →
Certificates → **Developer ID Application**. Download the `.cer`, install it in
Keychain Access, then export the certificate **and its private key** as a `.p12`.
Convert it without line breaks:

```bash
openssl base64 -A -in DeveloperID.p12 -out certificate-base64.txt
pbcopy < certificate-base64.txt
```

Make an app-specific password at <https://appleid.apple.com> → Sign-In and Security →
App-Specific Passwords. Then run the usual tag release. The workflow fails early if only
some of the six secrets are set, so a build can never look notarized when it is not.

Verify a downloaded build on a Mac:

```bash
spctl --assess --type execute --verbose=4 /Applications/Lantas.app
xcrun stapler validate /Applications/Lantas.app
```

Both should succeed. Until the secrets are added, the warning remains. `scripts/install.sh`
(also `public-repo/install.sh`) clears the quarantine flag after copying the app, which
avoids the prompt for an ad-hoc build, but it is a local workaround that asks the user to
trust a shell script — not a replacement for notarization.

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
