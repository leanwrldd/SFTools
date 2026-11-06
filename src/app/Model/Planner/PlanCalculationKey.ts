import {Injectable} from '@angular/core';
import {GroupingModeResolver} from '@src/Model/Planner/GroupingModeResolver';
import {Plan} from '@src/Model/Planner/Plan';
import {SettingsManager} from '@src/Model/Settings/SettingsManager';

/** Everything in a plan that changes what the solver produces: two plans with the same key get the same result. */
@Injectable({providedIn: 'root'})
export class PlanCalculationKey
{

	public constructor(
		private readonly settings: SettingsManager,
		private readonly groupingModes: GroupingModeResolver,
	)
	{
	}

	public of(plan: Plan): string
	{
		const defaults = this.settings.planDefaults();
		return JSON.stringify({
			// powerUnit is display-only - must not re-solve.
			requests: plan.requests.map(r => ({itemClassName: r.itemClassName, ratePerMinute: r.ratePerMinute, mode: r.mode})),
			inputs: plan.inputs,
			recipes: plan.settings.enabledRecipes ?? [defaults.alternateRecipes, defaults.conversionRecipes],
			machines: plan.settings.disabledMachines,
			limits: [plan.settings.resourceLimits, plan.settings.disabledResources, plan.settings.resourceWeightMode, plan.settings.resourceWeights],
			fuels: plan.settings.enabledFuels,
			byproducts: plan.settings.disabledByproducts,
			sinkable: plan.settings.sinkableItems,
			factoryPower: [plan.settings.producePowerForFactory, plan.settings.excessPowerPercent],
			extraPower: [plan.settings.geothermalGenerators, plan.settings.alienPowerAugmenters],
			optimisation: plan.settings.optimisation,
			sloops: [plan.settings.maxSloops, plan.settings.sloopAccuracy],
			clocks: [plan.settings.defaultClockSpeed, plan.settings.recipeClockSpeeds, plan.settings.machineClockSpeeds, plan.settings.generatorClockSpeeds],
			grouping: this.groupingModes.resolve(plan.settings),
		});
	}

}
