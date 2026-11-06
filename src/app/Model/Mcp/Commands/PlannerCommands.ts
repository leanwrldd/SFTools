import {Injectable} from '@angular/core';
import {McpCommand} from '@src/Model/Mcp/McpCommand';
import {McpCommandBus} from '@src/Model/Mcp/McpCommandBus';
import {McpError} from '@src/Model/Mcp/McpError';
import {McpOperationRegistry} from '@src/Model/Mcp/McpOperationRegistry';
import {McpPlannerHost} from '@src/Model/Mcp/McpPlannerHost';
import {McpMutationResult} from '@src/Model/Mcp/McpResult';
import {McpRevisionTracker} from '@src/Model/Mcp/McpRevisionTracker';

/**
 * First commands that act on the open planner. They prove the completion path every graph command will use: emit the request through
 * the page actions bus, then report what actually happened (graph replaced or not, solver outcome) instead of assuming success.
 */
@Injectable({providedIn: 'root'})
export class PlannerCommands
{

	public constructor(
		bus: McpCommandBus,
		private readonly host: McpPlannerHost,
		private readonly operations: McpOperationRegistry,
		private readonly revisions: McpRevisionTracker,
	)
	{
		bus.register(...this.commands());
	}

	private commands(): McpCommand[]
	{
		return [
			{
				name: 'calculator.calculate',
				kind: 'mutation',
				summary: 'Run the solver on the open plan and wait for its outcome (optimal, no solution, settings problem, error, timeout).',
				gates: ['planner_open'],
				run: async args => {
					const planId = args.string('planId');
					const operationId = this.operations.start('calculate', () => this.host.cancelCalculation());
					try {
						const outcome = await this.host.calculate(planId);
						const state = outcome.status === 'optimal' ? 'succeeded' : outcome.status === 'cancelled' ? 'cancelled' : 'failed';
						this.operations.finish(operationId, state, outcome.message, outcome);
						this.revisions.revisionOf('plan', outcome.planId);
						return this.mutation(outcome.planId, outcome.status === 'optimal', outcome.status === 'optimal' ? [] : [outcome.message ?? outcome.status], {
							operationId,
							outcome,
						});
					} catch (error) {
						const failure = McpError.from(error);
						this.operations.finish(operationId, failure.code === 'cancelled' ? 'cancelled' : 'failed', failure.message);
						throw failure;
					}
				},
			},
			{
				name: 'graph.delete_nodes',
				kind: 'mutation',
				summary: 'Delete nodes from the open plan graph. Requires confirm: true. Reports whether the graph changed; nodes may be refused (locks, subplan confirmation).',
				gates: ['planner_open'],
				run: async args => {
					const planId = args.string('planId');
					const nodeIds = args.stringList('nodeIds');
					args.requireConfirm('Deleting nodes');
					const outcome = await this.host.dispatch(planId, actions => actions.requestNodeDelete(nodeIds));
					return this.mutation(outcome.planId, outcome.graphChanged, outcome.graphChanged ? [] : [
						'The planner did not change the graph. The node ids may not exist, or the planner is waiting for a confirmation in the UI.',
					]);
				},
			},
		];
	}

	private mutation(planId: string, changed: boolean, warnings: string[], data: unknown = undefined): McpMutationResult
	{
		const revision = this.revisions.revisionOf('plan', planId);
		return {
			ok: true,
			kind: 'mutation',
			changed: changed ? [{kind: 'plan', id: planId, change: 'updated'}] : [],
			warnings,
			resultsStale: false,
			needsRecalculation: false,
			revisions: revision === null ? {} : {[`plan:${planId}`]: revision},
			data,
		};
	}

}
