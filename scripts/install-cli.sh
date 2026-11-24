#!/usr/bin/env bash
# Put the terminal app on PATH without npm or a build step.
#
#   bash scripts/install-cli.sh
#   lantas
#
# Files go to ~/.local/share/lantas and a symlink goes to ~/.local/bin/lantas.
# Override those roots with LANTAS_PREFIX (the parent of bin/ and share/).
# No sudo, no global npm install, no dependencies beyond Node 18+.

set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "Lantas needs Node 18 or newer. Install it from https://nodejs.org and run this again." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Lantas needs Node 18 or newer; this is $(node -v)." >&2
  exit 1
fi

PREFIX="${LANTAS_PREFIX:-$HOME/.local}"
LIB="$PREFIX/share/lantas"
BIN="$PREFIX/bin"

mkdir -p "$LIB" "$BIN"
cp cli/lantas.mjs cli/logo.mjs "$LIB/"
chmod +x "$LIB/lantas.mjs"
ln -sf "$LIB/lantas.mjs" "$BIN/lantas"

printf '\n  Lantas CLI installed\n\n'
printf '    %s\n' "$BIN/lantas"
printf '    config: ~/.lantas/config.json\n\n'

case ":$PATH:" in
  *":$BIN:"*)
    printf '  Run: lantas setup\n\n'
    ;;
  *)
    # Pick the file the user's login shell actually reads, add the folder once,
    # and stay silent on later installs.
    SHELL_NAME="$(basename "${SHELL:-/bin/zsh}")"
    case "$SHELL_NAME" in
      bash) RC="$HOME/.bashrc" ;;
      *)    RC="$HOME/.zshrc" ;;
    esac
    LINE="export PATH=\"$BIN:\$PATH\""
    if [ -f "$RC" ] && grep -Fq "$BIN" "$RC" 2>/dev/null; then
      printf '  %s is already on PATH in %s.\n\n' "$BIN" "$RC"
    else
      printf '\n# Lantas CLI\n%s\n' "$LINE" >> "$RC"
      printf '  Added %s to PATH in %s\n\n' "$BIN" "$RC"
    fi
    if [ -x "$BIN/lantas" ]; then
      printf '  Open a new terminal (or run: source %s), then:\n\n' "$RC"
      printf '    lantas setup     # connect a model once\n'
      printf '    lantas           # start a session in the current folder\n\n'
    fi
    ;;
esac
