import {Injectable} from '@angular/core';
import {VersionManager} from '@src/Model/Data/VersionManager';
import {Data} from '@src/Model/Data/Data';
import {McpArgs} from '@src/Model/Mcp/McpArgs';
import {McpError} from '@src/Model/Mcp/McpError';
import {McpRevisionTracker} from '@src/Model/Mcp/McpRevisionTracker';
import {Plan} from '@src/Model/Planner/Plan';
import {PlanManager} from '@src/Model/Planner/PlanManager';
import {SettingsGroup} from '@src/Model/Planner/SettingsGroup';
import {SettingsGroups} from '@src/Model/Planner/SettingsGroups';

/**
 * Resolves which plan a command acts on and enforces the rules the UI enforces: the plan exists, is not read-only, is unchanged since
 * the client read it, and its folder does not fix the settings group being changed. A read that names no plan acts on the open one.
 */
@Injectable({providedIn: 'root'})
export class McpPlanTargets
{

	public constructor(
		private readonly planManager: PlanManager,
		private readonly revisions: McpRevisionTracker,
		private readonly versions: VersionManager,
	)
	{
	}

	/** Existing plan: the named one, or the open one. */
	public plan(args: McpArgs): Plan
	{
		const id = args.optionalString('planId') ?? this.planManager.activePlanId();
		if (id === null) {
			throw new McpError('not_found', 'No plan is open. Pass "planId" or open one with plans_open.', 'plans.list');
		}
		const plan = this.planManager.findPlan(id);
		if (plan === null) {
			throw new McpError('not_found', `No plan with id ${id}.`, 'plans.list');
		}
		return plan;
	}

	/** Plan that may be changed now. Always named: the open plan can change between two commands, and a change must not follow it. */
	public editable(args: McpArgs): Plan
	{
		if (!args.has('planId')) {
			throw new McpError('invalid_arguments', '"planId" is required to change a plan, so the change cannot land on another plan if the open one changes.', 'app.get_context');
		}
		const plan = this.plan(args);
		if (this.planManager.isReadOnlyPlan(plan.id)) {
			throw new McpError('read_only', 'This plan is shared or read-only. Make an editable copy of it in the app first.');
		}
		this.revisions.assertFresh('plan', plan.id, args.optionalString('expectedRevision'));
		return plan;
	}

	/** Editable plan whose folder does not fix the given settings group. */
	public editableSettings(args: McpArgs, group: SettingsGroup): Plan
	{
		const plan = this.editable(args);
		if (this.planManager.fixedGroupsOf(plan).includes(group)) {
			const folder = this.planManager.fixedFolderOf(plan);
			throw new McpError(
				'conflict',
				`The ${SettingsGroups.labelOf(group)} settings of this plan are fixed by the folder "${folder?.name ?? '?'}". Change them in the folder's settings in the app.`,
				null,
				{group, folderId: folder?.id ?? null},
			);
		}
		return plan;
	}

	public data(): Data
	{
		const data = this.versions.activeVersionData();
		if (data === null) {
			throw new McpError('not_available', 'No game data is loaded. Open a game version with app_navigate {target: "planner"}.', 'app.navigate');
		}
		return data;
	}

}
