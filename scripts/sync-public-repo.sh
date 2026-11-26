#!/usr/bin/env bash
# Copy the site into public-repo/ without touching the repository's README,
# licence or .nojekyll. public-repo/ is the static folder Vercel deploys; it
# never contains source code, scripts or git history.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v rsync >/dev/null || { echo "rsync is required"; exit 1; }
rsync -a --delete \
  --exclude README.md \
  --exclude LICENSE \
  --exclude .nojekyll \
  --exclude .DS_Store \
  Website/site/ public-repo/
echo "public-repo/ synced from Website/site/"
echo "Next: commit public-repo/ to the main Lantas repository."
