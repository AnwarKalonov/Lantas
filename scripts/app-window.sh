#!/usr/bin/env bash
# Start Lantas (or reuse a running instance) and open a window for it.
#
#   npm start
#   PORT=1700 npm start     # if 3000 is taken
#
# No Rust toolchain required. On macOS this opens a chromeless Chrome/Edge
# window; on a headless box it prints the URL so the preview panel can show it.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

PORT="${PORT:-3000}"
URL="http://localhost:${PORT}"
mkdir -p .logs

is_up() {
  curl -fsS -o /dev/null --max-time 2 "$URL" 2>/dev/null
}

started=0

if is_up; then
  echo "Lantas is already running at ${URL}"
else
  echo "Starting Lantas on ${URL} ..."
  npx vite --port "$PORT" --strictPort > .logs/app.log 2>&1 &
  echo $! > .app.pid
  started=1
  for _ in $(seq 1 80); do
    is_up && break
    sleep 0.25
  done
  if ! is_up; then
    echo "Lantas did not start on port ${PORT}."
    tail -n 12 .logs/app.log
    echo "If the port is busy, pick another: PORT=1700 npm start"
    exit 1
  fi
fi

if [ "$(uname -s)" = "Darwin" ]; then
  for app in "Google Chrome" "Microsoft Edge" "Brave Browser" "Chromium" "Arc"; do
    if [ -d "/Applications/${app}.app" ]; then
      open -na "${app}" --args --app="${URL}" --window-size=1360,900
      exit 0
    fi
  done
  open "$URL"
  exit 0
fi

if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] && command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 && exit 0
fi

echo "Open ${URL} in the Browser panel, or in any browser."
if [ "$started" = "1" ]; then
  echo "(dev server left running with hot reload; stop it with: kill \$(cat .app.pid))"
fi
