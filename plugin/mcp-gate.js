// mcp-gate: force an MCP server selection at the start of every new interactive
// top-level session, then apply it live (no restart).
//
// How it works
//  1. experimental.chat.system.transform injects an instruction telling the model
//     to call `question` (multi-select) and then `mcp_apply` before anything else.
//  2. tool.execute.before blocks every tool except `question` / `mcp_apply`
//     until `mcp_apply` has run for that session (hard gate).
//  3. `mcp_apply` connects the chosen servers and disconnects the rest through
//     the server's /mcp/{name}/connect|disconnect endpoints.
//
// Skipped for: subagent/child sessions, resumed sessions (created before this
// process started), and non-interactive runs (opencode run/serve/web/acp...).
// Env: OPENCODE_MCP_GATE=off disables, =force ignores the interactive check.
import { tool } from "@opencode-ai/plugin";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

const STATE_FILE = join(homedir(), ".config", "opencode", ".mcp-gate-state.json");
const STARTED = Date.now();
const ALLOWED = new Set(["question", "mcp_apply", "mcp_list"]);
const NON_INTERACTIVE = new Set(["run", "serve", "web", "acp", "mcp", "plugin", "export", "import", "stats", "auth", "models", "github", "pr", "session", "debug", "upgrade", "uninstall", "agent"]);

const done = (globalThis.__mcpGateDone ??= new Set());
const topLevelCache = (globalThis.__mcpGateTop ??= new Map());

const readState = () => {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
};
const writeState = (s) => {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
  } catch {}
};

const mode = () => (process.env.OPENCODE_MCP_GATE || "").toLowerCase();
const interactive = () => {
  if (mode() === "force") return true;
  const sub = process.argv.slice(2).find((a) => !a.startsWith("-"));
  if (sub && NON_INTERACTIVE.has(sub)) return false;
  return true;
};

export default {
  id: "mcp-gate",
  async server({ client, directory }) {
    const unwrap = (r) => {
      if (r && r.error) throw new Error(typeof r.error === "string" ? r.error : JSON.stringify(r.error).slice(0, 200));
      return r && "data" in r ? r.data : r;
    };

    // Names come from the live config, so new MCPs show up automatically.
    const q = { directory };
    const getStatus = async () => unwrap(await client.mcp.status({ query: q }));
    const listServers = async () => {
      const cfg = unwrap(await client.config.get({ query: q }));
      const status = await getStatus();
      return Object.entries(cfg.mcp || {}).map(([name, c]) => ({
        name,
        type: c?.type,
        target: c?.url || (Array.isArray(c?.command) ? c.command.join(" ") : ""),
        status: status?.[name]?.status ?? "unknown",
      }));
    };

    // Gate only new, interactive, top-level sessions.
    const needsGate = async (sessionID) => {
      if (!sessionID || mode() === "off" || !interactive()) return false;
      if (done.has(sessionID)) return false;
      if (!topLevelCache.has(sessionID)) {
        let gate = false;
        try {
          const r = await client.session.get({ path: { id: sessionID }, query: q });
          const s = r?.data ?? r;
          gate = !s?.parentID && (s?.time?.created ?? 0) >= STARTED - 2000;
        } catch {
          gate = false; // fail open: never wedge a session on a lookup error
        }
        topLevelCache.set(sessionID, gate);
      }
      const gate = topLevelCache.get(sessionID);
      if (!gate) done.add(sessionID);
      return gate;
    };

    return {
      // /mcps: on-demand picker, usable any time after the session-start gate.
      config: async (cfg) => {
        cfg.command = {
          ...cfg.command,
          mcps: {
            description: "Choose which MCP servers to enable for this session",
            template: [
              "Let the user choose MCP servers now. Do exactly this and nothing else:",
              "1. Call `mcp_list` to get every MCP server and whether it is currently connected.",
              "2. Call `question` ONCE with multiple=true, header 'MCP servers'. Options: FIRST an option labelled exactly 'None' (description: 'Disable all MCP servers'), then one option per server (label = exact server name, description = short purpose; mention if currently connected).",
              "3. Call `mcp_apply` with `enable` = the chosen server names (pass [] for 'None' or no selection). The chosen set replaces the current one, so include servers that should stay connected.",
              "4. Reply with one short line stating the actual status from mcp_apply. Do not comment on the process.",
            ].join("\n"),
          },
        };
      },

      "experimental.chat.system.transform": async (input, output) => {
        if (!(await needsGate(input.sessionID))) return;
        let servers = [];
        try { servers = await listServers(); } catch {}
        const last = readState().lastSelection;
        const lines = servers.map((s) => `- ${s.name} (${s.type}${s.target ? ", " + s.target : ""}) [currently ${s.status}]`);
        output.system.push(
          [
            "MANDATORY FIRST STEP (MCP selection gate): this is a new session and MCP servers are not yet chosen.",
            "Before doing ANYTHING else, including answering the user's message, do exactly this:",
            "1. Call the `question` tool ONCE with multiple=true, header 'MCP servers', asking which MCP servers to enable for this session.",
            "   Options: FIRST an option labelled exactly 'None' (description: 'Do not enable any MCP server for this session'), then one option per server below (label = exact server name, description = a short plain-English purpose).",
            last && last.length ? `   Put an option first labelled 'Same as last time' listing: ${last.join(", ")}.` : "",
            "2. Call `mcp_apply` with `enable` = the selected server names. If the user picked 'None' or selected nothing, pass []. Never pass 'None' as a server name. Expand 'Same as last time' to the listed names.",
            "3. Then continue with the user's original request. All other tools are blocked until mcp_apply succeeds.",
            "4. Do NOT comment on, apologise for, or second-guess this selection step in your reply. Trust the `Actual status now` line from mcp_apply; the TUI sidebar can lag behind and must not be used to contradict it.",
            "Available MCP servers:",
            ...lines,
          ].filter(Boolean).join("\n"),
        );
      },

      "tool.execute.before": async (input) => {
        if (ALLOWED.has(input.tool)) return;
        if (!(await needsGate(input.sessionID))) return;
        throw new Error(
          "MCP selection required first. Call the `question` tool (multiple=true) to ask which MCP servers to enable, then call `mcp_apply` with the chosen names. Other tools are blocked until then.",
        );
      },

      tool: {
        mcp_list: tool({
          description: "List all configured MCP servers with their live connection status. Used by /mcps.",
          args: {},
          async execute() {
            const servers = await listServers();
            return servers.map((s) => `${s.name} (${s.type}${s.target ? ", " + s.target : ""}): ${s.status}`).join("\n");
          },
        }),
        mcp_apply: tool({
          description:
            "Enable exactly the given MCP servers live and disconnect all others. Call once at session start after asking the user via `question`. Pass an empty list to enable none.",
          args: {
            enable: tool.schema.array(tool.schema.string()).describe("Exact MCP server names to enable; others are disconnected"),
          },
          async execute(args, ctx) {
            const servers = await listServers();
            const known = new Set(servers.map((s) => s.name));
            const names = args.enable.filter((n) => String(n).trim().toLowerCase() !== "none");
            const want = new Set(names.filter((n) => known.has(n)));
            const unknown = names.filter((n) => !known.has(n));
            const results = [];
            for (const s of servers) {
              const on = s.status === "connected";
              try {
                if (want.has(s.name) && !on) {
                  unwrap(await client.mcp.connect({ path: { name: s.name }, query: q }));
                  results.push(`${s.name}: connected`);
                } else if (!want.has(s.name) && on) {
                  unwrap(await client.mcp.disconnect({ path: { name: s.name }, query: q }));
                  results.push(`${s.name}: disconnected`);
                } else {
                  results.push(`${s.name}: ${want.has(s.name) ? "already connected" : "off"}`);
                }
              } catch (e) {
                results.push(`${s.name}: FAILED (${e.message})`);
              }
            }
            await new Promise((r) => setTimeout(r, 1500));
            const final = await getStatus().catch(() => ({}));
            const failed = [...want].filter((n) => final?.[n]?.status && final[n].status !== "connected");
            done.add(ctx.sessionID);
            topLevelCache.set(ctx.sessionID, false);
            const state = readState();
            state.lastSelection = [...want];
            writeState(state);
            try {
              await client.tui.showToast({
                body: { message: (want.size ? `MCP enabled: ${[...want].join(", ")}` : "No MCP servers enabled") + ". Use /mcps to activate MCPs if needed. (Sidebar may show Disabled until restart.)", variant: "info" },
              });
            } catch {}
            return [
              ...results,
              "Actual status now: " + Object.entries(final).map(([n, v]) => `${n}=${v?.status}`).join(", "),
              `(directory: ${directory})`,
              unknown.length ? `Ignored unknown: ${unknown.join(", ")}` : "",
              failed.length ? `Not connected (may need login/auth): ${failed.map((n) => `${n}=${final[n].status}`).join(", ")}` : "",
              "Selection recorded. Tool definitions for newly enabled servers are available from the next step.",
            ].filter(Boolean).join("\n");
          },
        }),
      },
    };
  },
};
