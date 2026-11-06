import {Injectable, Injector, Optional, Signal, effect, signal, untracked} from '@angular/core';
import {DesktopBridge} from '@src/Model/Desktop/DesktopBridge';
import {DesktopPreferences} from '@src/Model/Desktop/DesktopPreferences';
import {DesktopPreferencesService} from '@src/Model/Desktop/DesktopPreferencesService';
import {McpCommandCatalog} from '@src/Model/Mcp/McpCommandCatalog';

export type McpBridgeStatus = 'off' | 'connecting' | 'connected' | 'rejected';

type AdapterMessage =
	| {type: 'ready'}
	| {type: 'rejected'; reason: string}
	| {type: 'request'; id: string; name: string; args: unknown};

/**
 * Desktop only, and only when the user turned it on in settings. Connects out to the local MCP adapter (mcp/ in the repo) over a
 * loopback WebSocket, proves it knows the shared token, then answers each request by running the named command on the command bus.
 * The app is always the client: nothing listens inside the app, and the adapter never receives anything but command results.
 */
@Injectable({providedIn: 'root'})
export class McpBridgeService
{

	private static readonly MIN_DELAY_MS = 1000;
	private static readonly MAX_DELAY_MS = 15000;

	private readonly statusSignal = signal<McpBridgeStatus>('off');
	public readonly status: Signal<McpBridgeStatus> = this.statusSignal.asReadonly();

	private readonly detailSignal = signal<string | null>(null);
	public readonly detail: Signal<string | null> = this.detailSignal.asReadonly();

	private socket: WebSocket | null = null;
	private retryTimer: ReturnType<typeof setTimeout> | null = null;
	private retryDelay = McpBridgeService.MIN_DELAY_MS;
	private activeKey: string | null = null;
	private catalog: McpCommandCatalog | null = null;

	public constructor(
		@Optional() private readonly desktop: DesktopBridge | null,
		preferences: DesktopPreferencesService,
		private readonly injector: Injector,
	)
	{
		if (desktop === null) {
			return;
		}
		effect(() => {
			const current = preferences.preferences();
			untracked(() => this.apply(current));
		});
	}

	private apply(preferences: DesktopPreferences): void
	{
		const wanted = preferences.mcpBridge && preferences.mcpToken !== '';
		const key = wanted ? `${preferences.mcpPort}|${preferences.mcpToken}` : null;
		if (key === this.activeKey) {
			return;
		}
		this.activeKey = key;
		this.disconnect();
		if (key === null) {
			this.statusSignal.set('off');
			this.detailSignal.set(null);
			return;
		}
		this.retryDelay = McpBridgeService.MIN_DELAY_MS;
		this.connect(preferences.mcpPort, preferences.mcpToken);
	}

	private connect(port: number, token: string): void
	{
		this.statusSignal.set('connecting');
		this.detailSignal.set(`Waiting for the MCP adapter on port ${port}.`);
		let socket: WebSocket;
		try {
			socket = new WebSocket(`ws://127.0.0.1:${port}`);
		} catch (error) {
			this.detailSignal.set(String(error));
			this.scheduleRetry(port, token);
			return;
		}
		this.socket = socket;

		socket.onopen = () => {
			socket.send(JSON.stringify({type: 'hello', token, app: 'satisfactory-tools', version: this.desktop?.info.version ?? 'unknown'}));
		};
		socket.onmessage = event => {
			void this.onMessage(socket, JSON.parse(String(event.data)) as AdapterMessage);
		};
		socket.onclose = () => {
			if (this.socket !== socket) {
				return;
			}
			this.socket = null;
			if (this.statusSignal() !== 'rejected') {
				this.statusSignal.set('connecting');
				this.detailSignal.set(`Waiting for the MCP adapter on port ${port}.`);
				this.scheduleRetry(port, token);
			}
		};
		socket.onerror = () => socket.close();
	}

	private async onMessage(socket: WebSocket, message: AdapterMessage): Promise<void>
	{
		if (message.type === 'ready') {
			this.retryDelay = McpBridgeService.MIN_DELAY_MS;
			this.statusSignal.set('connected');
			this.detailSignal.set(null);
			const catalog = this.commands();
			socket.send(JSON.stringify({type: 'catalog', commands: catalog.bus.describe()}));
			return;
		}
		if (message.type === 'rejected') {
			this.statusSignal.set('rejected');
			this.detailSignal.set(message.reason);
			return;
		}
		if (message.type === 'request') {
			const response = await this.commands().bus.execute(message.name, message.args);
			if (socket.readyState === WebSocket.OPEN) {
				socket.send(JSON.stringify({type: 'response', id: message.id, response}));
			}
		}
	}

	/** Created on first use, so a user who never enables the bridge never instantiates the command layer. */
	private commands(): McpCommandCatalog
	{
		this.catalog ??= this.injector.get(McpCommandCatalog);
		return this.catalog;
	}

	private scheduleRetry(port: number, token: string): void
	{
		if (this.retryTimer !== null) {
			return;
		}
		const key = this.activeKey;
		this.retryTimer = setTimeout(() => {
			this.retryTimer = null;
			if (this.activeKey === key && key !== null) {
				this.connect(port, token);
			}
		}, this.retryDelay);
		this.retryDelay = Math.min(this.retryDelay * 2, McpBridgeService.MAX_DELAY_MS);
	}

	private disconnect(): void
	{
		if (this.retryTimer !== null) {
			clearTimeout(this.retryTimer);
			this.retryTimer = null;
		}
		const socket = this.socket;
		this.socket = null;
		socket?.close();
	}

}
