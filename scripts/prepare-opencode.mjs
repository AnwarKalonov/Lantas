#!/usr/bin/env node
/**
 * Copies the OpenCode server binary into Tauri's sidecar slot.
 *
 * The binary is a devDependency (`opencode-ai` pulls the package for the build
 * machine). Tauri bundles `src-tauri/binaries/opencode-<target-triple>` as an
 * external binary, and the app starts `opencode serve` from that copy. The copy
 * is intentionally not committed: it is ~200 MB and rebuilt with npm ci.
 */
import { copyFileSync, chmodSync, existsSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, "..");

const targetArg = process.argv.find((arg) => arg.startsWith("--target="))?.split("=")[1];
const platform = process.platform;
const arch = process.arch;

const platformPackage = {
  darwin: { arm64: "opencode-darwin-arm64", x64: "opencode-darwin-x64" },
  linux: { arm64: "opencode-linux-arm64", x64: "opencode-linux-x64" },
  win32: { arm64: "opencode-windows-arm64", x64: "opencode-windows-x64" },
}[platform]?.[arch];

const triple =
  targetArg ||
  {
    "darwin-arm64": "aarch64-apple-darwin",
    "darwin-x64": "x86_64-apple-darwin",
    "linux-arm64": "aarch64-unknown-linux-gnu",
    "linux-x64": "x86_64-unknown-linux-gnu",
    "win32-arm64": "aarch64-pc-windows-msvc",
    "win32-x64": "x86_64-pc-windows-msvc",
  }[`${platform}-${arch}`];

if (!platformPackage || !triple) {
  console.error(`OpenCode does not ship a binary for ${platform}/${arch}.`);
  process.exit(1);
}

/** npm may hoist the platform package, or nest it under opencode-ai. */
function findBinary() {
  const candidates = [];
  const add = (dir) => candidates.push(join(dir, platformPackage, "bin", "opencode"));
  const addNested = (dir) => candidates.push(join(dir, "node_modules", platformPackage, "bin", "opencode"));

  add(join(project, "node_modules"));
  addNested(project);
  try {
    const ai = dirname(require.resolve("opencode-ai/package.json"));
    addNested(ai);
    add(dirname(ai));
  } catch {
    // reported below
  }

  return candidates.find((path) => existsSync(path));
}

const source = findBinary();
if (!source) {
  console.error(
    `Could not find ${platformPackage}. Run \`npm ci\` first so OpenCode's binary is installed.`,
  );
  process.exit(1);
}

const binaryName = platform === "win32" ? `opencode-${triple}.exe` : `opencode-${triple}`;
const outDir = join(project, "src-tauri", "binaries");
const destination = join(outDir, binaryName);
mkdirSync(outDir, { recursive: true });
copyFileSync(source, destination);
if (platform !== "win32") chmodSync(destination, 0o755);

const size = Math.round(statSync(destination).size / (1024 * 1024));
console.log(`OpenCode ${triple}: ${destination} (${size} MB)`);
