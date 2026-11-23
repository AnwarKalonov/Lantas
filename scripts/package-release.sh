#!/usr/bin/env bash
# Turn a finished `tauri build` into the files the public release needs.
#
#   bash scripts/package-release.sh
#
# Everything lands in release-assets/:
#
#   Lantas-<version>-arm64.dmg        drag to Applications
#   Lantas-<version>-arm64.app.zip    for people who unzip by hand
#   Lantas.app.tar.gz                 the updater bundle (signed app inside)
#   Lantas.app.tar.gz.sig             its minisign signature
#   chrome-extension.zip              the browser extension
#   latest.json                       the manifest the app reads
#
# Signing needs TAURI_SIGNING_PRIVATE_KEY (+ password) in the environment.
# Without it the archives are still produced; the updater ones are skipped.

set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
BUNDLE="src-tauri/target/release/bundle"
APP="$BUNDLE/macos/Lantas.app"
OUT="release-assets"

[ -d "$APP" ] || { echo "no app bundle at $APP — run the build first"; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT"

DMG="$(ls "$BUNDLE"/dmg/*.dmg 2>/dev/null | head -1 || true)"
if [ -n "$DMG" ]; then
  cp "$DMG" "$OUT/Lantas-$VERSION-arm64.dmg"
  echo "dmg      $(basename "$DMG") -> Lantas-$VERSION-arm64.dmg"
else
  echo "::warning::no dmg in $BUNDLE/dmg"
fi

# The zip is built from the app we just signed, not from an earlier copy.
COPYFILE_DISABLE=1 ditto -c -k --keepParent "$APP" "$OUT/Lantas-$VERSION-arm64.app.zip"
echo "app      Lantas-$VERSION-arm64.app.zip"

if [ -d chrome-extension ]; then
  (cd chrome-extension && zip -qr "../$OUT/chrome-extension.zip" . -x '.*' -x '*/.*')
  echo "ext      chrome-extension.zip"
fi

if [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  # Rebuilt here on purpose: the archive must contain the ad-hoc signed app, and
  # the signature must cover the bytes we upload.
  COPYFILE_DISABLE=1 tar -czf "$OUT/Lantas.app.tar.gz" -C "$BUNDLE/macos" Lantas.app
  # --app-version binds the signature to this version, which lets the updater be
  # configured to reject a replayed older bundle later on.
  npx tauri signer sign --app-version "$VERSION" "$OUT/Lantas.app.tar.gz"
  echo "updater  Lantas.app.tar.gz + .sig"

  LANTAS_NOTES="${LANTAS_NOTES:-Lantas $VERSION}" node scripts/latest-json.mjs "$OUT/latest.json"
else
  echo "::warning title=Unsigned build::TAURI_SIGNING_PRIVATE_KEY is not set, so no updater bundle or latest.json was produced."
fi

ls -la "$OUT"
