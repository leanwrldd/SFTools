import {Injectable} from '@angular/core';
import {McpError} from '@src/Model/Mcp/McpError';

export type McpOperationState = 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface McpOperation
{

	readonly id: string;
	readonly label: string;
	readonly state: McpOperationState;
	readonly startedAt: number;
	readonly finishedAt: number | null;
	readonly message: string | null;
	readonly result: unknown;

}

interface Entry
{
	operation: McpOperation;
	cancel: (() => void) | null;
}

/** Long-running work (calculations, folder recalculation) is started, then polled or cancelled by id: every operation ends in a terminal state. */
@Injectable({providedIn: 'root'})
export class McpOperationRegistry
{

	private static readonly KEEP = 50;

	private readonly entries = new Map<string, Entry>();

	public start(label: string, cancel: (() => void) | null): string
	{
		const id = crypto.randomUUID();
		this.entries.set(id, {
			operation: {id, label, state: 'running', startedAt: Date.now(), finishedAt: null, message: null, result: null},
			cancel,
		});
		this.prune();
		return id;
	}

	public finish(id: string, state: Exclude<McpOperationState, 'running'>, message: string | null = null, result: unknown = null): void
	{
		const entry = this.entries.get(id);
		if (entry === undefined || entry.operation.state !== 'running') {
			return;
		}
		entry.operation = {...entry.operation, state, finishedAt: Date.now(), message, result};
		entry.cancel = null;
	}

	public get(id: string): McpOperation
	{
		const entry = this.entries.get(id);
		if (entry === undefined) {
			throw new McpError('not_found', `No operation with id ${id}.`);
		}
		return entry.operation;
	}

	public list(): McpOperation[]
	{
		return [...this.entries.values()].map(entry => entry.operation);
	}

	public cancel(id: string): McpOperation
	{
		const entry = this.entries.get(id);
		if (entry === undefined) {
			throw new McpError('not_found', `No operation with id ${id}.`);
		}
		if (entry.operation.state !== 'running') {
			return entry.operation;
		}
		entry.cancel?.();
		this.finish(id, 'cancelled', 'Cancelled on request.');
		return entry.operation;
	}

	private prune(): void
	{
		if (this.entries.size <= McpOperationRegistry.KEEP) {
			return;
		}
		for (const [id, entry] of this.entries) {
			if (entry.operation.state !== 'running') {
				this.entries.delete(id);
				if (this.entries.size <= McpOperationRegistry.KEEP) {
					return;
				}
			}
		}
	}

}
