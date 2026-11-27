# Publishing Lantas

The app, the static website and the signed downloads now live in one public
repository: **AnwarKalonov/Lantas**. There is no separate `Lantas-download`
repository to update.

## Cut a release

1. Bump the version in `package.json` (and the lockfile), `src-tauri/tauri.conf.json`,
   `src-tauri/Cargo.toml`, `cli/lantas.mjs` and `APP_VERSION` in
   `src/lib/updates.ts`. Keep the static fallbacks on the website in step.
2. Move the **unreleased** entries in `CHANGELOG.md` under the new version,
   update `RELEASE_NOTES.md`, and commit. The release workflow publishes the
   whole of `RELEASE_NOTES.md` as the release body.
3. Push a matching tag:

   ```bash
   git tag v1.3.0
   git push origin main --tags
   ```

4. The `Build macOS app` workflow builds on an Apple Silicon runner, verifies
   the signature, packages the `.dmg`, app zip, Chrome extension and updater
   assets, and publishes a GitHub release in this repository. It uses the
   workflow's built-in `GITHUB_TOKEN`; no classic PAT is required.
5. The website reads the newest release from this repository's GitHub API on
   load. The home-page version, download buttons and versions page update
   automatically when the release appears. The total-download line and the
   README badge read the same public asset counts, so neither needs editing.
   No site edit or redeploy is needed for a new release.

Without Apple Developer ID secrets the build remains ad-hoc signed and users
approve it once in **System Settings → Privacy & Security → Open Anyway**. With
all six Apple secrets set, the workflow signs, notarizes and staples the app.

## Website

`public-repo/` is the static website build. Vercel deploys that folder from the
main branch of this repository. After changing the site:

```bash
bash scripts/sync-public-repo.sh
bash scripts/check-public-repo.sh
```

Commit `public-repo/` with the source change. The Vercel project's root
directory is `public-repo`.

## Updater

The updater endpoint in `src-tauri/tauri.conf.json` and the generated
`latest.json` point at releases in **AnwarKalonov/Lantas**. The signing key
remains in the repository's Actions secrets:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` when the key has a password

Never commit the private key, a token or a signed bundle.

## Licence

The repository is public but the code is source-available under the **Lantas
License 1.0**, not an open-source licence. See `LICENSE` and `NOTICE`.
