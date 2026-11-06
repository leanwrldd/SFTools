import {EventEmitter} from 'node:events';
import {randomUUID, timingSafeEqual} from 'node:crypto';
import {WebSocket, WebSocketServer} from 'ws';
import type {AdapterToApp, AppToAdapter} from './protocol.js';

export class BridgeError extends Error
{

	public constructor(public readonly code: 'app_not_connected' | 'app_disconnected' | 'timeout', message: string)
	{
		super(message);
		this.name = 'BridgeError';
	}

}

interface Pending
{
	resolve: (response: unknown) => void;
	reject: (error: BridgeError) => void;
	timer: NodeJS.Timeout;
}

export interface AppInfo
{
	app: string;
	version: string;
}

/**
 * Loopback WebSocket server that the Satisfactory Tools app connects to. Every request carries a correlation id; every request ends in
 * a response, a timeout, or an app_disconnected error. Only one app connection is active at a time (a newer one replaces the older).
 */
export class AppBridge extends EventEmitter
{

	private server: WebSocketServer | null = null;
	private socket: WebSocket | null = null;
	private info: AppInfo | null = null;
	private catalog: unknown[] = [];
	private readonly pending = new Map<string, Pending>();

	public constructor(private readonly token: string)
	{
		super();
	}

	public get connected(): boolean
	{
		return this.socket !== null && this.info !== null;
	}

	public get appInfo(): AppInfo | null
	{
		return this.info;
	}

	public get commands(): unknown[]
	{
		return this.catalog;
	}

	public listen(port: number): Promise<number>
	{
		return new Promise((resolve, reject) => {
			const server = new WebSocketServer({host: '127.0.0.1', port, maxPayload: 16 * 1024 * 1024});
			server.once('error', reject);
			server.once('listening', () => {
				server.off('error', reject);
				this.server = server;
				const address = server.address();
				resolve(typeof address === 'object' && address !== null ? address.port : port);
			});
			server.on('connection', socket => this.accept(socket));
		});
	}

	public async close(): Promise<void>
	{
		this.failAll(new BridgeError('app_disconnected', 'The adapter is shutting down.'));
		this.socket?.close();
		await new Promise<void>(resolve => {
			if (this.server === null) {
				resolve();
				return;
			}
			this.server.close(() => resolve());
		});
	}

	public call(name: string, args: unknown, timeoutMs: number): Promise<unknown>
	{
		const socket = this.socket;
		if (socket === null || this.info === null) {
			return Promise.reject(new BridgeError(
				'app_not_connected',
				'The Satisfactory Tools desktop app is not connected. Open the app and turn on the MCP bridge in Settings > Desktop app.',
			));
		}
		const id = randomUUID();
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new BridgeError('timeout', `The app did not answer "${name}" within ${Math.round(timeoutMs / 1000)}s.`));
			}, timeoutMs);
			this.pending.set(id, {resolve, reject, timer});
			const message: AdapterToApp = {type: 'request', id, name, args};
			socket.send(JSON.stringify(message), error => {
				if (error) {
					clearTimeout(timer);
					this.pending.delete(id);
					reject(new BridgeError('app_disconnected', 'Could not send the request to the app.'));
				}
			});
		});
	}

	private accept(socket: WebSocket): void
	{
		// An unauthenticated peer gets a short window to say hello, then it is dropped.
		const deadline = setTimeout(() => socket.close(4401, 'hello timeout'), 5000);
		let authenticated = false;

		socket.on('message', raw => {
			let message: AppToAdapter;
			try {
				message = JSON.parse(raw.toString()) as AppToAdapter;
			} catch {
				socket.close(4400, 'bad message');
				return;
			}
			if (!authenticated) {
				if (message.type !== 'hello' || !this.tokenMatches(message.token)) {
					this.send(socket, {type: 'rejected', reason: 'Wrong or missing token.'});
					socket.close(4403, 'rejected');
					return;
				}
				authenticated = true;
				clearTimeout(deadline);
				this.adopt(socket, {app: String(message.app), version: String(message.version)});
				return;
			}
			if (message.type === 'response') {
				const entry = this.pending.get(message.id);
				if (entry !== undefined) {
					clearTimeout(entry.timer);
					this.pending.delete(message.id);
					entry.resolve(message.response);
				}
			} else if (message.type === 'catalog' && Array.isArray(message.commands)) {
				this.catalog = message.commands;
			}
		});

		socket.on('close', () => {
			clearTimeout(deadline);
			if (this.socket === socket) {
				this.socket = null;
				this.info = null;
				this.failAll(new BridgeError('app_disconnected', 'The app disconnected before it answered.'));
				this.emit('disconnected');
			}
		});
		socket.on('error', () => socket.close());
	}

	private adopt(socket: WebSocket, info: AppInfo): void
	{
		const previous = this.socket;
		this.socket = socket;
		this.info = info;
		this.send(socket, {type: 'ready'});
		if (previous !== null && previous !== socket) {
			previous.close(4409, 'replaced by a newer connection');
		}
		this.emit('connected', info);
	}

	private send(socket: WebSocket, message: AdapterToApp): void
	{
		if (socket.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify(message));
		}
	}

	private failAll(error: BridgeError): void
	{
		for (const [id, entry] of this.pending) {
			clearTimeout(entry.timer);
			entry.reject(error);
			this.pending.delete(id);
		}
	}

	private tokenMatches(candidate: unknown): boolean
	{
		if (typeof candidate !== 'string') {
			return false;
		}
		const a = Buffer.from(candidate);
		const b = Buffer.from(this.token);
		return a.length === b.length && timingSafeEqual(a, b);
	}

}
