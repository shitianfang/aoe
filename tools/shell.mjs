/**
 * Package AOE as a shell around a hosted instance.
 *
 * The normal `dist:*` scripts build a client that hosts its own bridge and
 * daemon. This one builds a client that hosts nothing: it opens a URL, and the
 * renderer resolves /bridge and /api against that origin exactly as the dev
 * browser does. Everything — the runtime, the workspaces, the API keys — lives
 * on the host; the app is a window onto it.
 *
 *   node tools/shell.mjs --url https://host.example --win --mac --linux
 *
 * The URL is written to electron/remote.json, which main.cjs reads and
 * electron-builder packages. AOE_REMOTE_URL overrides it at run time, so one
 * build can be pointed elsewhere without repackaging.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);

const flag = (name) => argv.includes(`--${name}`);
const value = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const url = value("url");
if (!url || !/^https?:\/\//.test(url)) {
  console.error("shell: --url <http(s)://host> is required");
  process.exit(1);
}

// No platform named builds for the one you are on, which is what you want
// while checking the packaging works at all.
const targets = ["win", "mac", "linux"].filter(flag);
if (targets.length === 0) targets.push({ win32: "win", darwin: "mac" }[process.platform] ?? "linux");

// A trailing slash would make every same-origin check compare against a URL
// the host never actually serves.
const clean = url.replace(/\/+$/, "");
fs.writeFileSync(
  path.join(ROOT, "electron", "remote.json"),
  `${JSON.stringify({ url: clean }, null, 2)}\n`,
);
console.log(`shell: pointing at ${clean}`);

// The renderer is served by the host, not by this bundle — there is nothing to
// compile here. dist/ still ships because electron-builder's file list names
// it; it is never loaded in this mode.
const args = ["electron-builder", ...targets.map((t) => `--${t}`), "--publish", "never"];
console.log(`shell: npx ${args.join(" ")}`);
const r = spawnSync("npx", args, { cwd: ROOT, stdio: "inherit" });
process.exit(r.status ?? 1);
