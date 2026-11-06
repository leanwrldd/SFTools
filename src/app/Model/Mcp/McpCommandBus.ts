import {Injectable, Optional} from '@angular/core';
import {AuthService} from '@src/Model/Auth/AuthService';
import {DesktopBridge} from '@src/Model/Desktop/DesktopBridge';
import {McpArgs} from '@src/Model/Mcp/McpArgs';
import {McpCommand, McpGate} from '@src/Model/Mcp/McpCommand';
import {McpError} from '@src/Model/Mcp/McpError';
import {McpPlannerHost} from '@src/Model/Mcp/McpPlannerHost';
import {McpResponse} from '@src/Model/Mcp/McpResult';

export interface McpCommandInfo
{

	readonly name: string;
	readonly kind: 'query' | 'mutation';
	readonly summary: string;
	readonly gates: readonly McpGate[];
	/** Null when available now, otherwise why not. */
	readonly unavailable: {code: string; message: string} | null;

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
				throw new McpError('not_available', blocked.message, 'app.get_capabilities', {gate: blocked.code});
			}
			return await command.run(new McpArgs(rawArgs));
		} catch (error) {
			const failure = McpError.from(error);
			return {ok: false, error: {code: failure.code, message: failure.message, recovery: failure.recovery, details: failure.details}};
		}
	}

	/** Backs app.get_capabilities: every command with the reason it cannot run right now. */
	public describe(): McpCommandInfo[]
	{
		return [...this.commands.values()].map(command => ({
			name: command.name,
			kind: command.kind,
			summary: command.summary,
			gates: command.gates ?? [],
			unavailable: this.firstUnmetGate(command),
		}));
	}

	private firstUnmetGate(command: McpCommand): {code: string; message: string} | null
	{
		for (const gate of command.gates ?? []) {
			if (gate === 'auth' && !this.auth.isAuthenticated()) {
				return {code: 'signed_out', message: 'Sign in to the app first (account.begin_sign_in).'};
			}
			if (gate === 'planner_open' && !this.plannerHost.isOpen()) {
				return {code: 'planner_not_open', message: 'Open the planner page first (app.navigate {target: "planner"}).'};
			}
			if (gate === 'desktop' && this.desktop === null) {
				return {code: 'browser_only', message: 'Only available in the desktop app.'};
			}
		}
		return null;
	}

}
