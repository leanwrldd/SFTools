import {Injectable} from '@angular/core';
import {McpPlannerHost} from '@src/Model/Mcp/McpPlannerHost';
import {McpMutationResult} from '@src/Model/Mcp/McpResult';
import {McpResultFreshness} from '@src/Model/Mcp/McpResultFreshness';
import {McpRevisionTracker} from '@src/Model/Mcp/McpRevisionTracker';
import {PlanManager} from '@src/Model/Planner/PlanManager';

/**
 * Builds the result of a command that changed a plan setting, request or input, and tells the client what happens to the calculated
 * graph. Calculation and editing are separate: a settings change never recalculates by itself, except in automatic mode while the
 * planner shows that plan (the planner page watches the settings and recalculates after a short pause unless the graph was edited by hand).
 */
@Injectable({providedIn: 'root'})
export class McpPlanReporter
{

	public constructor(
		private readonly planManager: PlanManager,
		private readonly host: McpPlannerHost,
		private readonly revisions: McpRevisionTracker,
		private readonly freshness: McpResultFreshness,
	)
	{
	}

	public settingsChanged(planId: string, data: Record<string, unknown> = {}): McpMutationResult
	{
		const plan = this.planManager.findPlan(planId);
		const revision = this.revisions.revisionOf('plan', planId);
		const revisions: Record<string, string> = revision === null ? {} : {[`plan:${planId}`]: revision};
		if (plan === null) {
			return {ok: true, kind: 'mutation', changed: [], warnings: [], resultsStale: false, needsRecalculation: false, revisions, data};
		}

		const mode = plan.settings.calculationMode ?? 'automatic';
		const hasGraph = plan.graph !== null;
		const graphDirty = plan.metadata.graphDirty;
		const shown = this.host.isOpen() && this.planManager.activePlanId() === planId;
		const canSolve = plan.requests.some(request => request.itemClassName !== '') || (plan.graph?.nodes.some(node => node.locked) ?? false);
		const stale = this.freshness.staleReason(plan) !== null;
		const warnings: string[] = [];

		let recalculation: 'scheduled' | 'not_scheduled' | 'not_needed' = 'not_needed';
		if (!canSolve) {
			if (hasGraph) {
				warnings.push('Nothing is requested, so the solver will not run and the existing graph stays as it is.');
			}
		} else if (hasGraph && !stale) {
			recalculation = 'not_needed';
		} else if (mode === 'automatic' && shown && !graphDirty) {
			recalculation = 'scheduled';
		} else {
			recalculation = 'not_scheduled';
			if (mode !== 'automatic') {
				warnings.push(`Calculation mode is "${mode}", so the graph is not recalculated automatically. Call calculator_calculate.`);
			} else if (graphDirty) {
				warnings.push('The graph was edited by hand, so automatic mode is paused. Call calculator_calculate to recalculate.');
			} else {
				warnings.push('This plan is not showing in the planner, so nothing recalculates it. Open it with plans_open.');
			}
		}

		return {
			ok: true,
			kind: 'mutation',
			changed: [{kind: 'plan', id: planId, change: 'updated'}],
			warnings,
			resultsStale: stale,
			needsRecalculation: recalculation === 'not_scheduled',
			revisions,
			data: {...data, calculationMode: mode, recalculation},
		};
	}

}
