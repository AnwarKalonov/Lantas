#!/bin/bash
# Double-click this file in Finder to build and install the native Lantas app.
# It runs in macOS Terminal, so it does not matter which shell you use elsewhere.
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

if [ "$(uname -s)" != "Darwin" ]; then
  say "Finder would run this on your Mac. This shell reports $(uname -s) instead."
  say "Open Terminal on the Mac, then run: bash scripts/build-mac.sh"
  read -r -p "Press Return to close..." _
  exit 1
fi

say "Building the real Lantas app."
printf 'The first build compiles Rust and takes 5-10 minutes. Later builds are quick.\n'

if bash scripts/build-mac.sh; then
  say "Lantas.app is installed in /Applications."
else
  say "The build stopped. The reason is printed above."
  read -r -p "Press Return to close..." _
  exit 1
fi

read -r -p "Press Return to close..." _
