#!/bin/bash
# One-shot native build: produces Lantas.app and installs it in /Applications.
# Must run on macOS. Safe to run again — it only rebuilds.
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

if [ "$(uname -s)" != "Darwin" ]; then
  say "This builds a Mac app, so it has to run on macOS."
  say "This shell reports $(uname -s) — a container or remote shell, not the Mac."
  say "Double-click \"Build Lantas.app.command\" in Finder instead,"
  say "or open Terminal on the Mac and run: bash scripts/build-mac.sh"
  exit 1
fi

if ! xcode-select -p >/dev/null 2>&1; then
  say "Installing Xcode Command Line Tools. A dialog will appear — click Install."
  xcode-select --install >/dev/null 2>&1 || true
  say "When that finishes, run this script again: bash scripts/build-mac.sh"
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  if [ -f "$HOME/.cargo/env" ]; then
    # shellcheck disable=SC1091
    . "$HOME/.cargo/env"
  else
    say "Installing Rust (one time, unattended)..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    # shellcheck disable=SC1091
    . "$HOME/.cargo/env"
  fi
fi

say "Installing app dependencies..."
npm install --no-audit --no-fund

say "Building Lantas (first run compiles Rust, 5-10 minutes)..."
npm run tauri build

APP="src-tauri/target/release/bundle/macos/Lantas.app"
if [ ! -d "$APP" ]; then
  say "Build finished but $APP was not found. Check the output above."
  exit 1
fi

# The extension is a bundle resource (tauri.conf.json), so it is already inside
# the signed app. Copying it here would break the signature.

say "Installing to /Applications..."
rm -rf "/Applications/Lantas.app"
if cp -R "$APP" "/Applications/" 2>/dev/null; then
  xattr -dr com.apple.quarantine "/Applications/Lantas.app" 2>/dev/null || true
  say "Done. Opening Lantas from /Applications."
  open "/Applications/Lantas.app"
else
  say "Could not write to /Applications. The app is here:"
  say "  $(pwd)/$APP"
  open "$(pwd)/$APP" || true
fi
