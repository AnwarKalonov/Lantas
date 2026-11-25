#!/usr/bin/env bash
# Guard the public surface. Runs on public-repo/, which is the only folder that
# is ever pushed to the download repository. It fails on application source,
# build tooling, secrets and local links that point at files that do not exist.
set -euo pipefail
cd "$(dirname "$0")/.."

PUBLIC="public-repo"
fail=0
note() { printf '  %s\n' "$*"; }
bad() { printf 'FAIL  %s\n' "$*"; fail=1; }

[ -d "$PUBLIC" ] || { echo "No $PUBLIC/ directory"; exit 1; }

echo "Required pages and files"
for f in index.html docs.html download.html versions.html privacy.html terms.html \
         README.md LICENSE .nojekyll install.sh assets/site.css assets/site.js assets/versions.js; do
  if [ -f "$PUBLIC/$f" ]; then note "ok   $f"; else bad "missing $f"; fi
done

echo "No application source or build tooling"
for pattern in '*.tsx' '*.ts' '*.rs' '*.toml' '*.lock' 'package.json' 'Cargo.toml' 'tsconfig.json'; do
  found=$(find "$PUBLIC" -name "$pattern" -print -quit)
  [ -z "$found" ] && note "ok   no $pattern" || bad "found $found"
done
for dir in node_modules .git src src-tauri Website chrome-extension cli; do
  [ -e "$PUBLIC/$dir" ] && bad "found directory $dir" || true
done

echo "No secrets or private paths"
# Look at text files only, and never print the matching line: a match would be
# the secret itself.
if grep -rIlE 'TAURI_SIGNING_PRIVATE_KEY|-----BEGIN [A-Z ]*PRIVATE KEY|gh[pousr]_[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|ANTHROPIC_API_KEY=|OPENAI_API_KEY=' "$PUBLIC" >/dev/null 2>&1; then
  bad "a secret-shaped value appears in public-repo"
else
  note "ok   no secret-shaped values"
fi
# Prose may name node_modules (the docs explain what the file tree skips), so
# match paths with a slash, not the bare word.
if grep -rIlE 'src-tauri/|src/lib/|/Website/|node_modules/|LANTAS_RELEASE_TOKEN|\.git/' "$PUBLIC" >/dev/null 2>&1; then
  bad "a private path or token name appears in public-repo"
else
  note "ok   no private paths"
fi
if grep -rIlE 'github\.com/AnwarKalonov/Lantas([^a-z-]|$)' "$PUBLIC" >/dev/null 2>&1; then
  bad "a link points at the private application repository"
else
  note "ok   no links to the application repository"
fi

echo "Local links resolve"
python3 - "$PUBLIC" <<'PY' || fail=1
import re, sys
from pathlib import Path
root = Path(sys.argv[1])
missing = []
for page in sorted(root.glob("*.html")):
    text = page.read_text()
    for href in re.findall(r'href="([^"#][^"]*)"', text):
        if href.startswith(("http://", "https://", "mailto:", "data:")):
            continue
        target = href.split("?")[0].split("#")[0]
        if not target:
            continue
        if not (page.parent / target).exists():
            missing.append(f"{page.name} -> {href}")
    for src in re.findall(r'src="([^"]+)"', text):
        if src.startswith(("http://", "https://", "data:")):
            continue
        if not (page.parent / src).exists():
            missing.append(f"{page.name} -> {src}")
if missing:
    for item in missing:
        print(f"FAIL  broken local link {item}")
    sys.exit(1)
print("  ok   every local link resolves")
PY

echo "Legal pages are linked from every page"
for page in "$PUBLIC"/*.html; do
  name=$(basename "$page")
  if grep -q 'href="privacy.html"' "$page" && grep -q 'href="terms.html"' "$page"; then
    note "ok   $name links privacy and terms"
  else
    bad "$name does not link privacy and terms"
  fi
done

echo
if [ "$fail" -ne 0 ]; then
  echo "public-repo/ is not safe to publish yet."
  exit 1
fi
echo "public-repo/ is clean: static pages, licence and assets only."
