import {Injectable} from '@angular/core';
import {McpArgs} from '@src/Model/Mcp/McpArgs';
import {McpCommand} from '@src/Model/Mcp/McpCommand';
import {McpCommandBus} from '@src/Model/Mcp/McpCommandBus';
import {McpPlannerHost} from '@src/Model/Mcp/McpPlannerHost';
import {McpPlanTargets} from '@src/Model/Mcp/McpPlanTargets';
import {McpResultFreshness} from '@src/Model/Mcp/McpResultFreshness';
import {McpRevisionTracker} from '@src/Model/Mcp/McpRevisionTracker';
import {BuildCostMaterialRow} from '@src/Model/Planner/Breakdown/BuildCostMaterialRow';
import {PlanBreakdownService} from '@src/Model/Planner/Breakdown/PlanBreakdownService';
import {Plan} from '@src/Model/Planner/Plan';
import {PowerDraw} from '@src/Model/Planner/PowerDraw';

const SECTIONS = ['items', 'power', 'build_cost', 'resources', 'production', 'recipes'] as const;

/**
 * CAL-17: what the last calculation produced, read through the same breakdown service the Overview, Items, Power and Build cost panels
 * use. Rows are flattened to plain data; entities are referred to by className and name.
 */
@Injectable({providedIn: 'root'})
export class ResultCommands
{

	public constructor(
		bus: McpCommandBus,
		private readonly targets: McpPlanTargets,
		private readonly breakdown: PlanBreakdownService,
		private readonly revisions: McpRevisionTracker,
		private readonly host: McpPlannerHost,
		private readonly freshness: McpResultFreshness,
	)
	{
		bus.register(...this.commands().map(command => ({...command, gates: ['plans_loaded' as const]})));
	}

	private commands(): McpCommand[]
	{
		return [
			{
				name: 'results.get_summary',
				kind: 'query',
				summary: 'Totals of the last calculation: products, resources, power, machines and build cost, plus whether the results are current.',
				run: args => {
					const plan = this.targets.plan(args);
					return {ok: true, kind: 'query', data: this.summary(plan)};
				},
			},
			{
				name: 'results.get_breakdown',
				kind: 'query',
				summary: 'Detailed rows of one result section: items, power, build_cost, resources, production or recipes.',
				run: args => {
					const plan = this.targets.plan(args);
					const section = args.oneOf('section', SECTIONS);
					return {ok: true, kind: 'query', data: {planId: plan.id, section, ...this.state(plan), rows: this.rows(plan, section, args)}};
				},
			},
		];
	}

	private state(plan: Plan): Record<string, unknown>
	{
		const planner = this.host.calculationStateOf(plan.id);
		const staleReason = planner?.error ? 'last_calculation_failed' : this.freshness.staleReason(plan);
		return {
			revision: this.revisions.revisionOf('plan', plan.id),
			calculated: plan.graph !== null,
			calculating: planner?.calculating ?? false,
			// The rows below come from the last successful calculation, which may not match the plan any more.
			resultsStale: plan.graph !== null && staleReason !== null,
			staleReason: plan.graph === null ? null : staleReason,
			lastCalculationError: planner?.error ?? null,
			graphEditedByHand: plan.metadata.graphDirty,
			recalculationNeeded: plan.metadata.recalculationNeeded ?? false,
			achievedMaximums: plan.metadata.achievedMaximums ?? null,
		};
	}

	private summary(plan: Plan): Record<string, unknown>
	{
		const base = {planId: plan.id, name: plan.name, ...this.state(plan)};
		if (plan.graph === null) {
			return {...base, note: 'This plan has no calculated graph yet. Call calculator_calculate first.'};
		}
		const power = this.breakdown.power(plan);
		const buildCost = this.breakdown.buildCost(plan);
		return {
			...base,
			products: this.breakdown.production(plan).map(row => ({
				className: row.item.className, name: row.item.name, kind: row.kind, perMinute: row.amount,
			})),
			resources: this.breakdown.resources(plan).map(row => ({
				className: row.item.className, name: row.item.name, usedPerMinute: row.used, limit: row.limit, disabled: row.disabled,
			})),
			power: {
				consumptionMW: this.draw(power.consumption),
				productionMW: power.production,
				netMW: this.draw(power.net),
			},
			buildCost: {
				machines: buildCost.machines,
				builtMachines: buildCost.builtMachines,
				powerShards: buildCost.shards,
				somersloops: buildCost.sloops,
			},
		};
	}

	private rows(plan: Plan, section: typeof SECTIONS[number], _args: McpArgs): unknown[]
	{
		if (plan.graph === null) {
			return [];
		}
		switch (section) {
			case 'items':
				return this.breakdown.items(plan).map(row => ({
					className: row.item.className,
					name: row.item.name,
					producedPerMinute: row.totalSources,
					consumedPerMinute: row.totalTargets,
					netPerMinute: row.net,
					sources: row.sources.map(flow => ({name: flow.name, perMinute: flow.amount, nodeIds: flow.nodeIds})),
					targets: row.targets.map(flow => ({name: flow.name, perMinute: flow.amount, nodeIds: flow.nodeIds})),
				}));
			case 'power':
				return this.breakdown.power(plan).rows.map(row => ({
					name: row.name,
					kind: row.kind,
					machines: row.machines,
					builtMachines: row.builtMachines,
					powerMW: this.draw(row.power),
					nodeIds: row.nodeIds,
				}));
			case 'build_cost':
				return this.breakdown.buildCost(plan).rows.map(row => ({
					name: row.name,
					kind: row.kind,
					machines: row.machines,
					builtMachines: row.builtMachines,
					powerShards: row.shards,
					somersloops: row.sloops,
					materials: this.materials(row.materials),
					remainingMaterials: this.materials(row.remainingMaterials),
					nodeIds: row.nodeIds,
				}));
			case 'resources':
				return this.breakdown.resources(plan).map(row => ({
					className: row.item.className, name: row.item.name, usedPerMinute: row.used, limit: row.limit, disabled: row.disabled, nodeIds: row.nodeIds,
				}));
			case 'production':
				return this.breakdown.production(plan).map(row => ({
					className: row.item.className, name: row.item.name, kind: row.kind, perMinute: row.amount, nodeIds: row.nodeIds,
				}));
			case 'recipes':
				return this.breakdown.recipes(plan).map(row => ({
					className: row.recipe.className,
					name: row.recipe.name,
					machines: row.machines,
					builtMachines: row.builtMachines,
					nodeIds: row.nodeIds,
				}));
		}
	}

	private materials(rows: BuildCostMaterialRow[]): {className: string; name: string; amount: number}[]
	{
		return rows.map(row => ({className: row.item.className, name: row.item.name, amount: row.amount}));
	}

	private draw(draw: PowerDraw): {average: number; min: number; max: number}
	{
		return {average: draw.average, min: draw.min, max: draw.max};
	}

}
