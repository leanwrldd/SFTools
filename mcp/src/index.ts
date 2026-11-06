#!/usr/bin/env node
import {createServer as createHttpServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {AppBridge} from './bridge.js';
import {DEFAULT_BRIDGE_PORT, DEFAULT_HTTP_PORT} from './protocol.js';
import {createServer} from './server.js';
import {loadSecret} from './token.js';

/** stdout carries the protocol in stdio mode, so every diagnostic goes to stderr. */
function log(message: string): void
{
	process.stderr.write(`[sftools-mcp] ${message}\n`);
}

function numberFlag(name: string, env: string, fallback: number): number
{
	const index = process.argv.indexOf(name);
	const raw = index >= 0 ? process.argv[index + 1] : process.env[env];
	const value = raw === undefined ? fallback : Number(raw);
	if (!Number.isInteger(value) || value < 0 || value > 65535) {
		throw new Error(`${name} must be a port number.`);
	}
	return value;
}

function bearerMatches(header: string | undefined, token: string): boolean
{
	if (header === undefined || !header.startsWith('Bearer ')) {
		return false;
	}
	const a = Buffer.from(header.slice('Bearer '.length));
	const b = Buffer.from(token);
	return a.length === b.length && timingSafeEqual(a, b);
}

async function main(): Promise<void>
{
	const http = process.argv.includes('--http');
	const stdio = process.argv.includes('--stdio') || !http;

	const bridgeSecret = loadSecret('bridge-token', 'SFTOOLS_MCP_BRIDGE_TOKEN');
	const bridge = new AppBridge(bridgeSecret.value);
	const bridgePort = await bridge.listen(numberFlag('--bridge-port', 'SFTOOLS_MCP_BRIDGE_PORT', DEFAULT_BRIDGE_PORT));
	log(`Waiting for the app on ws://127.0.0.1:${bridgePort}`);
	log(`Paste this token into Settings > Desktop app > MCP bridge: ${bridgeSecret.value}`);
	bridge.on('connected', info => log(`App connected (${info.app} ${info.version}).`));
	bridge.on('disconnected', () => log('App disconnected.'));

	if (stdio) {
		await createServer(bridge).connect(new StdioServerTransport());
		log('MCP over stdio is ready.');
		return;
	}

	const httpSecret = loadSecret('http-token', 'SFTOOLS_MCP_HTTP_TOKEN');
	const httpPort = numberFlag('--port', 'SFTOOLS_MCP_HTTP_PORT', DEFAULT_HTTP_PORT);
	const server = createHttpServer((request, response) => {
		void handle(request, response);
	});

	async function handle(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse): Promise<void>
	{
		if (request.url?.split('?')[0] !== '/mcp') {
			response.writeHead(404).end();
			return;
		}
		if (!bearerMatches(request.headers.authorization, httpSecret.value)) {
			response.writeHead(401, {'WWW-Authenticate': 'Bearer'}).end();
			return;
		}
		// Stateless: a fresh server and transport per request, all sharing the one bridge.
		const mcp = createServer(bridge);
		const transport = new StreamableHTTPServerTransport({sessionIdGenerator: undefined});
		response.on('close', () => {
			void transport.close();
			void mcp.close();
		});
		try {
			await mcp.connect(transport);
			await transport.handleRequest(request, response);
		} catch (error) {
			log(`HTTP request failed: ${String(error)}`);
			if (!response.headersSent) {
				response.writeHead(500).end();
			}
		}
	}

	await new Promise<void>(resolve => server.listen(httpPort, '127.0.0.1', resolve));
	log(`MCP over HTTP at http://127.0.0.1:${httpPort}/mcp (bearer token: ${httpSecret.value})`);
}

main().catch(error => {
	log(`Fatal: ${String(error)}`);
	process.exit(1);
});
