import {Injectable} from '@angular/core';
import {McpArgs} from '@src/Model/Mcp/McpArgs';
import {McpCommand} from '@src/Model/Mcp/McpCommand';
import {McpCommandBus} from '@src/Model/Mcp/McpCommandBus';
import {McpError} from '@src/Model/Mcp/McpError';
import {McpEntityRef, McpMutationResult} from '@src/Model/Mcp/McpResult';
import {McpRevisionTracker} from '@src/Model/Mcp/McpRevisionTracker';
import {Folder} from '@src/Model/Planner/Folder';
import {Plan} from '@src/Model/Planner/Plan';
import {PlanManager} from '@src/Model/Planner/PlanManager';

/** PLN-01, PLN-02, PLN-04: listing, reading and the basic plan/folder lifecycle, through PlanManager so persistence and sync behave as in the UI. */
@Injectable({providedIn: 'root'})
export class PlanCommands
{

	public constructor(
		bus: McpCommandBus,
		private readonly planManager: PlanManager,
		private readonly revisions: McpRevisionTracker,
	)
	{
		bus.register(...this.commands());
	}

	private commands(): McpCommand[]
	{
		return [
			{
				name: 'plans.list',
				kind: 'query',
				summary: 'All plans and folders with hierarchy, storage and revision tokens.',
				run: () => ({
					ok: true,
					kind: 'query',
					data: {
						folders: this.planManager.folders().map(folder => this.describeFolder(folder, 'own')),
						plans: this.planManager.plans().map(plan => this.describePlan(plan, 'own')),
						deviceLocal: {
							folders: this.planManager.localFolders().map(folder => this.describeFolder(folder, 'device')),
							plans: this.planManager.localPlans().map(plan => this.describePlan(plan, 'device')),
						},
						shared: {
							folders: this.planManager.sharedFolders().map(folder => this.describeFolder(folder, 'shared')),
							plans: this.planManager.sharedPlans().map(plan => this.describePlan(plan, 'shared')),
						},
					},
				}),
			},
			{
				name: 'plans.get',
				kind: 'query',
				summary: 'One plan with its requests, inputs and metadata (settings and graph are read through the calculator and graph commands).',
				run: args => {
					const plan = this.requirePlan(args.string('planId'));
					return {
						ok: true,
						kind: 'query',
						data: {
							...this.describePlan(plan, this.storageOf(plan.id)),
							description: plan.description,
							requests: plan.requests,
							inputs: plan.inputs,
							hasGraph: plan.graph !== null,
							graphDirty: plan.metadata.graphDirty,
							recalculationNeeded: plan.metadata.recalculationNeeded ?? false,
						},
					};
				},
			},
			{
				name: 'plans.open',
				kind: 'mutation',
				summary: 'Make a plan the active plan (shared and read-only plans open read-only).',
				run: args => {
					const plan = this.requirePlan(args.string('planId'));
					this.planManager.setActivePlan(plan.id);
					return this.result([{kind: 'plan', id: plan.id, change: 'unchanged'}], {data: {readOnly: this.planManager.isReadOnlyPlan(plan.id)}});
				},
			},
			{
				name: 'plans.create',
				kind: 'mutation',
				summary: 'Create a plan, optionally inside a folder. An empty name lets the app name it after its first product.',
				run: args => {
					const folderId = args.optionalString('folderId');
					if (folderId !== null) {
						this.requireOwnFolder(folderId);
					}
					const plan = this.planManager.createPlan(args.optionalString('name') ?? '', folderId);
					return this.result([{kind: 'plan', id: plan.id, change: 'created'}]);
				},
			},
			{
				name: 'plans.rename',
				kind: 'mutation',
				summary: 'Rename a plan. Pass expectedRevision from plans.get to refuse the change if the plan was edited since.',
				run: args => {
					const plan = this.requireEditablePlan(args);
					this.planManager.renamePlan(plan.id, args.string('name'));
					return this.result([{kind: 'plan', id: plan.id, change: 'updated'}]);
				},
			},
			{
				name: 'plans.clone',
				kind: 'mutation',
				summary: 'Clone a plan under the given name.',
				run: args => {
					const source = this.requirePlan(args.string('planId'));
					const clone = this.planManager.clonePlan(source.id, args.string('name'));
					if (clone === null) {
						throw new McpError('failed', 'The plan could not be cloned.');
					}
					return this.result([{kind: 'plan', id: clone.id, change: 'created'}]);
				},
			},
			{
				name: 'plans.delete',
				kind: 'mutation',
				summary: 'Delete a plan and its subplans. Requires confirm: true.',
				run: args => {
					const plan = this.requireEditablePlan(args);
					args.requireConfirm('Deleting a plan');
					this.planManager.deletePlan(plan.id);
					return this.result([{kind: 'plan', id: plan.id, change: 'deleted'}]);
				},
			},
			{
				name: 'folders.create',
				kind: 'mutation',
				summary: 'Create a folder, optionally inside another folder.',
				run: args => {
					const parentId = args.optionalString('parentId');
					if (parentId !== null) {
						this.requireOwnFolder(parentId);
					}
					const folder = this.planManager.createFolder(args.string('name'), parentId);
					return this.result([{kind: 'folder', id: folder.id, change: 'created'}]);
				},
			},
			{
				name: 'folders.rename',
				kind: 'mutation',
				summary: 'Rename a folder. Pass expectedRevision to refuse the change if the folder was edited since.',
				run: args => {
					const folder = this.requireOwnFolder(args.string('folderId'));
					this.revisions.assertFresh('folder', folder.id, args.optionalString('expectedRevision'));
					this.planManager.renameFolder(folder.id, args.string('name'));
					return this.result([{kind: 'folder', id: folder.id, change: 'updated'}]);
				},
			},
			{
				name: 'folders.delete',
				kind: 'mutation',
				summary: 'Delete a folder with everything in it. Requires confirm: true.',
				run: args => {
					const folder = this.requireOwnFolder(args.string('folderId'));
					this.revisions.assertFresh('folder', folder.id, args.optionalString('expectedRevision'));
					args.requireConfirm('Deleting a folder');
					this.planManager.deleteFolder(folder.id);
					return this.result([{kind: 'folder', id: folder.id, change: 'deleted'}]);
				},
			},
		];
	}

	private requirePlan(id: string): Plan
	{
		const plan = this.planManager.findPlan(id);
		if (plan === null) {
			throw new McpError('not_found', `No plan with id ${id}.`, 'plans.list');
		}
		return plan;
	}

	/** Own plan, not read-only, and unchanged since the client read it. */
	private requireEditablePlan(args: McpArgs): Plan
	{
		const plan = this.requirePlan(args.string('planId'));
		if (this.planManager.isReadOnlyPlan(plan.id)) {
			throw new McpError('read_only', 'This plan is shared or read-only.', 'plans.import_copy');
		}
		this.revisions.assertFresh('plan', plan.id, args.optionalString('expectedRevision'));
		return plan;
	}

	private requireOwnFolder(id: string): Folder
	{
		const folder = this.planManager.folders().find(f => f.id === id);
		if (folder === undefined) {
			throw new McpError('not_found', `No folder with id ${id}.`, 'plans.list');
		}
		return folder;
	}

	private storageOf(planId: string): 'own' | 'device' | 'shared'
	{
		if (this.planManager.isSharedPlan(planId)) {
			return 'shared';
		}
		return this.planManager.isLocalPlan(planId) ? 'device' : 'own';
	}

	private describePlan(plan: Plan, storage: 'own' | 'device' | 'shared'): Record<string, unknown>
	{
		return {
			id: plan.id,
			name: plan.name,
			folderId: plan.folderId,
			parentPlanId: plan.parentPlanId,
			storage,
			readOnly: storage !== 'own',
			revision: this.revisions.revisionOf('plan', plan.id),
		};
	}

	private describeFolder(folder: Folder, storage: 'own' | 'device' | 'shared'): Record<string, unknown>
	{
		return {
			id: folder.id,
			name: folder.name,
			parentId: folder.parentId,
			storage,
			resourcePool: folder.resourcePool,
			hasOwnSettings: folder.settings !== null,
			revision: this.revisions.revisionOf('folder', folder.id),
		};
	}

	private result(changed: McpEntityRef[], extra: {data?: unknown} = {}): McpMutationResult
	{
		const revisions: Record<string, string> = {};
		for (const ref of changed) {
			if (ref.change === 'deleted' || ref.kind === 'node' || ref.kind === 'edge') {
				continue;
			}
			const revision = this.revisions.revisionOf(ref.kind, ref.id);
			if (revision !== null) {
				revisions[`${ref.kind}:${ref.id}`] = revision;
			}
		}
		return {ok: true, kind: 'mutation', changed, warnings: [], resultsStale: false, needsRecalculation: false, revisions, ...extra};
	}

}
