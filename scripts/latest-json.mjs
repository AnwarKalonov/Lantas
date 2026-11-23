/**
 * Writes the updater manifest the app reads.
 *
 * Tauri's updater asks one URL for `latest.json`, compares `version` with the
 * running app, and — if the manifest names a newer one — downloads `url`, checks
 * it against `signature`, and installs it. The signature is the content of the
 * `.sig` file produced by `tauri signer sign`, not a path.
 *
 *   node scripts/latest-json.mjs [outfile]
 *
 * Environment:
 *   LANTAS_RELEASES_REPO  owner/repo that holds the release (default below)
 *   LANTAS_TAG            release tag (default v<version>)
 *   LANTAS_NOTES          short release notes shown in the app
 *   LANTAS_ARCH           aarch64 (default) or x86_64
 *   LANTAS_SIG_FILE       path to the .sig (default: the bundle Tauri wrote)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const out = resolve(root, process.argv[2] || "latest.json");

const config = JSON.parse(readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"));
const version = String(config.version || "").replace(/^v/i, "");
if (!version) {
  console.error("tauri.conf.json has no version");
  process.exit(1);
}

const repo = process.env.LANTAS_RELEASES_REPO || "AnwarKalonov/Lantas-download";
const tag = process.env.LANTAS_TAG || `v${version}`;
const notes = process.env.LANTAS_NOTES || `Lantas ${version}`;
const arch = process.env.LANTAS_ARCH || "aarch64";
const sigFile =
  process.env.LANTAS_SIG_FILE ||
  resolve(root, "release-assets/Lantas.app.tar.gz.sig");

const signature = readFileSync(sigFile, "utf8").trim();
if (!signature) {
  console.error(`Empty signature at ${sigFile}`);
  process.exit(1);
}

const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    [`darwin-${arch}`]: {
      signature,
      url: `https://github.com/${repo}/releases/download/${tag}/Lantas.app.tar.gz`,
    },
  },
};

writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${out} — darwin-${arch} ${version} from ${tag}`);
