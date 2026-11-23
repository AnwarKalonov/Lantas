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
  *":$BIN:"*) printf '  Run: lantas setup\n\n' ;;
  *)
    printf '  Add the folder to PATH, then run lantas setup:\n\n'
    printf '    echo '\''export PATH="%s:$PATH"'\'' >> ~/.zshrc\n' "$BIN"
    printf '    source ~/.zshrc\n\n'
    ;;
esac
