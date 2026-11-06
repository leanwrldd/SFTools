import {Injectable, effect, untracked} from '@angular/core';
import {Plan} from '@src/Model/Planner/Plan';
import {PlanCalculationKey} from '@src/Model/Planner/PlanCalculationKey';
import {PlanManager} from '@src/Model/Planner/PlanManager';

export type McpStaleReason = 'settings_changed' | 'folder_settings_changed';

interface Baseline
{
	graph: unknown;
	key: string;
}

/**
 * Whether a plan's graph still answers its current settings. Nothing in a plan records that, so this remembers the calculation key each
 * time a graph is calculated. A failed solve keeps the old graph and a manual-mode edit does not touch it, and both then differ from
 * the baseline. Baselines live as long as the app: a graph loaded from disk is taken to match the settings saved with it.
 */
@Injectable({providedIn: 'root'})
export class McpResultFreshness
{

	private readonly baselines = new Map<string, Baseline>();

	public constructor(
		private readonly planManager: PlanManager,
		private readonly calculationKey: PlanCalculationKey,
	)
	{
		// Watches rather than waiting to be asked: a calculation between two commands has to move the baseline.
		effect(() => {
			const plans = this.planManager.plans();
			untracked(() => plans.forEach(plan => this.observe(plan)));
		});
	}

	public staleReason(plan: Plan): McpStaleReason | null
	{
		if (plan.graph === null) {
			return null;
		}
		if (plan.metadata.recalculationNeeded) {
			return 'folder_settings_changed';
		}
		const baseline = this.observe(plan);
		return baseline.key === this.calculationKey.of(plan) ? null : 'settings_changed';
	}

	private observe(plan: Plan): Baseline
	{
		let baseline = this.baselines.get(plan.id);
		if (baseline === undefined) {
			baseline = {graph: plan.graph, key: this.calculationKey.of(plan)};
			this.baselines.set(plan.id, baseline);
		} else if (baseline.graph !== plan.graph) {
			baseline.graph = plan.graph;
			// A hand edit replaces the graph without calculating anything, so the old baseline still applies.
			if (!plan.metadata.graphDirty) {
				baseline.key = this.calculationKey.of(plan);
			}
		}
		return baseline;
	}

}
