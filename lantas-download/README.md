# lantas-download

A one-button page for the developer build of Lantas. It is deliberately plain:
one card, one download button, no framework.

## Run it

```bash
cd lantas-download
npm install
npm run dev
```

Open the address Vite prints and enter the developer key. The key is checked
against a SHA-256 hash, so it never appears in the source or the bundle. The
default key was given to you in chat; to change it:

```bash
printf '%s' 'your new key' | shasum -a 256
```

Copy `.env.example` to `.env`, paste the hash into `VITE_DEV_KEY_HASH`, and
rebuild. Without a `.env` the built-in default is used.

`?key=<the key>` also unlocks the page, then the key is removed from the
address bar and remembered for that browser. **Lock this page** forgets it.

## Publishing a new build

Everything the page shows comes from `public/build.json`:

```json
{
  "label": "Lantas 1.3.0 development build",
  "dev": true,
  "builtAt": "2026-11-26T18:20:00Z",
  "url": "https://github.com/AnwarKalonov/Lantas/releases/download/dev-latest/Lantas-1.3.0-arm64.dmg",
  "size": 20971520,
  "sha256": "…",
  "changes": [
    "Browser: the agent can run page scripts and take screenshots.",
    "Code: prompts carry the open file, selection and diagnostics."
  ]
}
```

Replace that file and redeploy. No code changes are needed. `size` and
`sha256` are optional. A `url` that is not `https://` is refused rather than
rendered as a link.

## What the key does and does not do

This is a static page. The key hides the page from anyone who does not have it,
and `noindex` keeps search engines away, but a static host cannot stop someone
who already has the file's URL from fetching it. If the download itself must be
private, put the file behind something that checks the visitor:

- host-level access control (Vercel deployment protection, or a Freebuff Sites
  page with Sign in with Freebuff), or
- private storage that issues short-lived signed links (R2/S3), with the page
  asking a small server function for one.

The page's only job is to point at `build.json.url`, so either arrangement works
without changing the UI.
