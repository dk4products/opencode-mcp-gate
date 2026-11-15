#!/usr/bin/env node
// opencode-mcp-gate installer. Usage:
//   npx github:dk4products/opencode-mcp-gate [install|uninstall|status] [--dir <path>]
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const cmd = args.find((a) => !a.startsWith("-") && a !== flag("--dir")) || "install";

if (args.includes("-h") || args.includes("--help") || cmd === "help") {
  console.log(`opencode-mcp-gate

Usage: opencode-mcp-gate [install|uninstall|status] [--dir <opencode config dir>]

  install    copy the plugin into <config dir>/plugins (default)
  uninstall  remove the plugin and its saved selection
  status     show whether the plugin is installed and up to date

Config dir defaults to $OPENCODE_CONFIG_DIR or ~/.config/opencode.`);
  process.exit(0);
}

const confDir = path.resolve(flag("--dir") || process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), ".config", "opencode"));
const src = path.join(__dirname, "..", "plugin", "mcp-gate.js");
const destDir = path.join(confDir, "plugins");
const dest = path.join(destDir, "mcp-gate.js");
const state = path.join(confDir, ".mcp-gate-state.json");
const same = (a, b) => fs.existsSync(a) && fs.existsSync(b) && fs.readFileSync(a).equals(fs.readFileSync(b));
const stamp = () => new Date().toISOString().replace(/\D/g, "").slice(0, 14);

function install() {
  if (!fs.existsSync(src)) throw new Error(`plugin file missing from package: ${src}`);
  const oc = spawnSync("opencode", ["--version"], { encoding: "utf8", shell: process.platform === "win32" });
  if (oc.error || oc.status !== 0) console.log("WARNING: 'opencode' not found on PATH. Installing the plugin anyway.");
  else console.log(`opencode ${oc.stdout.trim()} detected`);

  fs.mkdirSync(destDir, { recursive: true });
  if (fs.existsSync(dest) && !same(src, dest)) {
    const bak = `${dest}.bak.${stamp()}`;
    fs.copyFileSync(dest, bak);
    console.log(`Existing plugin backed up to: ${bak}`);
  }
  if (same(src, dest)) console.log(`Plugin already up to date: ${dest}`);
  fs.copyFileSync(src, dest);
  console.log(`Installed: ${dest}`);

  if (!fs.existsSync(path.join(confDir, "node_modules", "@opencode-ai", "plugin"))) {
    console.log(`Dependency @opencode-ai/plugin not found in ${confDir}/node_modules; installing with npm...`);
    const r = spawnSync("npm", ["install", "--no-audit", "--no-fund", "@opencode-ai/plugin"], {
      cwd: confDir,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (r.error || r.status !== 0) console.log(`WARNING: npm install failed. Run it manually in ${confDir} if the plugin does not load.`);
  }

  console.log("\nDone. Fully quit and restart opencode, then start a NEW session.");
  console.log("You should be asked which MCP servers to enable before anything else runs.");
  console.log("Disable temporarily with: OPENCODE_MCP_GATE=off opencode");
}

function uninstall() {
  let removed = false;
  for (const f of [dest, state]) {
    if (fs.existsSync(f)) {
      fs.rmSync(f);
      console.log(`Removed: ${f}`);
      removed = true;
    }
  }
  console.log(removed ? "Restart opencode to finish." : "Nothing to remove.");
}

function status() {
  console.log(`Config dir: ${confDir}`);
  if (!fs.existsSync(dest)) return console.log("Plugin: not installed");
  console.log(`Plugin: installed (${same(src, dest) ? "up to date" : "differs from this package version"})`);
  console.log(`Dependency @opencode-ai/plugin: ${fs.existsSync(path.join(confDir, "node_modules", "@opencode-ai", "plugin")) ? "present" : "MISSING"}`);
  if (fs.existsSync(state)) console.log(`Saved selection: ${fs.readFileSync(state, "utf8").replace(/\s+/g, " ")}`);
}

try {
  if (cmd === "install") install();
  else if (cmd === "uninstall") uninstall();
  else if (cmd === "status") status();
  else {
    console.error(`Unknown command: ${cmd}. Try --help.`);
    process.exit(2);
  }
} catch (e) {
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
}
