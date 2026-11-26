# Lantas website

Source for the public Lantas site and download pages. The app source lives in the
same public `AnwarKalonov/Lantas` repository; this folder contains the static site.

## Files

```
site/                the published site
  index.html         home page
  docs.html          user guide
  download.html      download and install steps
  versions.html      release list, read from latest.json at runtime
  privacy.html       privacy policy: what leaves the Mac, and when
  terms.html         terms of use, including the Lantas License 1.0
  assets/site.css    the light/dark design
  assets/site.js     theme, copy buttons, scrubbed sections, reveals
  assets/img/        product screenshots and site art
public-repo/         generated static build deployed by Vercel
```

`index.html`, `docs.html` and `download.html` link to release downloads at
`github.com/AnwarKalonov/Lantas`. The version shown on the site is a pinned
fallback; `assets/site.js` rewrites the version and links from the GitHub API on
load, so the pinned URLs only matter when the API is unreachable.

Every page ends with the same footer: Docs, Download, Versions, GitHub,
Chrome extension, Privacy, Terms. Add legal pages there, not in the top nav.

**Legal pages are the source of truth for the public.** `privacy.html` and
`terms.html` ship with the site; the licence text lives in the root `LICENSE`,
is summarised on `terms.html`, and is copied unchanged to `public-repo/LICENSE`.
Keep the three in step when the terms change.

## Preview

The pages are plain HTML, CSS and JavaScript. Serve the folder over HTTP so the
release feed and clipboard buttons work:

```bash
cd Website/site
python3 -m http.server 8080
# open http://localhost:8080
```

## Publish

`public-repo/` is the static build Vercel deploys from the main branch. It
contains no app source, no build tooling and no private git history.

```bash
bash scripts/sync-public-repo.sh
bash scripts/check-public-repo.sh
git add -A && git commit -m "Update the Lantas site" && git push
```

The Vercel project's root directory is `public-repo`. A new GitHub release is
picked up by the site's release feed without a redeploy. See `PUBLISH.md` for
signing, releases and updater details.

## Screenshots

The screenshots in `site/assets/img/app-*.png` are captured from the running app
and are also used by the root README. Replace them when the UI changes; do not
add drawings labelled as screenshots.

Keep the public repo free of:

- `src/`, `src-tauri/`, `cli/`, `scripts/` or `chrome-extension/` source
- private keys, tokens, `.env` files or signed bundles
- wording that promises source access or a source-build path
