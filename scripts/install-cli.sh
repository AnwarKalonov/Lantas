#!/usr/bin/env bash
# Put the Lantas CLI on PATH without npm or a build step.
#
#   bash scripts/install-cli.sh
#   lantas            # opens in its own Terminal window, in this folder
#   lantas --here     # runs in the terminal you are already in
#
# Files go to ~/.local/share/lantas and the `lantas` command to ~/.local/bin.
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

# The command is a launcher, not the script itself: `lantas` should open a
# terminal window of its own the way a coding agent is normally started, and
# `lantas --here` should stay in the shell for scripts and pipelines.
cat > "$BIN/lantas" <<'LAUNCHER'
#!/bin/bash
# lantas — the coding agent, in its own terminal window.
set -euo pipefail

BIN_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB_DIR="$BIN_DIR/../share/lantas"
[ -f "$LIB_DIR/lantas.mjs" ] || LIB_DIR="$BIN_DIR"

HERE=0
ARGS=()
for arg in "$@"; do
  if [ "$arg" = "--here" ]; then
    HERE=1
  else
    ARGS+=("$arg")
  fi
done

run_here() {
  exec node "$LIB_DIR/lantas.mjs" ${ARGS[@]+"${ARGS[@]}"}
}

if [ "$HERE" = "1" ] || [ "${LANTAS_NO_WINDOW:-}" = "1" ]; then
  run_here
fi

# No macOS, no Terminal, or no keyboard in front of us: stay in this shell.
if [ "$(uname)" != "Darwin" ] || ! command -v osascript >/dev/null 2>&1 || [ ! -t 0 ]; then
  run_here
fi

# A .command file opened with Terminal.app gets its own window, already in the
# folder the user ran the command from, so the agent starts where they are.
SCRIPT="$(mktemp "${TMPDIR:-/tmp}/lantas-XXXXXX.command")"
{
  printf '#!/bin/bash\n'
  printf 'cd %q || exit 1\n' "$PWD"
  printf 'export LANTAS_NO_WINDOW=1\n'
  printf 'exec node %q' "$LIB_DIR/lantas.mjs"
  for arg in ${ARGS[@]+"${ARGS[@]}"}; do
    printf ' %q' "$arg"
  done
  printf '\n'
} > "$SCRIPT"
chmod +x "$SCRIPT"

exec open -a Terminal "$SCRIPT"
LAUNCHER
chmod +x "$BIN/lantas"

printf '\n  Lantas CLI installed\n\n'
printf '    %s\n' "$BIN/lantas"
printf '    config: ~/.lantas/config.json\n\n'

case ":$PATH:" in
  *":$BIN:"*)
    printf '  Run: lantas\n\n'
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
      printf '    lantas           # a new terminal window, in this folder\n'
      printf '    lantas --here    # stay in this terminal\n'
      printf '    lantas setup     # connect a model once\n\n'
    fi
    ;;
esac
