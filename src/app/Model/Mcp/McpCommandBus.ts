import {Injectable, Optional} from '@angular/core';
import {AuthService} from '@src/Model/Auth/AuthService';
import {VersionManager} from '@src/Model/Data/VersionManager';
import {DesktopBridge} from '@src/Model/Desktop/DesktopBridge';
import {McpArgs} from '@src/Model/Mcp/McpArgs';
import {McpCommand, McpGate} from '@src/Model/Mcp/McpCommand';
import {McpError} from '@src/Model/Mcp/McpError';
import {McpPlannerHost} from '@src/Model/Mcp/McpPlannerHost';
import {McpResponse} from '@src/Model/Mcp/McpResult';
import {PlanManager} from '@src/Model/Planner/PlanManager';

interface McpUnavailable
{

	readonly code: string;
	readonly message: string;
	/** Tool that gets past the gate, when there is one. */
	readonly recovery: string | null;

}

export interface McpCommandInfo
{

	readonly name: string;
	readonly kind: 'query' | 'mutation';
	readonly summary: string;
	readonly gates: readonly McpGate[];
	/** Null when available now, otherwise why not. */
	readonly unavailable: McpUnavailable | null;

}

/**
 * Single entry point for every MCP command. Commands register themselves; the bus resolves them by name, checks gates and always
 * returns a McpResponse (never throws), so the transport adapter can serialise the outcome unchanged.
 */
@Injectable({providedIn: 'root'})
export class McpCommandBus
{

	private readonly commands = new Map<string, McpCommand>();

	public constructor(
		private readonly auth: AuthService,
		private readonly plannerHost: McpPlannerHost,
		private readonly planManager: PlanManager,
		private readonly versions: VersionManager,
		@Optional() private readonly desktop: DesktopBridge | null,
	)
	{
	}

	public register(...commands: McpCommand[]): void
	{
		for (const command of commands) {
			if (this.commands.has(command.name)) {
				throw new Error(`MCP command registered twice: ${command.name}`);
			}
			this.commands.set(command.name, command);
		}
	}

	public async execute(name: string, rawArgs: unknown): Promise<McpResponse>
	{
		try {
			const command = this.commands.get(name);
			if (command === undefined) {
				throw new McpError('unknown_command', `No command named "${name}".`, 'app.get_capabilities');
			}
			const blocked = this.firstUnmetGate(command);
			if (blocked !== null) {
				throw new McpError('not_available', blocked.message, blocked.recovery, {gate: blocked.code});
			}
			return await command.run(new McpArgs(rawArgs));
		} catch (error) {
			const failure = McpError.from(error);
			return {ok: false, error: {code: failure.code, message: failure.message, recovery: this.toolFor(failure.recovery), details: failure.details}};
		}
	}

	/** Backs app.get_capabilities: every command with the reason it cannot run right now. */
	public describe(): McpCommandInfo[]
	{
		return [...this.commands.values()].map(command => {
			const blocked = this.firstUnmetGate(command);
			return {
				name: command.name,
				kind: command.kind,
				summary: command.summary,
				gates: command.gates ?? [],
				unavailable: blocked === null ? null : {...blocked, recovery: this.toolFor(blocked.recovery)},
			};
		});
	}

	/** Clients only know tool names, and a hint must never send them to a command that does not exist. */
	private toolFor(command: string | null): string | null
	{
		return command !== null && this.commands.has(command) ? command.replace('.', '_') : null;
	}

	private firstUnmetGate(command: McpCommand): McpUnavailable | null
	{
		for (const gate of command.gates ?? []) {
			if (gate === 'auth' && !this.auth.isAuthenticated()) {
				return {code: 'signed_out', message: 'Sign in to the app first.', recovery: null};
			}
			if (gate === 'planner_open' && !this.plannerHost.isOpen()) {
				return {code: 'planner_not_open', message: 'Open the planner page first with app_navigate {target: "planner"}.', recovery: 'app.navigate'};
			}
			if (gate === 'desktop' && this.desktop === null) {
				return {code: 'browser_only', message: 'Only available in the desktop app.', recovery: null};
			}
			if (gate === 'plans_loaded' && !this.planManager.loadedForActiveVersion()) {
				return this.versions.activeVersion() === null
					? {code: 'no_version', message: 'Plans belong to a game version and none is open on this page. Open one with app_navigate {target: "planner"}.', recovery: 'app.navigate'}
					: {code: 'plans_loading', message: 'The plans of this game version are still loading. Try again in a moment.', recovery: 'app.get_context'};
			}
		}
		return null;
	}

}
