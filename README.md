# Satisfactory Tools MCP

An [MCP](https://modelcontextprotocol.io/) server that lets an AI assistant work in the [Satisfactory Tools](https://www.satisfactorytools.com/) desktop app. Ask for a factory in plain language and watch the plan appear in the open app, solved by the app's own production solver.

> Open the planner and make 60 iron plates per minute. How many machines is that, and how much power does it use?

This is an unofficial fork of [SatisfactoryTools/SFTools](https://github.com/SatisfactoryTools/SFTools), which is the production planner itself. This fork adds the MCP layer, and it only works with a desktop build made from this repo: the official installers don't include it.

**Status: early.** The tools cover about a quarter of what the app can do. Plans and calculator settings work, but most graph editing, the map and sharing don't have tools yet. See [What it can't do yet](#what-it-cant-do-yet).

## How it works

```
AI client  --MCP-->  adapter (mcp/)  --ws://127.0.0.1:47813-->  desktop app
```

The AI talks to a small Node adapter, which passes each tool call to the open app over a local WebSocket. The app runs the command through the same services the UI uses, so plans follow the same rules, the solver gives the same answers, and changes show up on screen straight away.

## Setup

You need:

- Node v20.19+ (or v22.12+)
- [Rust and the Tauri prerequisites](https://tauri.app/start/prerequisites/) for your system

**1. Install and build**

```bash
npm install
```

```bash
cp src/env/env.prod.ts src/env/env.ts
```

```bash
cd mcp && npm install && npm run build
```

**2. Start the desktop app.** These run in two separate terminals, from the repo root. The first Rust build takes a while.

```bash
npm start
```

```bash
npm run desktop:dev
```

**3. Add the server to your AI client**

Claude Code, from the repo root:

```bash
claude mcp add satisfactory-tools -- node "$PWD/mcp/dist/index.js" --stdio
```

Claude Desktop, in `claude_desktop_config.json`:

```json
{
	"mcpServers": {
		"satisfactory-tools": {
			"command": "node",
			"args": ["C:\\path\\to\\SFTools\\mcp\\dist\\index.js", "--stdio"]
		}
	}
}
```

For ChatGPT through a tunnel, see the [adapter README](mcp/README.md).

**4. Link the app.** Start a session in your client so the adapter runs and creates its token, then read the token:

```bash
cat ~/.sftools-mcp/bridge-token
```

In the app, go to **Settings > Desktop app > AI assistants (MCP)**, turn it on and paste the token. The status should read "Connected to the adapter."

Only one adapter can run at a time, because they all use the same port. A second client session's adapter will fail to start until the first one closes.

## Tools

There are 37 tools.

| Area | Tools |
|---|---|
| App | `app_get_context`, `app_get_capabilities`, `app_navigate`, `versions_list` |
| Plans and folders | `plans_list`, `plans_get`, `plans_open`, `plans_create`, `plans_rename`, `plans_clone`, `plans_delete`, `folders_create`, `folders_rename`, `folders_delete` |
| Requests and recipes | `data_search_items`, `calculator_set_targets`, `calculator_set_inputs`, `calculator_list_recipes`, `calculator_set_recipes` |
| Calculator settings | `calculator_get_settings`, `calculator_list_options`, `calculator_set_resources`, `calculator_set_machines`, `calculator_set_byproducts`, `calculator_set_sink`, `calculator_set_power`, `calculator_set_clock_speeds`, `calculator_set_sloops`, `calculator_set_optimization`, `calculator_set_mode`, `calculator_reset` |
| Solving and results | `calculator_calculate`, `results_get_summary`, `results_get_breakdown`, `operations_get`, `operations_cancel` |
| Graph | `graph_delete_nodes` |

A typical session opens the planner with `app_navigate`, creates and opens a plan, finds items with `data_search_items`, sets targets, calculates, and reads the results.

## Safety

- **Off by default.** The app connects only after you turn the bridge on and paste the token.
- **Local only.** The adapter listens on `127.0.0.1`. If you expose it through a tunnel for ChatGPT, anyone with the URL and bearer token can control your app.
- **Changes can't land on the wrong plan.** Tools that change a plan's settings or graph require `planId`, so clicking another plan mid-conversation doesn't redirect them. Reads default to the open plan and say which one they read.
- **Your own edits are protected.** A tool given `expectedRevision` is refused if the plan changed since the client read it.
- **Deletes need `confirm: true`.** Only graph edits can be undone, using the app's undo. Deleted plans and changed settings can't be restored from here.
- **Honest results.** Tools report what actually happened, including failed solves, and result tools flag numbers that no longer match the plan.

## What it can't do yet

- **Graph:** adding, editing, connecting or arranging nodes, and subplans. Only deleting nodes works.
- **Calculator:** loading settings from a save file, and folder-level settings.
- **Plans:** moving plans, icons, import and export.
- **No tools at all:** the map, sharing, custom game versions, mods, app settings, panels, account and help.

**Testing so far** has been on Windows with a development build, driven by an MCP client script over stdio and HTTP. Claude Desktop, ChatGPT, signed-in accounts and shared plans haven't been tested, and neither has a packaged build. Reports welcome.

## Development

```bash
npx ngc -p tsconfig.app.json --noEmit
```

```bash
cd mcp && npm test
```

- `mcp/` is the adapter: tool definitions in `src/tools.ts`, MCP server, bridge and token handling.
- `src/app/Model/Mcp/` is the command layer inside the app: commands, gates, revisions and result reporting.

The planner on its own also runs in a browser with `npm start` at `http://localhost:4200/`, but the bridge only runs in the desktop app.

## Privacy

The app talks to `api.new.satisfactorytools.com` for game data and icons, and syncs your plans if you sign in. With `env.prod.ts` as your environment file, page views also go to the upstream project's cookieless Matomo instance. To turn that off, set the `matomo` values in `src/env/env.ts` to `null`, as in `env.example.ts`.

The MCP layer adds no network traffic of its own beyond the local connection. Your AI client does see what its tools return, such as your plans and settings.

## Credits and license

The planner is by Tomáš Blatný and the [Satisfactory Tools](https://github.com/SatisfactoryTools) contributors.

[MIT](LICENSE). Satisfactory is made by Coffee Stain Studios; game icons and names are used with their permission and remain their property.
