import {Injectable} from '@angular/core';
import {PlanManager} from '@src/Model/Planner/PlanManager';
import {McpError} from '@src/Model/Mcp/McpError';

interface Seen
{
	ref: object;
	counter: number;
}

/**
 * Revision tokens for plans and folders.
 *
 * Server revisions are null for device-local entries and only change on sync, so they cannot detect a manual edit. The stores are
 * immutable: any change replaces the entity object. A token therefore bumps whenever the entity object identity changed since it
 * was last looked at. Reading a token when the client queries and checking it again when the client mutates detects every edit in
 * between, from either side.
 */
@Injectable({providedIn: 'root'})
export class McpRevisionTracker
{

	private readonly seen = new Map<string, Seen>();

	public constructor(private readonly planManager: PlanManager)
	{
	}

	/** Null when the entity does not exist. */
	public revisionOf(kind: 'plan' | 'folder', id: string): string | null
	{
		const key = `${kind}:${id}`;
		const entity = this.lookup(kind, id);
		if (entity === null) {
			this.seen.delete(key);
			return null;
		}
		const previous = this.seen.get(key);
		if (previous === undefined) {
			this.seen.set(key, {ref: entity, counter: 1});
			return '1';
		}
		if (previous.ref !== entity) {
			previous.ref = entity;
			previous.counter++;
		}
		return String(previous.counter);
	}

	/** Throws stale_target when the client token no longer matches; a client that sends none skips the check. */
	public assertFresh(kind: 'plan' | 'folder', id: string, expected: string | null): void
	{
		const current = this.revisionOf(kind, id);
		if (current === null) {
			throw new McpError('not_found', `No ${kind} with id ${id}.`);
		}
		if (expected !== null && expected !== current) {
			throw new McpError(
				'stale_target',
				`The ${kind} changed since it was read (expected revision ${expected}, now ${current}). Read it again before changing it.`,
				`${kind}s.get`,
				{expected, current},
			);
		}
	}

	private lookup(kind: 'plan' | 'folder', id: string): object | null
	{
		if (kind === 'plan') {
			return this.planManager.findPlan(id);
		}
		return this.planManager.folders().find(f => f.id === id) ?? null;
	}

}
