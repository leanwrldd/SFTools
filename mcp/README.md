# Satisfactory Tools MCP adapter

Speaks MCP to Claude and ChatGPT and relays each tool call to the open desktop app over a loopback WebSocket. The app runs the command (`src/app/Model/Mcp`) and the adapter returns its result.

```
Claude / ChatGPT  --MCP-->  adapter (this folder)  --ws://127.0.0.1:47813-->  desktop app
```

## Build

```bash
cd mcp
npm install
npm run build
npm test
```

## Connect

1. Start the adapter (Claude Desktop does this itself in stdio mode). It prints a **bridge token** to stderr and keeps it in `~/.sftools-mcp/bridge-token`.
2. In the desktop app: Settings > Desktop app > AI assistants (MCP). Turn it on, keep the port, paste the token. The status line should read "Connected".

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
	"mcpServers": {
		"satisfactory-tools": {
			"command": "node",
			"args": ["C:\\Users\\latif\\Documents\\SFTools\\mcp\\dist\\index.js", "--stdio"]
		}
	}
}
```

### ChatGPT (custom connector through a tunnel)

```bash
node dist/index.js --http
```

Serves `http://127.0.0.1:47814/mcp`, bearer token from `~/.sftools-mcp/http-token`. Point your tunnel at that port and give ChatGPT the bearer token. The adapter only listens on loopback, so the tunnel is what exposes it; anyone with the URL and token can drive your app.

## Security

- The adapter binds `127.0.0.1` only. The app proves the bridge token before any command is accepted.
- Destructive tools need `confirm: true`; plan and folder edits can carry `expectedRevision` so a change you made by hand in between is not overwritten.
- Tools that change a plan's settings or graph require `planId`, so a change cannot land on another plan if the open one changes mid-conversation. Reads may leave it out and report which plan they read.
- Environment overrides: `SFTOOLS_MCP_BRIDGE_TOKEN`, `SFTOOLS_MCP_HTTP_TOKEN`, `SFTOOLS_MCP_BRIDGE_PORT`, `SFTOOLS_MCP_HTTP_PORT`.
