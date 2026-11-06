import {Injectable} from '@angular/core';
import {McpError} from '@src/Model/Mcp/McpError';
import {Plan} from '@src/Model/Planner/Plan';
import {PlanManager} from '@src/Model/Planner/PlanManager';

interface Seen
{
	parts: readonly unknown[];
	counter: number;
}

/**
 * Revision tokens for plans and folders.
 *
 * Server revisions are null for device-local entries and only change on sync, so they cannot detect a manual edit. The stores are
 * immutable, so a token bumps whenever an edited part of the entity was replaced since it was last looked at. Reading a token when the
 * client queries and checking it again when the client mutates detects every edit in between, from either side.
 *
 * A calculation is not an edit: writing its graph and results leaves the token alone, so the token a setter returns survives the
 * automatic recalculation that setter schedules. Replacing a graph edited by hand does change what the client read, so that counts.
 * Tokens carry a per-session prefix because the counters restart with the app: an old token must never match a new counter.
 */
@Injectable({providedIn: 'root'})
export class McpRevisionTracker
{

	private readonly session = Math.random().toString(36).slice(2, 8);
	private readonly seen = new Map<string, Seen>();

	public constructor(private readonly planManager: PlanManager)
	{
	}

	/** Null when the entity does not exist. */
	public revisionOf(kind: 'plan' | 'folder', id: string): string | null
	{
		const key = `${kind}:${id}`;
		const parts = this.partsOf(kind, id);
		if (parts === null) {
			this.seen.delete(key);
			return null;
		}
		const previous = this.seen.get(key);
		if (previous === undefined) {
			this.seen.set(key, {parts, counter: 1});
			return this.token(1);
		}
		if (parts.some((part, index) => part !== previous.parts[index])) {
			previous.parts = parts;
			previous.counter++;
		}
		return this.token(previous.counter);
	}

	/** Throws stale_target when the client token no longer matches; a client that sends none skips the check. */
	public assertFresh(kind: 'plan' | 'folder', id: string, expected: string | null): void
	{
		const current = this.revisionOf(kind, id);
		if (current === null) {
			throw new McpError('not_found', `No ${kind} with id ${id}.`, 'plans.list');
		}
		if (expected !== null && expected !== current) {
			throw new McpError(
				'stale_target',
				`The ${kind} changed since it was read (expected revision ${expected}, now ${current}). Read it again before changing it.`,
				kind === 'plan' ? 'plans.get' : 'plans.list',
				{expected, current},
			);
		}
	}

	private token(counter: number): string
	{
		return `${this.session}-${counter}`;
	}

	private partsOf(kind: 'plan' | 'folder', id: string): readonly unknown[] | null
	{
		if (kind === 'plan') {
			const plan = this.planManager.findPlan(id);
			return plan === null ? null : this.planParts(plan);
		}
		const folder = this.planManager.folders().find(f => f.id === id);
		return folder === undefined ? null : [folder];
	}

	private planParts(plan: Plan): readonly unknown[]
	{
		const dirty = plan.metadata.graphDirty;
		return [plan.name, plan.description, plan.folderId, plan.parentPlanId, plan.requests, plan.inputs, plan.settings, dirty, dirty ? plan.graph : null];
	}

}
