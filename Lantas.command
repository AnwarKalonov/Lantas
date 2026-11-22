#!/bin/bash
# Double-click this file in Finder to open Lantas.
# First run installs dependencies; later runs just open the window.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-3000}"
URL="http://127.0.0.1:$PORT/"
LOG="/tmp/lantas.log"

say() { printf '\n%s\n' "$*"; }

if [ "$(uname -s)" != "Darwin" ]; then
  say "This launcher is for macOS. On other systems run: npm start"
  read -r -p "Press Return to close..." _
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  say "Lantas needs Node.js — a one-time install."
  say "Install the LTS package from the page that just opened, then double-click this file again."
  open "https://nodejs.org/en/download"
  read -r -p "Press Return to close..." _
  exit 1
fi

if [ ! -d node_modules ]; then
  say "First run: installing dependencies (one or two minutes)..."
  npm install --no-audit --no-fund
fi

if curl -fsS "$URL" >/dev/null 2>&1; then
  say "Lantas is already running — opening it."
else
  say "Starting Lantas..."
  npm run dev -- --port "$PORT" >"$LOG" 2>&1 &
  SERVER_PID=$!
  trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

  ready=""
  for _ in $(seq 1 80); do
    if curl -fsS "$URL" >/dev/null 2>&1; then ready="yes"; break; fi
    sleep 0.5
  done
  if [ -z "$ready" ]; then
    say "Lantas did not start. Last lines of $LOG:"
    tail -20 "$LOG" || true
    read -r -p "Press Return to close..." _
    exit 1
  fi
fi

opened=""
for name in "Google Chrome" "Microsoft Edge" "Brave Browser" "Chromium"; do
  if [ -d "/Applications/$name.app" ]; then
    open -na "$name" --args --app="$URL" --window-size=1320,860
    opened="yes"
    break
  fi
done
if [ -z "$opened" ]; then
  open "$URL"
  say "Tip: install Chrome for a chrome-less window like the screenshots."
fi

say "Lantas is running at $URL"
say "Keep this window open while you use it. Close it to quit."
wait "${SERVER_PID:-}" 2>/dev/null || true
