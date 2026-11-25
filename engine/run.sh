#!/usr/bin/env bash
# Start the Lantas browser engine (browser-use, MIT) for this machine.
#
#   bash engine/run.sh              headless, port 8765
#   LANTAS_ENGINE_HEADLESS=0 ...    show the browser window
#
# The first run creates engine/.venv and installs browser-use into it. The venv
# is disposable: delete it and run again to reinstall.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
venv="$here/.venv"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required. Install it from python.org, then run this again." >&2
  exit 1
fi

if [ ! -x "$venv/bin/python" ]; then
  echo "Creating $venv ..."
  python3 -m venv "$venv"
fi

if ! "$venv/bin/python" -c "import browser_use" >/dev/null 2>&1; then
  echo "Installing browser-use ..."
  "$venv/bin/pip" install --quiet --upgrade pip
  "$venv/bin/pip" install --quiet browser-use
fi

exec "$venv/bin/python" "$here/browser_engine.py"
