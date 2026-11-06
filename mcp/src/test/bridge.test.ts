import assert from 'node:assert/strict';
import {after, before, describe, it} from 'node:test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {WebSocket} from 'ws';
import {AppBridge, BridgeError} from '../bridge.js';
import {createServer} from '../server.js';
import {TOOLS} from '../tools.js';

const TOKEN = 'test-token';

/** Stands in for the Angular app: connects, authenticates, answers requests with the given handler. */
async function fakeApp(port: number, handler: (name: string, args: unknown) => unknown, token = TOKEN): Promise<WebSocket> {
	const socket = new WebSocket(`ws://127.0.0.1:${port}`);
	await new Promise<void>((resolve, reject) => {
		socket.once('open', resolve);
		socket.once('error', reject);
	});
	const ready = new Promise<string>(resolve => {
		socket.on('message', raw => {
			const message = JSON.parse(raw.toString()) as {type: string; id?: string; name?: string; args?: unknown};
			if (message.type === 'ready' || message.type === 'rejected') {
				resolve(message.type);
			} else if (message.type === 'request') {
				socket.send(JSON.stringify({type: 'response', id: message.id, response: handler(message.name!, message.args)}));
			}
		});
	});
	socket.send(JSON.stringify({type: 'hello', token, app: 'fake', version: '0'}));
	assert.equal(await ready, token === TOKEN ? 'ready' : 'rejected');
	return socket;
}

async function connectClient(bridge: AppBridge): Promise<Client> {
	const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
	await createServer(bridge).connect(serverSide);
	const client = new Client({name: 'test', version: '0'});
	await client.connect(clientSide);
	return client;
}

function payload(result: unknown): {ok: boolean; [key: string]: unknown} {
	const content = (result as {content: {text: string}[]}).content;
	return JSON.parse(content[0]!.text) as {ok: boolean};
}

describe('adapter bridge', () => {
	let bridge: AppBridge;
	let port: number;

	before(async () => {
		bridge = new AppBridge(TOKEN);
		port = await bridge.listen(0);
	});

	after(async () => {
		await bridge.close();
	});

	it('exposes every tool with a unique client-safe name', async () => {
		const client = await connectClient(bridge);
		const listed = (await client.listTools()).tools;
		assert.equal(listed.length, TOOLS.length);
		assert.equal(new Set(listed.map(tool => tool.name)).size, TOOLS.length);
		assert.ok(listed.every(tool => /^[a-zA-Z0-9_-]{1,64}$/.test(tool.name)));
		assert.ok(listed.find(tool => tool.name === 'plans_delete')?.annotations?.destructiveHint === true);
	});

	it('reports app_not_connected as a tool error when no app is attached', async () => {
		const client = await connectClient(bridge);
		const result = await client.callTool({name: 'plans_list', arguments: {}});
		assert.equal(result.isError, true);
		const body = payload(result) as unknown as {error: {code: string}};
		assert.equal(body.error.code, 'app_not_connected');
	});

	it('rejects an app with the wrong token', async () => {
		const socket = await fakeApp(port, () => null, 'wrong');
		await new Promise(resolve => socket.once('close', resolve));
		assert.equal(bridge.connected, false);
	});

	it('relays a command to the app and returns its response', async () => {
		const seen: {name: string; args: unknown}[] = [];
		const app = await fakeApp(port, (name, args) => {
			seen.push({name, args});
			return {ok: true, kind: 'query', data: {plans: []}};
		});
		const client = await connectClient(bridge);
		const result = await client.callTool({name: 'plans_rename', arguments: {planId: 'p1', name: 'New', expectedRevision: '3'}});
		assert.notEqual(result.isError, true);
		assert.deepEqual(seen, [{name: 'plans.rename', args: {planId: 'p1', name: 'New', expectedRevision: '3'}}]);
		assert.equal(payload(result).ok, true);
		app.close();
		await new Promise(resolve => bridge.once('disconnected', resolve));
	});

	it('passes an app failure through as a tool error with its code and recovery', async () => {
		const app = await fakeApp(port, () => ({ok: false, error: {code: 'stale_target', message: 'changed', recovery: 'plans.get', details: null}}));
		const client = await connectClient(bridge);
		const result = await client.callTool({name: 'plans_rename', arguments: {planId: 'p1', name: 'x'}});
		assert.equal(result.isError, true);
		assert.equal((payload(result) as unknown as {error: {code: string; recovery: string}}).error.recovery, 'plans.get');
		app.close();
		await new Promise(resolve => bridge.once('disconnected', resolve));
	});

	it('refuses invalid arguments before they reach the app', async () => {
		let calls = 0;
		const app = await fakeApp(port, () => {
			calls++;
			return {ok: true, kind: 'query', data: null};
		});
		const client = await connectClient(bridge);
		const result = await client.callTool({name: 'plans_delete', arguments: {planId: 'p1'}}).catch((error: unknown) => error);
		const rejected = result instanceof Error || (result as {isError?: boolean}).isError === true;
		assert.equal(rejected, true);
		assert.equal(calls, 0);
		app.close();
		await new Promise(resolve => bridge.once('disconnected', resolve));
	});

	it('ends a request with app_disconnected when the app drops mid-call', async () => {
		const app = await fakeApp(port, () => new Promise(() => undefined) as unknown);
		app.removeAllListeners('message');
		const pending = bridge.call('plans.list', {}, 5000);
		const rejection = assert.rejects(pending, (error: unknown) => error instanceof BridgeError && error.code === 'app_disconnected');
		app.close();
		await rejection;
	});

	it('ends a request with timeout when the app never answers', async () => {
		const app = await fakeApp(port, () => null);
		app.removeAllListeners('message');
		await assert.rejects(bridge.call('plans.list', {}, 50), (error: unknown) => error instanceof BridgeError && error.code === 'timeout');
		app.close();
		await new Promise(resolve => bridge.once('disconnected', resolve));
	});
});
