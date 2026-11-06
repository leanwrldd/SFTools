import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {AppBridge} from './bridge.js';
import {BridgeError} from './bridge.js';
import {TOOLS} from './tools.js';

const DEFAULT_TIMEOUT_MS = 30_000;

interface ToolResult
{
	[key: string]: unknown;
	content: {type: 'text'; text: string}[];
	isError?: boolean;
}

function text(payload: unknown, isError: boolean): ToolResult
{
	return {content: [{type: 'text', text: JSON.stringify(payload, null, 2)}], ...(isError ? {isError: true} : {})};
}

/** One server per client connection; all of them share the same bridge to the app. */
export function createServer(bridge: AppBridge): McpServer
{
	const server = new McpServer({name: 'satisfactory-tools', version: '0.1.0'});

	for (const tool of TOOLS) {
		server.registerTool(
			tool.name,
			{
				title: tool.title,
				description: tool.description,
				inputSchema: tool.shape,
				annotations: {
					readOnlyHint: tool.readOnly,
					destructiveHint: tool.destructive === true,
					idempotentHint: tool.readOnly,
					openWorldHint: false,
				},
			},
			async (args: Record<string, unknown>): Promise<ToolResult> => {
				try {
					const response = await bridge.call(tool.command, args, tool.timeoutMs ?? DEFAULT_TIMEOUT_MS);
					const ok = typeof response === 'object' && response !== null && (response as {ok?: unknown}).ok === true;
					return text(response, !ok);
				} catch (error) {
					if (error instanceof BridgeError) {
						return text({ok: false, error: {code: error.code, message: error.message, recovery: null, details: null}}, true);
					}
					throw error;
				}
			},
		);
	}

	return server;
}
