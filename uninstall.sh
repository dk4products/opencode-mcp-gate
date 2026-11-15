#!/usr/bin/env bash
# Removes the opencode MCP gate plugin and its saved selection.
set -euo pipefail

CONF_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
removed=0
for f in "$CONF_DIR/plugins/mcp-gate.js" "$CONF_DIR/.mcp-gate-state.json"; do
  if [ -f "$f" ]; then
    rm -f "$f"
    echo "Removed: $f"
    removed=1
  fi
done
[ "$removed" = 1 ] || echo "Nothing to remove."
echo "Restart opencode to finish."
