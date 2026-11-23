#!/usr/bin/env bash
# Copy the site into public-repo/ without touching the repository's README,
# licence or .nojekyll. public-repo/ is what gets pushed to the public
# download repository; it never contains source code, scripts or git history.
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
echo "Next: see PUBLISH.md for the upload steps."
