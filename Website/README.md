# Lantas website

Source for the public Lantas site and download pages. The app source lives in the
private `Lantas` repository; this folder only contains the static site.

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
public-repo/         generated copy uploaded to Lantas-download
```

`index.html`, `docs.html` and `download.html` link to release downloads at
`github.com/AnwarKalonov/Lantas-download`. The version shown on the site is
**1.0.6**; update the copy and the pinned fallback links together when a new
build ships. `assets/site.js` still rewrites those links from the GitHub API on
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

`public-repo/` is the only thing that goes to the public repository. It contains
no app source, no build tooling and no private git history.

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

GitHub Pages serves `Lantas-download` from `main` at the repository root. See
`PUBLISH.md` in the private repository for signing, releases and updater details.

## Screenshots

The screenshots in `site/assets/img/app-*.png` are captured from the running app
and are also used by the root README. Replace them when the UI changes; do not
add drawings labelled as screenshots.

Keep the public repo free of:

- `src/`, `src-tauri/`, `cli/`, `scripts/` or `chrome-extension/` source
- private keys, tokens, `.env` files or signed bundles
- wording that promises source access or a source-build path
