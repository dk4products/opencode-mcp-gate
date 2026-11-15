#!/usr/bin/env bash
# Installs the opencode MCP gate plugin for the current user (macOS / Linux).
# Safe to re-run: it backs up any existing copy and overwrites it.
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SRC_DIR/plugin/mcp-gate.js"
CONF_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
DEST_DIR="$CONF_DIR/plugins"
DEST="$DEST_DIR/mcp-gate.js"

say() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[ -f "$SRC" ] || die "plugin file not found: $SRC"
command -v opencode >/dev/null 2>&1 || say "WARNING: 'opencode' not found on PATH. Installing the plugin anyway."
command -v node >/dev/null 2>&1 && node --check "$SRC" || say "NOTE: node not found, skipping syntax check."

mkdir -p "$DEST_DIR"

if [ -f "$DEST" ]; then
  if cmp -s "$SRC" "$DEST"; then
    say "Plugin already up to date: $DEST"
  else
    BAK="$DEST.bak.$(date +%Y%m%d%H%M%S)"
    cp "$DEST" "$BAK"
    say "Existing plugin backed up to: $BAK"
  fi
fi
cp "$SRC" "$DEST"
say "Installed: $DEST"

# The plugin imports '@opencode-ai/plugin'. It normally already exists in the
# opencode config directory; install it only if missing.
if [ ! -d "$CONF_DIR/node_modules/@opencode-ai/plugin" ]; then
  say "Dependency @opencode-ai/plugin not found in $CONF_DIR/node_modules."
  if command -v npm >/dev/null 2>&1; then
    say "Installing it with npm (inside $CONF_DIR)..."
    (cd "$CONF_DIR" && npm install --no-audit --no-fund @opencode-ai/plugin) \
      || say "WARNING: npm install failed. Run it manually in $CONF_DIR if the plugin does not load."
  else
    say "WARNING: npm not found. Install Node.js, then run: cd $CONF_DIR && npm install @opencode-ai/plugin"
  fi
fi

say ""
say "Done. Fully quit and restart opencode, then start a NEW session."
say "You should be asked which MCP servers to enable before anything else runs."
say "Disable temporarily with: OPENCODE_MCP_GATE=off opencode"
