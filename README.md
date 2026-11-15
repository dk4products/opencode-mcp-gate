# opencode MCP gate

An opencode plugin that asks which MCP servers to enable at the start of every new interactive session, then connects them live. All MCP servers can stay off by default, which keeps the first turn small (all servers enabled costs roughly 125K tokens of tool definitions).

## What it does

In a new top-level interactive session:

1. The model is told to ask you first, using a multi-select picker that lists every MCP server in your opencode config. It includes a **None** option (enable nothing for this session), and a "Same as last time" option once you have made a choice before.
2. Every other tool is blocked until you answer, so the choice cannot be skipped.
3. The `mcp_apply` tool connects the servers you chose and disconnects the rest, with no restart. It re-reads the real status and prints it, for example `Actual status now: atlassian=connected, ...`.
4. A toast confirms the selection and reminds you that `/mcps` activates MCP servers later. The choice is saved for next time.

It does not prompt in subagent sessions, in resumed sessions, or in non-interactive commands (`opencode run`, `serve`, `web`, `acp`, and similar).

## Changing servers later: /mcps

Type `/mcps` in any session to open the same picker again (None, plus every server). The servers you pick replace the current set, so include any that should stay connected. It works after the session-start choice, including when you picked None.

## Install with npx (macOS / Linux / Windows)

Needs Node.js 18+ and git. The repository is public, so no GitHub login is required.

Recommended (pinned to a released version):

```sh
npx github:dk4products/opencode-mcp-gate#v1.1.0            # install
npx github:dk4products/opencode-mcp-gate#v1.1.0 status     # check install state
npx github:dk4products/opencode-mcp-gate#v1.1.0 uninstall  # remove
```

Omit `#v1.1.0` to always run the latest `main`. Add `--dir <path>` to target a different opencode config directory. Afterwards, fully quit and restart opencode and start a new session.

## Install from a clone (macOS / Linux)

```sh
git clone <this repo> opencode-mcp-gate   # or unzip the folder you were given
cd opencode-mcp-gate
./install.sh
```

Then fully quit and restart opencode and start a new session. If the script is not executable: `chmod +x install.sh uninstall.sh`.

The installer copies `plugin/mcp-gate.js` to `~/.config/opencode/plugins/`, backs up any older copy, and installs `@opencode-ai/plugin` in the config directory if it is missing. It does not edit `opencode.json(c)`. Global plugins in that folder load automatically.

## Uninstall

```sh
./uninstall.sh
```

## Settings

| Variable | Effect |
| --- | --- |
| `OPENCODE_MCP_GATE=off` | Disable the gate for this run |
| `OPENCODE_MCP_GATE=force` | Gate even when the command looks non-interactive (used for testing) |
| `OPENCODE_CONFIG_DIR` | Install somewhere other than `~/.config/opencode` (installer only) |

The last selection is stored in `~/.config/opencode/.mcp-gate-state.json`.

## Known limitations

- **The sidebar can lag.** The TUI sidebar may keep showing a server as "Disabled" after the plugin connects it. The server and the model's tools are connected; only the display is stale. Trust the `Actual status now` line. Restarting opencode refreshes the sidebar.
- **OAuth servers need a valid login.** If a server such as atlassian, sharepoint or github has an expired token, `mcp_apply` reports its real status. Run `opencode mcp auth <name>` to sign in again.
- **One extra model turn.** The picker uses the model's `question` tool, so the first message costs one turn before the real work starts.
- **Hooks may change between releases.** The plugin uses `experimental.chat.system.transform` and `tool.execute.before`. If a release changes them, the picker would stop appearing. Nothing is wrongly blocked.
- **Directory scoping.** MCP state is per project directory on the server, and the plugin passes the session directory on every call. This was verified against opencode v1.19.3.

## After upgrading opencode

1. Check that `~/.config/opencode/plugins/mcp-gate.js` still exists. If not, run `./install.sh` again.
2. Start a new session and confirm the picker appears.
3. If it does not, look at `~/.local/share/opencode/log/opencode.log` and check the hook names against the installed `@opencode-ai/plugin` types.

## Repository layout

```
plugin/mcp-gate.js   the plugin (gate, mcp_apply / mcp_list tools, /mcps command)
bin/cli.js           npx installer (install / uninstall / status)
package.json         makes the repo runnable with npx
install.sh           shell installer
uninstall.sh         shell remover
```

## How it works

- `experimental.chat.system.transform` injects the instruction and the current server list, read live from the config.
- `tool.execute.before` throws for every tool except `question` and `mcp_apply` until the selection is done. If the session lookup fails, it lets the session through rather than blocking it.
- `mcp_apply` calls `client.mcp.connect` and `client.mcp.disconnect` with the session directory.
